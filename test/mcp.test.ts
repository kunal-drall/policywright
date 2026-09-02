/**
 * D2.1 — the MCP server, end to end over stdio, network-free.
 *
 * Criterion: "The server runs locally and an agent calls each tool end to
 * end; a reference session is recorded."
 *
 * The REAL server process is spawned (node_modules/tsx on src/mcp/server.ts)
 * and driven through @modelcontextprotocol/client exactly as an agent host
 * would. Its RPC endpoint is a local stub (test/stub-rpc.ts) that replays the
 * committed raw captures of the real testnet claim→swap sequence and serves
 * the testnet smart account's installed rules exactly as recorded in
 * examples/live/testnet/. Every assertion is against a committed artifact.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { StrKey } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ILLUSTRATIVE_HEADER } from '../src/rust-policy.js';
import {
  ErrorEnvelopeSchema,
  MCP_SCHEMA_VERSION,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  UNAUDITED_BANNER,
  type ErrorEnvelope,
} from '../src/mcp/schemas.js';
import { SERVER_INSTRUCTIONS, SERVER_NAME } from '../src/mcp/server.js';
import { configFromEnv, toToolError } from '../src/mcp/tools.js';
import { RecorderError } from '../src/sources/errors.js';
import { SynthError } from '../src/synthesizer.js';
import { CONTEXT_RULE_SCHEMA_VERSION } from '../src/types.js';
import { startStubRpc, type StubRpc, type StubRule } from './stub-rpc.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const live = (name: string): string => join(ROOT, 'examples', 'live', name);
const read = (path: string): string => readFileSync(path, 'utf8');
const readJson = (path: string): unknown => JSON.parse(read(path));

// The real recorded claim→swap sequence (FACTS §12) and the D2.5 testnet state (FACTS §14).
const CLAIM_HASH = '9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6';
const SWAP_HASH = 'ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46';
const SUBJECT = 'GBMWJIADBWN6FJUQPSVKWZE7ZFEPHEN2YBINQ7UVPHJ2WJW2SWI6WD4Q';
const BLND = 'CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF';
const USDC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const SIM_TOKEN = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const SIM_SOURCE = 'GABJUTWU2LMN7VYU7Z43GV2OY7HPL5RXXJAQUBYHYLW5KHTRJUVNNJ3Q';
const ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const ACCOUNT = 'CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT';
const G = 'GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W';
const VERIFY_LEDGER = 4_464_624; // examples/live/testnet/verify.md: "read at ledger 4464624"
const FAKE_SECRET = 'SFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE';
/** A checksum-valid contract address the stub serves with only the constructor's admin rule. */
const EMPTY_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 7));

/** Parse the committed synth.args into the installTargets input (the CI pins the same flags). */
function committedInstallTargets(): {
  signers: { type: 'Delegated'; address: string }[];
  policyAddresses: Record<string, string>;
} {
  const args = read(live('fresh/synth.args')).trim().split('\n');
  const signers: { type: 'Delegated'; address: string }[] = [];
  const policyAddresses: Record<string, string> = {};
  for (const arg of args) {
    const signer = /^--signer=delegated:(.+)$/.exec(arg);
    const policy = /^--policy-address=([^=]+)=(.+)$/.exec(arg);
    if (signer?.[1] !== undefined) {
      signers.push({ type: 'Delegated', address: signer[1] });
    } else if (policy?.[1] !== undefined && policy[2] !== undefined) {
      policyAddresses[policy[1]] = policy[2];
    } else {
      throw new Error(`unexpected synth.args entry: ${arg}`);
    }
  }
  return { signers, policyAddresses };
}

