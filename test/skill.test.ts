/**
 * D2.2 — the packaged skill and its demo script, validated by machine.
 *
 * Criterion: "Skill packaged; a demo shows 'grant permission to do X from
 * this transaction' producing a reviewed policy."
 *
 * Two halves, both network-free:
 *  1. the package structure against the verified skill format
 *     (docs/FACTS.md §10: agentskills.io + Anthropic's rules) and the
 *     guardrails the skill must carry;
 *  2. a scripted walkthrough: every "Expected tool call" in
 *     docs/skill-demo-script.md (and docs/mcp-reference-session.md) is
 *     validated against the tool's committed input schema and then executed,
 *     in order, against the real MCP server over stdio (stub RPC), asserting
 *     the results the scripts promise — the four tools are hit, the cap
 *     clarification is asked, and the walkthrough ends with reviewable
 *     artifacts and the dry-run table.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS, UNAUDITED_BANNER, type ToolName } from '../src/mcp/schemas.js';
import { ROOT, callTool, read, startMcpHarness, type McpHarness } from './mcp-harness.js';

const SKILL_NAME = 'policywright-grant';
const SKILL_DIR = join(ROOT, '.claude', 'skills', SKILL_NAME);
const SKILL_MD = join(SKILL_DIR, 'SKILL.md');
const DEMO_SCRIPT = join(ROOT, 'docs', 'skill-demo-script.md');
const REFERENCE_SESSION = join(ROOT, 'docs', 'mcp-reference-session.md');

// ---------------------------------------------------------------------------
// A minimal YAML-subset reader for the frontmatter (flat scalars + one map)
// ---------------------------------------------------------------------------

interface Frontmatter {
  readonly scalars: Record<string, string>;
  readonly maps: Record<string, Record<string, string>>;
  readonly body: string;
}

function parseFrontmatter(text: string): Frontmatter {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (m === null) {
    throw new Error('SKILL.md has no YAML frontmatter block');
  }
  const scalars: Record<string, string> = {};
  const maps: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const line of (m[1] ?? '').split('\n')) {
    const nested = /^ {2}([A-Za-z_-]+):\s*(.*)$/.exec(line);
    const top = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (nested !== null && current !== null) {
      (maps[current] ??= {})[nested[1] ?? ''] = (nested[2] ?? '').replace(/^"|"$/g, '');
    } else if (top !== null) {
      const key = top[1] ?? '';
      const value = top[2] ?? '';
      if (value === '') {
        current = key;
        maps[key] = {};
      } else {
        current = null;
        scalars[key] = value;
      }
    } else {
      throw new Error(`unparseable frontmatter line: ${line}`);
    }
  }
  return { scalars, maps, body: m[2] ?? '' };
}

// ---------------------------------------------------------------------------
// Tool calls embedded in a Markdown script
// ---------------------------------------------------------------------------

interface ScriptedCall {
  readonly turn: string;
  readonly tool: ToolName;
  readonly args: Record<string, unknown>;
}

/**
 * Every ```json block that follows an "Expected tool call(s) — `mcp__policywright__<tool>`"
 * line, until the next "###" heading. A heading may announce several blocks
 * ("twice").
 */
function scriptedCalls(markdown: string): ScriptedCall[] {
  const calls: ScriptedCall[] = [];
  let turn = '';
  let tool: ToolName | null = null;
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('### ')) {
      turn = line.slice(4);
      tool = null;
      continue;
    }
    const header = /Expected tool calls? — `mcp__policywright__([a-z]+)`/.exec(line);
    if (header !== null) {
      const name = header[1] ?? '';
      if (!(TOOL_NAMES as readonly string[]).includes(name)) {
        throw new Error(`${turn}: unknown tool ${name}`);
      }
      tool = name as ToolName;
      continue;
    }
    if (line === '```json' && tool !== null) {
      const end = lines.indexOf('```', i + 1);
      const json = lines.slice(i + 1, end).join('\n');
      calls.push({ turn, tool, args: JSON.parse(json) as Record<string, unknown> });
      i = end;
    }
  }
  return calls;
}

// ---------------------------------------------------------------------------
// 1. The package
// ---------------------------------------------------------------------------