/** The account state D2.5 left on testnet, derived from the committed artifact + install log. */
function testnetAccountState() {
  const artifact = readJson(live('fresh/context-rule.json')) as {
    contextRules: {
      contextType: { contract: string };
      name: string;
      policies: { policy: string; address: string; installParams: Record<string, unknown> }[];
    }[];
  };
  const log = readJson(live('testnet/install-20260902T105742Z.json')) as {
    results: { rule: string; validUntil: number; contextRuleId: number }[];
  };
  const rules: StubRule[] = [
    {
      id: 0,
      contextType: { type: 'Default' },
      name: 'multisig',
      signers: [{ type: 'Delegated', address: G }],
      policies: [],
      validUntil: null,
    },
  ];
  const params = new Map<
    string,
    | { kind: 'frequency'; windowSecs: bigint; maxCalls: number }
    | { kind: 'spending'; spendingLimit: bigint; periodLedgers: number }
  >();
  for (const rule of artifact.contextRules) {
    const installed = log.results.find((r) => r.rule === rule.name);
    if (installed === undefined) {
      throw new Error(`install log has no row for ${rule.name}`);
    }
    rules.push({
      id: installed.contextRuleId,
      contextType: { type: 'CallContract', contract: rule.contextType.contract },
      name: rule.name,
      signers: [{ type: 'Delegated', address: G }],
      policies: rule.policies.map((p) => p.address),
      validUntil: installed.validUntil,
    });
    for (const binding of rule.policies) {
      const key = `${installed.contextRuleId}:${binding.address}`;
      params.set(
        key,
        binding.policy === 'custom:FrequencyLimitPolicy'
          ? {
              kind: 'frequency',
              windowSecs: BigInt(binding.installParams['window_secs'] as number),
              maxCalls: binding.installParams['max_calls'] as number,
            }
          : {
              kind: 'spending',
              spendingLimit: BigInt(binding.installParams['spending_limit'] as string),
              periodLedgers: binding.installParams['period_ledgers'] as number,
            },
      );
    }
  }
  return { rules, params };
}

let stub: StubRpc;
let client: Client;
let scratch: string;

type ToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content: { type: string; text?: string }[];
};

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

/** A successful call: parsed through the tool's own output schema (a second, independent check). */
async function ok<T extends keyof typeof TOOL_SCHEMAS>(
  name: T,
  args: Record<string, unknown>,
): Promise<z.infer<(typeof TOOL_SCHEMAS)[T]['output']>> {
  const result = await call(name, args);
  expect(result.isError, JSON.stringify(result.structuredContent ?? result.content)).not.toBe(true);
  const parsed = TOOL_SCHEMAS[name].output.safeParse(result.structuredContent);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  // The text block is the same JSON as the structured content.
  expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent);
  return result.structuredContent as z.infer<(typeof TOOL_SCHEMAS)[T]['output']>;
}

/**
 * A failed call: the typed envelope as the JSON text block, and NO structured
 * content — clients validate structuredContent against the output schema
 * whenever it is present (Claude Code's bundled client does so even on
 * isError results, FACTS §15.2), which an error envelope cannot satisfy.
 */
async function fail(name: string, args: Record<string, unknown>): Promise<ErrorEnvelope> {
  const result = await call(name, args);
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content).toHaveLength(1);
  const envelope: unknown = JSON.parse(result.content[0]?.text ?? '');
  const parsed = ErrorEnvelopeSchema.safeParse(envelope);
  expect(parsed.success, JSON.stringify(envelope)).toBe(true);
  return envelope as ErrorEnvelope;
}

beforeAll(async () => {
  const state = testnetAccountState();
  stub = await startStubRpc({
    captures: new Map([
      [CLAIM_HASH, readJson(live(`${CLAIM_HASH}.json`))],
      [SWAP_HASH, readJson(live(`${SWAP_HASH}.json`))],
    ]),
    tokens: new Map([
      [BLND, { symbol: 'BLND', decimals: 7 }],
      [USDC, { symbol: 'USDC', decimals: 7 }],
      [XLM_SAC, { symbol: 'native', decimals: 7 }],
    ]),
    accounts: new Map([
      [ACCOUNT, state],
      [EMPTY_ACCOUNT, { rules: state.rules.slice(0, 1), params: new Map() }],
    ]),
    latestLedger: VERIFY_LEDGER,
    oldestLedger: VERIFY_LEDGER - 120_960,
  });
  scratch = mkdtempSync(join(tmpdir(), 'policywright-mcp-'));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(ROOT, 'src', 'mcp', 'server.ts'),
    ],
    cwd: scratch, // NOT the repo root: relative paths must resolve against POLICYWRIGHT_ROOT
    env: {
      ...getDefaultEnvironment(),
      POLICYWRIGHT_NETWORK: 'testnet',
      POLICYWRIGHT_RPC_URL: stub.url,
      POLICYWRIGHT_ROOT: ROOT,
      // The server must never read or echo this.
      STELLAR_SECRET_KEY: FAKE_SECRET,
    },
    stderr: 'pipe',
  });
  client = new Client({ name: 'policywright-test-client', version: '0.0.0' });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client.close();
  await stub.close();
  rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

describe('server', () => {
  it('identifies itself and hands the agent the code-first, deploy-second instructions', () => {
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    expect(client.getServerVersion()?.version).toBe(
      (readJson(join(ROOT, 'package.json')) as { version: string }).version,
    );
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toBe(SERVER_INSTRUCTIONS);
    expect(instructions).toContain('There is no install or deploy tool here, by design');
    expect(instructions).toContain('npm run cli -- install');
    expect(instructions).toContain(UNAUDITED_BANNER);
  });

  it('exposes exactly record, synthesize, simulate, verify — no install or deploy tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const forbidden of ['install', 'deploy', 'sign', 'submit']) {
      expect(tools.some((t) => t.name.includes(forbidden))).toBe(false);
    }
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(100);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  });

  it('advertises exactly the committed JSON Schemas (schemas/mcp/)', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const input = readJson(join(ROOT, 'schemas', 'mcp', `${tool.name}.input.json`));
      const output = readJson(join(ROOT, 'schemas', 'mcp', `${tool.name}.output.json`));
      expect(tool.inputSchema).toEqual(input);
      expect(tool.outputSchema).toEqual(output);
    }
    expect(readJson(join(ROOT, 'schemas', 'mcp', 'error.json'))).toEqual(
      z.toJSONSchema(ErrorEnvelopeSchema, { target: 'draft-2020-12', io: 'output' }),
    );
  });

  it('reports unknown tools as protocol errors and schema violations as SDK text errors', async () => {
    await expect(client.callTool({ name: 'install', arguments: {} })).rejects.toThrow(/not found/);
    const result = await call('record', { hashes: ['not-a-hash'] });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/^Input validation error/);
  });

  it('rejects an unknown schemaVersion with BAD_INPUT', async () => {
    const error = await fail('synthesize', {
      schemaVersion: MCP_SCHEMA_VERSION + 1,
      recordingPath: 'x.json',
    });
    expect(error.error.code).toBe('BAD_INPUT');
    expect(error.error.message).toContain(`schema version ${MCP_SCHEMA_VERSION}`);
  });
});

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