describe('skill package — policywright-grant', () => {
  const fm = parseFrontmatter(read(SKILL_MD));

  it('follows the skill format (agentskills.io + Anthropic rules, FACTS §10)', () => {
    const { scalars } = fm;
    // name: 1–64, [a-z0-9-], no leading/trailing/consecutive hyphens, equals the directory name.
    expect(scalars['name']).toBe(SKILL_NAME);
    expect(scalars['name']).toBe(basename(SKILL_DIR));
    expect(scalars['name']).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect((scalars['name'] ?? '').length).toBeLessThanOrEqual(64);
    expect(scalars['name']).not.toMatch(/anthropic|claude/);
    // description: 1–1024, no XML, says what AND when.
    const description = scalars['description'] ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/<[^>]+>/);
    expect(description).toContain('Use when');
    expect(description).toContain('grant permission to do X from this transaction');
    // optional spec fields only (no Claude-Code-only keys, so the package is portable).
    expect(Object.keys(scalars).sort()).toEqual(
      ['allowed-tools', 'compatibility', 'description', 'license', 'name'].sort(),
    );
    expect(Object.keys(fm.maps)).toEqual(['metadata']);
    expect((scalars['compatibility'] ?? '').length).toBeLessThanOrEqual(500);
    for (const value of Object.values(fm.maps['metadata'] ?? {})) {
      expect(typeof value).toBe('string');
    }
  });

  it('pre-approves exactly the four MCP tools and no install/deploy tool', () => {
    const allowed = (fm.scalars['allowed-tools'] ?? '').split(/\s+/).sort();
    expect(allowed).toEqual(TOOL_NAMES.map((t) => `mcp__policywright__${t}`).sort());
    expect(fm.body).not.toMatch(/mcp__policywright__(install|deploy|sign|submit)/);
  });

  it('keeps the body within the format budget and references one level deep', () => {
    expect(fm.body.split('\n').length).toBeLessThan(500);
    const refs = [...fm.body.matchAll(/\]\((references\/[^)]+)\)/g)].map((m) => m[1] ?? '');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      expect(ref.split('/')).toHaveLength(2); // one level deep
      expect(existsSync(join(SKILL_DIR, ref))).toBe(true);
    }
    // macOS may add AppleDouble `._*` sidecars on this volume; they are gitignored.
    for (const entry of readdirSync(SKILL_DIR).filter((e) => !e.startsWith('._'))) {
      expect(['SKILL.md', 'references'].includes(entry)).toBe(true);
    }
    expect(statSync(join(SKILL_DIR, 'references')).isDirectory()).toBe(true);
  });

  it('drives all four tools in order and carries every guardrail', () => {
    const body = fm.body;
    const order = TOOL_NAMES.map((t) => body.indexOf(`mcp__policywright__${t}\``));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // record → synthesize → simulate → verify
    expect(body).toContain('**Never install, deploy, sign, or submit.**');
    expect(body).toContain('**Always dry-run before calling anything "reviewed".**');
    expect(body.replace(/\s+/g, ' ')).toContain(UNAUDITED_BANNER);
    expect(body).toContain('**Never invent a hash, address, amount, or window.**');
    expect(body).toContain('**Ask, do not assume**');
    expect(body).toContain('npm run cli -- install --artifact');
    expect(body).toContain('Testnet only');
  });

  it('asks on every clarification trigger, the cap first', () => {
    const body = fm.body;
    for (const trigger of [
      'T1 cap',
      'T2 lifetime',
      'T3 multi-asset',
      'T4 argument constraint',
      'T5',
      'T6',
    ]) {
      expect(body).toContain(trigger);
    }
    const clarifications = read(join(SKILL_DIR, 'references', 'clarifications.md'));
    expect(clarifications).toContain('cap at 50, or allow up to 100 over a week'); // the funded plan's example
    for (const id of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']) {
      expect(clarifications).toMatch(new RegExp(`^\\| ${id} `, 'm'));
    }
    expect(clarifications).toContain('never assumes');
  });
});

// ---------------------------------------------------------------------------
// 2. The scripts, executed
// ---------------------------------------------------------------------------