describe('record', () => {
  it('reproduces the committed recording of the real claim→swap sequence from the raw captures', async () => {
    const out = await ok('record', {
      hashes: [SWAP_HASH, CLAIM_HASH], // any order: merged by ledger close time
      account: SUBJECT,
      outPath: join(scratch, 'recording.json'),
    });
    expect(out.source).toBe('rpc');
    expect(out.network).toBe('testnet');
    expect(out.rpcUrl).toBe(stub.url);
    expect(out.recording).toEqual(readJson(live('recorded-claim-swap-fresh.json')));
    expect(read(join(scratch, 'recording.json'))).toBe(
      read(live('recorded-claim-swap-fresh.json')),
    );
    expect(out.summary.hash).toBe(CLAIM_HASH);
    expect(out.summary.subject).toBe(SUBJECT);
    expect(out.summary.calls.map((c) => c.fnName)).toEqual([
      'claim',
      'swap_exact_tokens_for_tokens',
    ]);
    expect(out.summary.flows).toEqual([
      {
        contractId: BLND,
        symbol: 'BLND',
        decimals: 7,
        resolved: true,
        direction: 'in',
        amount: '21394095',
        amountFormatted: '2.1394095',
      },
      {
        contractId: BLND,
        symbol: 'BLND',
        decimals: 7,
        resolved: true,
        direction: 'out',
        amount: '21394095',
        amountFormatted: '2.1394095',
      },
      {
        contractId: USDC,
        symbol: 'USDC',
        decimals: 7,
        resolved: true,
        direction: 'in',
        amount: '10516011',
        amountFormatted: '1.0516011',
      },
    ]);
    expect(out.warnings).toEqual([]);
    expect(stub.calls).toContain('getTransaction');
  });

  it('records the assumed-subject warning when no account is given', async () => {
    const out = await ok('record', { hashes: [CLAIM_HASH] });
    expect(out.warnings.join('\n')).toContain('no --account given');
  });

  it('ingests the committed real simulateTransaction exchange (source: simulation)', async () => {
    const out = await ok('record', {
      simulationPath: 'examples/live/simulated-soroswap-swap.json', // relative → POLICYWRIGHT_ROOT
      account: SIM_SOURCE,
    });
    expect(out.source).toBe('simulation');
    expect(out.summary.hash).toBeNull();
    expect(out.summary.calls).toEqual([
      { contract: ROUTER, fnName: 'swap_exact_tokens_for_tokens', sourceHash: null },
    ]);
    expect(out.summary.flows.map((f) => [f.contractId, f.direction, f.amount, f.resolved])).toEqual(
      [
        [XLM_SAC, 'out', '10000000', true],
        [SIM_TOKEN, 'in', '316046', false], // not a token the stub knows → explicit fallback
      ],
    );
    expect(out.warnings.some((w) => w.includes(SIM_TOKEN))).toBe(true);
    const inline = await ok('record', {
      simulation: readJson(live('simulated-soroswap-swap.json')),
      account: SIM_SOURCE,
    });
    expect(inline.recording).toEqual(out.recording);
  });

  it('TX_NOT_FOUND for a hash outside the node’s retention window', async () => {
    const error = await fail('record', { hashes: ['0'.repeat(64)] });
    expect(error.error.code).toBe('TX_NOT_FOUND');
    expect(error.error.source).toBe('RecorderError');
    expect(error.error.message).toContain('retain');
  });

  it('BAD_INPUT for contradictory or empty inputs', async () => {
    const both = await fail('record', {
      hashes: [CLAIM_HASH],
      simulationPath: 'examples/live/simulated-soroswap-swap.json',
    });
    expect(both.error.code).toBe('BAD_INPUT');
    const neither = await fail('record', {});
    expect(neither.error.code).toBe('BAD_INPUT');
    const duplicate = await fail('record', { hashes: [CLAIM_HASH, CLAIM_HASH.toUpperCase()] });
    expect(duplicate.error.code).toBe('BAD_INPUT');
    expect(duplicate.error.source).toBe('RecorderError');
  });

  it('NETWORK when the RPC endpoint is unreachable (per-call rpcUrl override)', async () => {
    const error = await fail('record', { hashes: [CLAIM_HASH], rpcUrl: 'http://127.0.0.1:9' });
    expect(error.error.code).toBe('NETWORK');
  });

  it('refuses to read environment files and never echoes file content', async () => {
    const env = await fail('record', { simulationPath: '.env.json' });
    expect(env.error.message).toContain('refusing to read or write an environment file');
    const missing = await fail('record', { simulationPath: 'examples/live/does-not-exist.json' });
    expect(missing.error.code).toBe('BAD_INPUT');
    expect(missing.error.message).toMatch(/could not read .*ENOENT/);
    // A non-JSON file: Node's own SyntaxError would quote its first bytes.
    const sentinel = 'SENTINEL-DO-NOT-ECHO-7f3a9c';
    const notJson = join(scratch, 'not-json.json');
    writeFileSync(notJson, `STELLAR_SECRET_KEY=${sentinel}\n`);
    const parseFail = await fail('synthesize', { recordingPath: notJson });
    expect(parseFail.error.code).toBe('BAD_INPUT');
    expect(parseFail.error.message).toMatch(/is not valid JSON$/);
    expect(JSON.stringify(parseFail)).not.toContain(sentinel);
  });

  it('never replaces an existing outPath unless overwrite is true', async () => {
    const target = join(scratch, 'twice.json');
    await ok('record', { hashes: [CLAIM_HASH], account: SUBJECT, outPath: target });
    const refused = await fail('record', {
      hashes: [CLAIM_HASH],
      account: SUBJECT,
      outPath: target,
    });
    expect(refused.error.code).toBe('BAD_INPUT');
    expect(refused.error.message).toContain('already exists');
    const replaced = await ok('record', {
      hashes: [CLAIM_HASH],
      account: SUBJECT,
      outPath: target,
      overwrite: true,
    });
    expect(replaced.outPath).toBe(target);
  });

  it('redacts credentials and query strings from echoed RPC URLs and error messages', async () => {
    const keyed = 'http://user:hunter2@127.0.0.1:9/rpc?token=abc123';
    const error = await fail('record', { hashes: [CLAIM_HASH], rpcUrl: keyed });
    expect(error.error.code).toBe('NETWORK');
    expect(JSON.stringify(error)).not.toContain('hunter2');
    expect(JSON.stringify(error)).not.toContain('abc123');
    expect(error.error.message).toContain('http://127.0.0.1:9/rpc');
  });
});

// ---------------------------------------------------------------------------
// synthesize
// ---------------------------------------------------------------------------

describe('synthesize', () => {
  const targets = committedInstallTargets();

  it('reproduces every committed artifact in examples/live/fresh/ from the recording', async () => {
    const outDir = join(scratch, 'fresh');
    const out = await ok('synthesize', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
      installTargets: targets,
      outDir,
    });
    expect(out.contextRule).toEqual(readJson(live('fresh/context-rule.json')));
    expect(out.contextRule['schemaVersion']).toBe(CONTEXT_RULE_SCHEMA_VERSION);
    expect(out.spec).toEqual(readJson(live('fresh/spec.json')));
    expect(out.summary).toBe(read(live('fresh/summary.txt')));
    // Written to outDir → the ~11 KB source is not repeated inline unless asked for.
    expect(out.rustPolicy.source).toBeUndefined();
    expect(out.rustPolicy.path).toBe(join(outDir, 'FrequencyLimitPolicy.rs'));
    expect(out.rustPolicy.sourceBytes).toBe(
      Buffer.byteLength(read(live('fresh/FrequencyLimitPolicy.rs')), 'utf8'),
    );
    for (const name of [
      'summary.txt',
      'spec.json',
      'context-rule.json',
      'FrequencyLimitPolicy.rs',
    ]) {
      expect(read(join(outDir, name))).toBe(read(live(`fresh/${name}`)));
    }
    const inline = await ok('synthesize', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
      installTargets: targets,
      outDir,
      overwrite: true,
      includeRustSource: true,
    });
    expect(inline.rustPolicy.source).toBe(read(live('fresh/FrequencyLimitPolicy.rs')));
    const refused = await fail('synthesize', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
      installTargets: targets,
      outDir,
    });
    expect(refused.error.code).toBe('BAD_INPUT');
    expect(refused.error.message).toContain('already exists');
    expect(out.files?.map((f) => f.split('/').pop())).toEqual([
      'summary.txt',
      'spec.json',
      'context-rule.json',
      'FrequencyLimitPolicy.rs',
    ]);
    expect(out.installable).toEqual({ asIs: true, violations: [] });
    expect(out.now).toBe(1_786_166_112); // the recording timestamp: deterministic, no clock
  });

  it('carries the unaudited banner verbatim on every output containing generated code', async () => {
    const out = await ok('synthesize', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
    });
    expect(out.unauditedBanner).toBe(
      'Generated contracts are illustrative and unaudited — not for production deployment until the Audit Bank audit.',
    );
    expect(out.rustPolicy.unaudited).toBe(true);
    expect(out.rustPolicy.banner).toBe(ILLUSTRATIVE_HEADER);
    expect(out.rustPolicy.source?.startsWith(ILLUSTRATIVE_HEADER)).toBe(true); // inline: no outDir
    expect(out.summary).toContain('ILLUSTRATIVE and\nUNAUDITED');
  });

  it('surfaces the notes/warnings channel: deltas, minimal-permission decisions, install gaps', async () => {
    const out = await ok('synthesize', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
    });
    expect(out.installable.asIs).toBe(false);
    expect(out.installable.violations.map((v) => v.path)).toEqual([
      'contextRules[0].policies[0].address',
      'contextRules[1].policies[0].address',
      'contextRules[2].policies[0].address',
      'contextRules[2].policies[0]', // E2: spending_limit with no signer can never authorize
    ]);
    expect(out.installable.violations[3]?.ozError).toBe('NotAllowed (at enforce)');
    expect(out.notes.some((n) => n.startsWith('DELTA:'))).toBe(true);
    expect(out.scopeNotes.some((n) => n.startsWith('USDC: no spend cap emitted'))).toBe(true);
    expect(out.scopeNotes.some((n) => n.includes('at an estimated 5 s/ledger'))).toBe(true);
    // One note per distinct asset, decided from the spec's spending-limit policies alone.
    expect(out.scopeNotes.filter((n) => /^(BLND|USDC):/.test(n))).toHaveLength(2);
    // The permission surface is the emitted rules — all three, including the token rule.
    expect(out.scopeNotes.filter((n) => n.startsWith('Rule pw:'))).toHaveLength(3);
    expect(
      out.scopeNotes.some((n) => n.startsWith(`Rule pw:xfer:BLND: CallContract(${BLND})`)),
    ).toBe(true);
    expect(out.scopeNotes.some((n) => n.startsWith('Dry-run model:'))).toBe(true);
    expect(
      out.scopeNotes.some((n) => n.startsWith('BLND: outflow capped at 2.3533505 per 86400s')),
    ).toBe(true);
    expect(out.scopeNotes.some((n) => n.includes('ADVISORY'))).toBe(true);
    expect(out.realisations.map((r) => r.kind)).toEqual(['composed', 'generated']);
    expect(out.warnings).toEqual([]);
    expect(out.recordingWarnings).toEqual([]);
  });

  it('is pure: the same inline recording gives the same output, and config/targets change it deterministically', async () => {
    const recording = readJson(live('recorded-claim-swap-fresh.json')) as Record<string, unknown>;
    const a = await ok('synthesize', { recording, installTargets: targets });
    const b = await ok('synthesize', { recording, installTargets: targets });
    expect(a).toEqual(b);
    const enforced = await ok('synthesize', {
      recording,
      installTargets: targets,
      config: { constrainArguments: true, lifetimeSecs: 604_800 },
    });
    expect(enforced.config.constrainArguments).toBe(true);
    expect(enforced.config.lifetimeSecs).toBe(604_800);
    expect(enforced.scopeNotes.some((n) => n.includes('ENFORCED'))).toBe(true);
    expect(
      (enforced.contextRule['contextRules'] as { lifetimeLedgers: number }[])[0]?.lifetimeLedgers,
    ).toBe(120_960);
  });

  it('BAD_INPUT from the synthesizer’s own validation (SynthError) and from a malformed recording', async () => {
    const bad = await fail('synthesize', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
      config: { capMultiplier: 0 },
    });
    expect(bad.error.code).toBe('BAD_INPUT');
    expect(bad.error.source).toBe('SynthError');
    const malformed = await fail('synthesize', { recording: { hash: null } });
    expect(malformed.error.code).toBe('BAD_INPUT');
    expect(malformed.error.source).toBe('RecorderError');
    const whole = await ok('record', { hashes: [CLAIM_HASH], account: SUBJECT });
    const wrapped = await fail('synthesize', {
      recording: whole,
    });
    expect(wrapped.error.message).toContain('pass its `recording` field');
    const missing = await fail('synthesize', {
      recordingPath: 'examples/live/does-not-exist.json',
    });
    expect(missing.error.code).toBe('BAD_INPUT');
    expect(missing.error.message).toContain('ENOENT');
  });
});