describe('scripted walkthroughs against the real server', () => {
  let harness: McpHarness;
  const demo = scriptedCalls(read(DEMO_SCRIPT));
  const session = scriptedCalls(read(REFERENCE_SESSION));

  beforeAll(async () => {
    harness = await startMcpHarness();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  it('every scripted tool call in both documents validates against the committed input schema', () => {
    expect(demo.length).toBeGreaterThan(0);
    expect(session.length).toBeGreaterThan(0);
    for (const call of [...demo, ...session]) {
      const parsed = TOOL_SCHEMAS[call.tool].input.safeParse(call.args);
      expect(
        parsed.success,
        `${call.turn}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`,
      ).toBe(true);
    }
  });

  it('the skill demo script hits record → synthesize → synthesize → simulate and ends reviewed', async () => {
    expect(demo.map((c) => c.tool)).toEqual(['record', 'synthesize', 'synthesize', 'simulate']);
    const results: Record<string, unknown>[] = [];
    for (const call of demo) {
      const result = await callTool(harness.client, call.tool, call.args);
      expect(result.isError, `${call.turn}: ${result.content[0]?.text ?? ''}`).not.toBe(true);
      results.push(result.structuredContent as Record<string, unknown>);
    }
    // Turn 1 — the recording of the real claim→swap flow.
    const recorded = results[0] as { summary: { calls: { fnName: string }[] }; warnings: string[] };
    expect(recorded.summary.calls.map((c) => c.fnName)).toEqual([
      'claim',
      'swap_exact_tokens_for_tokens',
    ]);
    expect(recorded.warnings).toEqual([]);
    // Turn 2 — defaults: not installable yet, numbers to ask about.
    const first = results[1] as {
      installable: { asIs: boolean };
      scopeNotes: string[];
      notes: string[];
      unauditedBanner: string;
    };
    expect(first.installable.asIs).toBe(false);
    expect(
      first.scopeNotes.some((n) => n.startsWith('BLND: outflow capped at 2.3533505 per 86400s')),
    ).toBe(true);
    expect(first.scopeNotes.some((n) => n.includes('ADVISORY'))).toBe(true);
    expect(first.notes.some((n) => n.startsWith('DELTA:'))).toBe(true);
    expect(first.unauditedBanner).toBe(UNAUDITED_BANNER);
    // Turn 3 — the answers applied: installable, chosen numbers, files written.
    const second = results[2] as {
      installable: { asIs: boolean };
      config: { constrainArguments: boolean; spendWindowSecs: number; lifetimeSecs: number };
      contextRule: {
        contextRules: {
          lifetimeLedgers: number;
          policies: { installParams: Record<string, unknown> }[];
        }[];
      };
      scopeNotes: string[];
      files?: string[];
    };
    expect(second.installable.asIs).toBe(true);
    expect(second.config).toMatchObject({
      constrainArguments: true,
      spendWindowSecs: 604_800,
      lifetimeSecs: 604_800,
    });
    expect(second.contextRule.contextRules.every((r) => r.lifetimeLedgers === 120_960)).toBe(true);
    expect(second.contextRule.contextRules[2]?.policies[0]?.installParams['period_ledgers']).toBe(
      120_960,
    );
    expect(second.scopeNotes.some((n) => n.includes('ENFORCED'))).toBe(true);
    expect(second.files?.map((f) => basename(f))).toEqual([
      'summary.txt',
      'spec.json',
      'context-rule.json',
      'FrequencyLimitPolicy.rs',
    ]);
    for (const file of second.files ?? []) {
      expect(existsSync(file)).toBe(true);
    }
    // Turn 4 — the dry run: reviewed only with a clean self-check.
    const dryRun = results[3] as {
      deviations: number;
      counts: Record<string, number>;
      results: { decision: string }[];
    };
    expect(dryRun.deviations).toBe(0);
    expect(dryRun.counts).toEqual({ permit: 1, deny: 5, flag: 0 });
  });

  it('the demo script asks at least the cap clarification and never installs', () => {
    const script = read(DEMO_SCRIPT);
    expect(script).toContain('(T1)');
    expect(script).toContain('(T2)');
    expect(script).toContain('(T4)');
    expect(script).toMatch(/Expected: \*\*no tool call\*\*/);
    expect(script.replace(/\n> /g, ' ').replace(/\s+/g, ' ')).toContain(UNAUDITED_BANNER);
  });

  it('the MCP reference session executes end to end on the replayed data', async () => {
    expect(session.map((c) => c.tool)).toEqual([
      'record',
      'record',
      'synthesize',
      'simulate',
      'simulate',
      'verify',
    ]);
    const results: Record<string, unknown>[] = [];
    for (const call of session) {
      const result = await callTool(harness.client, call.tool, call.args);
      // Live, Turn 2 returns TX_NOT_FOUND (retention); the stub replays the captures.
      expect(result.isError, `${call.turn}: ${result.content[0]?.text ?? ''}`).not.toBe(true);
      results.push(result.structuredContent as Record<string, unknown>);
    }
    expect((results[0] as { source: string }).source).toBe('simulation');
    expect((results[2] as { installable: { asIs: boolean } }).installable.asIs).toBe(true);
    expect((results[3] as { counts: unknown }).counts).toEqual({ permit: 1, deny: 4, flag: 1 });
    expect((results[4] as { counts: unknown }).counts).toEqual({ permit: 1, deny: 5, flag: 0 });
    expect((results[5] as { pass: boolean }).pass).toBe(true);
  });
});