// ---------------------------------------------------------------------------
// simulate
// ---------------------------------------------------------------------------

describe('simulate', () => {
  it('reproduces both committed dry-run reports and returns the table as data', async () => {
    const advisory = await ok('simulate', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
    });
    expect(`${advisory.report}\n`).toBe(read(live('simulation-report.md')));
    expect(advisory.warnings).toEqual([]);
    expect(advisory.constrainArguments).toBe(false);
    expect(advisory.deviations).toBe(0);
    expect(advisory.counts).toEqual({ permit: 1, deny: 4, flag: 1 });
    expect(advisory.results.every((r) => r.asExpected === true)).toBe(true);
    expect(advisory.probeToken.contractId).toBe(XLM_SAC);
    const flagged = advisory.results.find((r) => r.decision === 'flag');
    expect(flagged?.reasonCode).toBe('argument-constraint');
    expect(flagged?.label).toContain('BLND→XLM');

    const enforced = await ok('simulate', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
      config: { constrainArguments: true },
    });
    expect(`${enforced.report}\n`).toBe(read(live('simulation-report.constrained.md')));
    expect(enforced.counts).toEqual({ permit: 1, deny: 5, flag: 0 });
  });

  it('evaluates caller-supplied candidates in the candidate-call format', async () => {
    const recording = readJson(live('recorded-claim-swap-fresh.json')) as {
      calls: { args: unknown[] }[];
    };
    const swapArgs = recording.calls[1]?.args ?? [];
    const out = await ok('simulate', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
      standardScenarios: false,
      candidates: [
        {
          label: 'BLND→XLM via the real swap args',
          contract: ROUTER,
          fnName: 'swap_exact_tokens_for_tokens',
          args: swapArgs.map((a, i) => (i === 2 ? [BLND, XLM_SAC] : a)),
          outflows: [{ contractId: BLND, amount: '21394095' }],
        },
        {
          label: 'over the BLND cap',
          contract: ROUTER,
          fnName: 'swap_exact_tokens_for_tokens',
          outflows: [{ contractId: BLND, amount: '23533506' }],
        },
        { label: 'unscoped contract', contract: BLND, fnName: 'transfer' },
      ],
    });
    expect(out.results.map((r) => [r.decision, r.reasonCode])).toEqual([
      ['flag', 'argument-constraint'],
      ['deny', 'spending-limit'],
      ['deny', 'scope'],
    ]);
    expect(out.results.every((r) => r.expected === undefined)).toBe(true);
    expect(out.deviations).toBe(0);
    expect(out.tokens.map((t) => t.label)).toEqual(['BLND', 'USDC', 'XLM']);
    // The second candidate carries no args, so its swap-path constraint was not evaluated — said so.
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('candidate "over the BLND cap"');
    expect(out.warnings[0]).toContain('NOT evaluated');
  });

  it('honours a probe-token override', async () => {
    const out = await ok('simulate', {
      recordingPath: 'examples/live/recorded-claim-swap-fresh.json',
      probeToken: SIM_TOKEN,
    });
    expect(out.probeToken).toEqual({
      contractId: SIM_TOKEN,
      label: 'probe',
      provenance: 'supplied via --probe-token',
    });
  });
});

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

describe('verify', () => {
  it('reproduces the committed PASS report for the testnet smart account (15 rows)', async () => {
    const out = await ok('verify', {
      artifactPath: 'examples/live/fresh/context-rule.json',
      account: ACCOUNT,
      installLogPath: 'examples/live/testnet/install-20260902T105742Z.json',
    });
    expect(out.pass).toBe(true);
    expect(out.latestLedger).toBe(VERIFY_LEDGER);
    expect(out.rows).toHaveLength(15);
    expect(out.rows.every((r) => r.ok)).toBe(true);
    expect(`${out.report}\n`).toBe(read(live('testnet/verify.md')));
    expect(out.extraRules.map((r) => [r.id, r.name])).toEqual([[0, 'multisig']]);
    expect(out.warnings).toEqual([]);
    expect(out.artifactViolations).toEqual([]);
    expect(out.rpcUrl).toBe(stub.url);
  });

  it('accepts the artifact and install log inline (as synthesize/verify hand them around)', async () => {
    const out = await ok('verify', {
      artifact: readJson(live('fresh/context-rule.json')),
      account: ACCOUNT,
      installLog: readJson(live('testnet/install-20260902T105742Z.json')),
    });
    expect(out.pass).toBe(true);
  });

  it('FAILs against an account that has only its admin rule, naming each missing rule', async () => {
    const out = await ok('verify', {
      artifactPath: 'examples/live/fresh/context-rule.json',
      account: EMPTY_ACCOUNT,
    });
    expect(out.pass).toBe(false);
    expect(out.rows.map((r) => [r.rule, r.actual])).toEqual([
      ['pw:claim', 'not installed'],
      ['pw:swap', 'not installed'],
      ['pw:xfer:BLND', 'not installed'],
    ]);
    expect(out.extraRules.map((r) => r.id)).toEqual([0]);
    expect(out.report.startsWith('# policywright verify — FAIL')).toBe(true);
  });

  it('BAD_INPUT for an account whose checksum is invalid (shape-valid but not a StrKey)', async () => {
    const error = await fail('verify', {
      artifactPath: 'examples/live/fresh/context-rule.json',
      account: `C${'A'.repeat(55)}`,
    });
    expect(error.error.code).toBe('BAD_INPUT');
    expect(error.error.message).toContain('checksum');
  });

  it('SHAPE_INVALID for a document that is not a context-rule artifact; BAD_INPUT for a bad install log', async () => {
    const shape = await fail('verify', { artifact: { foo: 1 }, account: ACCOUNT });
    expect(shape.error.code).toBe('SHAPE_INVALID');
    const log = await fail('verify', {
      artifactPath: 'examples/live/fresh/context-rule.json',
      account: ACCOUNT,
      installLog: { results: [{ rule: 'x' }] },
    });
    expect(log.error.code).toBe('BAD_INPUT');
    expect(log.error.source).toBe('InstallError');
  });

  it('NETWORK when the endpoint is unreachable', async () => {
    const error = await fail('verify', {
      artifactPath: 'examples/live/fresh/context-rule.json',
      account: ACCOUNT,
      rpcUrl: 'http://127.0.0.1:9',
    });
    expect(error.error.code).toBe('NETWORK');
    expect(error.error.source).toBe('InstallError');
  });
});

// ---------------------------------------------------------------------------
// Secrets and error mapping
// ---------------------------------------------------------------------------

describe('secrets hygiene', () => {
  it('never reads or echoes STELLAR_SECRET_KEY, and needs no secret', async () => {
    const outputs = await Promise.all([
      call('record', { hashes: [CLAIM_HASH], account: SUBJECT }),
      call('synthesize', { recordingPath: 'examples/live/recorded-claim-swap-fresh.json' }),
      call('simulate', { recordingPath: 'examples/live/recorded-claim-swap-fresh.json' }),
      call('verify', { artifactPath: 'examples/live/fresh/context-rule.json', account: ACCOUNT }),
      call('record', { simulationPath: '.env.json' }),
      call('verify', {
        artifactPath: 'examples/live/fresh/context-rule.json',
        account: ACCOUNT,
        rpcUrl: `http://k:${FAKE_SECRET}@127.0.0.1:9/`,
      }),
    ]);
    const text = JSON.stringify(outputs);
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).not.toContain('STELLAR_SECRET_KEY');
    expect(configFromEnv({ STELLAR_SECRET_KEY: FAKE_SECRET })).toEqual({
      network: 'testnet',
      rpcUrl: undefined,
      root: expect.stringMatching(/\/$/) as string,
    });
    expect(existsSync(join(ROOT, 'src', 'mcp', 'server.ts'))).toBe(true);
    // Structural: of src/install.ts the tool module imports only the error class,
    // and the server entry does not import it at all.
    const tools = read(join(ROOT, 'src', 'mcp', 'tools.ts'));
    const installImports = [...tools.matchAll(/import \{([^}]*)\} from '\.\.\/install\.js'/g)].map(
      (m) => (m[1] ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(installImports).toEqual(['InstallError']);
    expect(read(join(ROOT, 'src', 'mcp', 'server.ts'))).not.toContain("from '../install.js'");
    expect(read(join(ROOT, 'src', 'mcp', 'schemas.ts'))).not.toContain("from '../install.js'");
  });
});

describe('error mapping (unit)', () => {
  it('maps every typed taxonomy onto the envelope codes', () => {
    expect(
      toToolError(new RecorderError('DECODE_FAILED', 'bad xdr', 'TransactionEnvelope')).error,
    ).toEqual({
      code: 'DECODE_FAILED',
      message: '[DECODE_FAILED] (TransactionEnvelope) bad xdr',
      source: 'RecorderError',
      section: 'TransactionEnvelope',
    });
    expect(toToolError(new SynthError('cap')).error.code).toBe('BAD_INPUT');
    expect(toToolError(new Error('boom')).error).toEqual({
      code: 'INTERNAL',
      message: 'boom',
      source: 'Error',
    });
    expect(toToolError('string').error.code).toBe('INTERNAL');
    for (const envelope of [toToolError(new Error('x'))]) {
      expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    }
  });

  it('reads only its three variables from the environment', () => {
    expect(
      configFromEnv({
        POLICYWRIGHT_NETWORK: 'futurenet',
        POLICYWRIGHT_RPC_URL: 'http://x',
        POLICYWRIGHT_ROOT: '/r',
      }),
    ).toEqual({
      network: 'futurenet',
      rpcUrl: 'http://x',
      root: '/r',
    });
    expect(() => configFromEnv({ POLICYWRIGHT_NETWORK: 'devnet' })).toThrow(/POLICYWRIGHT_NETWORK/);
  });
});
