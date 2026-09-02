/**
 * The four MCP tools as plain functions over the library: `record`,
 * `synthesize`, `simulate`, `verify`. Each takes a schema-validated input
 * (src/mcp/schemas.ts) and the server configuration, and returns either a
 * schema-conforming output or a typed error envelope.
 *
 * Tools wrap the library; no policy logic lives here. What this module adds
 * is the edge: reading `*Path` inputs, applying the server configuration,
 * mapping the existing typed errors (`RecorderError`, `InstallError`,
 * `SynthError`) onto the machine-readable codes of the envelope, and shaping
 * outputs for an agent (summaries, notes, verdicts).
 *
 * There is no install or deploy function here and nothing in this module can
 * sign or submit: of `src/install.ts` only the `InstallError` class is
 * imported — never the install planner, the rule installer, or a signing
 * surface (docs/mcp-server.md, "Code-first, deploy-second"; the import list
 * is asserted in test/mcp.test.ts).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrKey } from '@stellar/stellar-sdk';
import { describeBinding, describePolicy, emit, formatAmount } from '../emitter.js';
import { InstallError } from '../install.js';
import { parseContextRuleDocument, validateContextRuleDocument } from '../install-shape.js';
import { ILLUSTRATIVE_HEADER } from '../rust-policy.js';
import { evaluateScenarios } from '../simulate.js';
import { fallbackToken } from '../sources/decode.js';
import { RecorderError } from '../sources/errors.js';
import { parseRecordedJson, recordedTxToJson, recordedTxToJsonValue } from '../sources/recorded.js';
import { defaultRpcUrl, recordFromHashes, tokenResolverFor } from '../sources/rpc.js';
import { ingestSimulation } from '../sources/simulation.js';
import { SynthError, realisePolicies, synthesize } from '../synthesizer.js';
import {
  DEFAULT_SYNTH_CONFIG,
  ESTIMATED_SECS_PER_LEDGER,
  NO_INSTALL_TARGETS,
  type CandidateCall,
  type InstallTargets,
  type Network,
  type RecordedTx,
  type SmartAccountSpec,
  type SynthConfig,
} from '../types.js';
import { expectedValidUntilFromInstallLog, renderVerifyReport, verifyArtifact } from '../verify.js';
import {
  MCP_SCHEMA_VERSION,
  UNAUDITED_BANNER,
  type ErrorCode,
  type ErrorEnvelope,
  type RecordInput,
  type RecordOutput,
  type SimulateInput,
  type SimulateOutput,
  type SynthesizeInput,
  type SynthesizeOutput,
  type VerifyInput,
  type VerifyOutput,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Configuration (env/config, never hardcoded; never a secret)
// ---------------------------------------------------------------------------

/** Server configuration, read once from the environment. */
export interface ServerConfig {
  /** Network `record` and `verify` use unless a call overrides it. */
  readonly network: Network;
  /** RPC endpoint override; undefined = the library's public endpoint for the network. */
  readonly rpcUrl: string | undefined;
  /** Base directory for relative `*Path` inputs. */
  readonly root: string;
}

/** The repository root (this file lives at src/mcp/tools.ts). */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function parseNetwork(value: string | undefined): Network {
  if (value === undefined || value === '') {
    return 'testnet';
  }
  if (value !== 'testnet' && value !== 'mainnet' && value !== 'futurenet') {
    throw new Error(`POLICYWRIGHT_NETWORK must be testnet, mainnet, or futurenet (got "${value}")`);
  }
  return value;
}

/**
 * Read the configuration from an environment. Only three optional variables
 * are consulted; `STELLAR_SECRET_KEY` and friends are never read.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rpcUrl = env['POLICYWRIGHT_RPC_URL'];
  const root = env['POLICYWRIGHT_ROOT'];
  return {
    network: parseNetwork(env['POLICYWRIGHT_NETWORK']),
    rpcUrl: rpcUrl === undefined || rpcUrl === '' ? undefined : rpcUrl,
    root: root === undefined || root === '' ? REPO_ROOT : root,
  };
}

// ---------------------------------------------------------------------------
// Error mapping (existing taxonomies → envelope codes)
// ---------------------------------------------------------------------------

/** A semantic input failure detected at the edge (not by the wire schema). */
export class ToolInputError extends Error {
  override readonly name = 'ToolInputError';
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** Result of running a tool: a conforming output, or the error envelope. */
export type ToolOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ErrorEnvelope };

const INSTALL_CODES_REACHABLE: ReadonlySet<string> = new Set([
  'SHAPE_INVALID',
  'BAD_INPUT',
  'NETWORK',
]);

/** Map any thrown value onto the error envelope. Messages come from the typed errors. */
export function toToolError(error: unknown): ErrorEnvelope {
  const envelope = (
    code: ErrorCode,
    message: string,
    source: string,
    extra: { section?: string; details?: unknown } = {},
  ): ErrorEnvelope => ({
    schemaVersion: MCP_SCHEMA_VERSION,
    ok: false,
    error: {
      code,
      message,
      source,
      ...(extra.section === undefined ? {} : { section: extra.section }),
      ...(extra.details === undefined ? {} : { details: extra.details }),
    },
  });
  if (error instanceof ToolInputError) {
    return envelope(error.code, error.message, 'ToolInputError', { details: error.details });
  }
  if (error instanceof RecorderError) {
    return envelope(error.code, error.message, 'RecorderError', {
      ...(error.section === undefined ? {} : { section: error.section }),
    });
  }
  if (error instanceof InstallError) {
    const code: ErrorCode = INSTALL_CODES_REACHABLE.has(error.code)
      ? (error.code as ErrorCode)
      : 'INTERNAL';
    return envelope(code, error.message, 'InstallError', { details: error.details });
  }
  if (error instanceof SynthError) {
    return envelope('BAD_INPUT', error.message, 'SynthError');
  }
  const message = error instanceof Error ? error.message : String(error);
  return envelope('INTERNAL', message, error instanceof Error ? error.name : 'unknown');
}

/**
 * An RPC URL without credentials, query, or fragment — what outputs and
 * messages may show. A keyed provider URL (`https://user:token@host/…?key=…`)
 * would otherwise be echoed verbatim.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

/** Replace every verbatim occurrence of a URL that carries secrets with its redacted form. */
export function scrubUrls(message: string, urls: readonly (string | undefined)[]): string {
  let out = message;
  for (const url of urls) {
    if (url === undefined || url === '') {
      continue;
    }
    const redacted = redactUrl(url);
    if (redacted !== url) {
      out = out.split(url).join(redacted);
    }
  }
  return out;
}

/** Run a tool body, mapping any throw onto the envelope (with RPC URLs redacted). */
export async function runTool<T>(
  body: () => Promise<T> | T,
  urls: readonly (string | undefined)[] = [],
): Promise<ToolOutcome<T>> {
  try {
    return { ok: true, value: await body() };
  } catch (error) {
    const envelope = toToolError(error);
    return {
      ok: false,
      error: {
        ...envelope,
        error: { ...envelope.error, message: scrubUrls(envelope.error.message, urls) },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Edge helpers: schema version, paths, files
// ---------------------------------------------------------------------------

function checkSchemaVersion(version: number | undefined): void {
  if (version !== undefined && version !== MCP_SCHEMA_VERSION) {
    throw new ToolInputError(
      'BAD_INPUT',
      `unsupported schemaVersion ${version}; this server speaks MCP I/O schema version ${MCP_SCHEMA_VERSION}`,
    );
  }
}

/** Resolve a caller-supplied path against the configured root; refuse env files outright. */
export function resolveInputPath(config: ServerConfig, path: string): string {
  if (basename(path).startsWith('.env')) {
    throw new ToolInputError('BAD_INPUT', 'refusing to read or write an environment file');
  }
  return isAbsolute(path) ? path : resolve(config.root, path);
}

/**
 * Read and parse a JSON file. A parse failure is reported without echoing
 * the file's content (Node's SyntaxError message quotes the first bytes).
 */
export function readJsonFile(config: ServerConfig, path: string, what: string): unknown {
  const full = resolveInputPath(config, path);
  let raw: string;
  try {
    raw = readFileSync(full, 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? 'read error';
    throw new ToolInputError('BAD_INPUT', `could not read ${what} at ${full} (${code})`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ToolInputError('BAD_INPUT', `${what} at ${full} is not valid JSON`);
  }
}

/** Write an output file; an existing file is replaced only when the caller said so. */
function writeOutput(path: string, content: string, overwrite: boolean): void {
  if (!overwrite && existsSync(path)) {
    throw new ToolInputError(
      'BAD_INPUT',
      `${path} already exists; pass overwrite: true to replace it (or choose another path)`,
    );
  }
  writeFileSync(path, content);
}

function effectiveNetwork(config: ServerConfig, override: Network | undefined): Network {
  return override ?? config.network;
}

function effectiveRpcUrl(
  config: ServerConfig,
  network: Network,
  override: string | undefined,
): { readonly rpcUrl: string; readonly explicit: string | undefined } {
  const explicit = override ?? config.rpcUrl;
  return { rpcUrl: explicit ?? defaultRpcUrl(network), explicit };
}

/** Load the recording from `recording` or `recordingPath` (exactly one). */
function loadRecording(
  config: ServerConfig,
  input: { recording?: Record<string, unknown> | undefined; recordingPath?: string | undefined },
): RecordedTx {
  if (input.recording !== undefined && input.recordingPath !== undefined) {
    throw new ToolInputError('BAD_INPUT', 'pass either recording or recordingPath, not both');
  }
  if (input.recording !== undefined) {
    const inner = input.recording['recording'];
    if (input.recording['ok'] === true && typeof inner === 'object' && inner !== null) {
      throw new ToolInputError(
        'BAD_INPUT',
        'you passed the record tool’s whole result; pass its `recording` field (or write it with outPath and pass recordingPath)',
      );
    }
    return parseRecordedJson(input.recording);
  }
  if (input.recordingPath !== undefined) {
    return parseRecordedJson(readJsonFile(config, input.recordingPath, 'recording'));
  }
  throw new ToolInputError(
    'BAD_INPUT',
    'a recording is required: pass recording (the record tool’s output) or recordingPath',
  );
}

function mergeConfig(overrides: SynthesizeInput['config']): SynthConfig {
  const c = overrides ?? {};
  return {
    lifetimeSecs: c.lifetimeSecs ?? DEFAULT_SYNTH_CONFIG.lifetimeSecs,
    spendWindowSecs: c.spendWindowSecs ?? DEFAULT_SYNTH_CONFIG.spendWindowSecs,
    capMultiplier: c.capMultiplier ?? DEFAULT_SYNTH_CONFIG.capMultiplier,
    frequencyWindowSecs: c.frequencyWindowSecs ?? DEFAULT_SYNTH_CONFIG.frequencyWindowSecs,
    frequencyMaxCalls: c.frequencyMaxCalls ?? DEFAULT_SYNTH_CONFIG.frequencyMaxCalls,
    constrainArguments: c.constrainArguments ?? DEFAULT_SYNTH_CONFIG.constrainArguments,
  };
}

function toInstallTargets(targets: SynthesizeInput['installTargets']): InstallTargets {
  if (targets === undefined) {
    return NO_INSTALL_TARGETS;
  }
  const signers = targets.signers ?? [];
  const policyAddresses: InstallTargets['policyAddresses'] = {};
  const freq = targets.policyAddresses?.['custom:FrequencyLimitPolicy'];
  const spend = targets.policyAddresses?.['stock:spending_limit'];
  if (freq !== undefined) {
    policyAddresses['custom:FrequencyLimitPolicy'] = freq;
  }
  if (spend !== undefined) {
    policyAddresses['stock:spending_limit'] = spend;
  }
  const ledgerHead = targets.ledgerHead ?? null;
  if (signers.length === 0 && Object.keys(policyAddresses).length === 0 && ledgerHead === null) {
    return NO_INSTALL_TARGETS;
  }
  return { signers, policyAddresses, ledgerHead };
}

/** `now` for synthesis: the caller's value, else the recording timestamp (the CLI's rule). */
function lifetimeBase(input: { now?: number | undefined }, tx: RecordedTx): number {
  return input.now ?? tx.timestamp ?? 0;
}

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

export async function record(input: RecordInput, config: ServerConfig): Promise<RecordOutput> {
  checkSchemaVersion(input.schemaVersion);
  const network = effectiveNetwork(config, input.network);
  const { rpcUrl, explicit } = effectiveRpcUrl(config, network, input.rpcUrl);
  const hasHashes = input.hashes !== undefined;
  const hasSimulation = input.simulation !== undefined || input.simulationPath !== undefined;
  if (input.simulation !== undefined && input.simulationPath !== undefined) {
    throw new ToolInputError('BAD_INPUT', 'pass either simulation or simulationPath, not both');
  }
  if (hasHashes && hasSimulation) {
    throw new ToolInputError(
      'BAD_INPUT',
      'hashes cannot be combined with a simulation; record fetches hashes OR ingests one saved simulation',
    );
  }
  if (!hasHashes && !hasSimulation) {
    throw new ToolInputError(
      'BAD_INPUT',
      'record needs transaction hashes (hashes: [...]) or a saved simulateTransaction exchange (simulation / simulationPath)',
    );
  }
  // Resolve the output path before any network work so a bad path fails fast.
  const outPath = input.outPath === undefined ? undefined : resolveInputPath(config, input.outPath);
  if (outPath !== undefined && !(input.overwrite ?? false) && existsSync(outPath)) {
    throw new ToolInputError(
      'BAD_INPUT',
      `${outPath} already exists; pass overwrite: true to replace it (or choose another path)`,
    );
  }

  let tx: RecordedTx;
  if (input.hashes !== undefined) {
    tx = await recordFromHashes(input.hashes, {
      network,
      ...(explicit === undefined ? {} : { rpcUrl: explicit }),
      ...(input.account === undefined ? {} : { account: input.account }),
    });
  } else {
    const simulationDoc =
      input.simulation !== undefined
        ? input.simulation
        : readJsonFile(config, input.simulationPath as string, 'simulation file');
    tx = await ingestSimulation(simulationDoc, {
      network,
      ...(input.account === undefined ? {} : { account: input.account }),
      resolveToken: tokenResolverFor(network, explicit),
    });
  }

  if (outPath !== undefined) {
    writeOutput(outPath, `${recordedTxToJson(tx)}\n`, input.overwrite ?? false);
  }

  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    ok: true,
    source: tx.source === 'simulation' ? 'simulation' : 'rpc',
    network,
    rpcUrl: redactUrl(rpcUrl),
    recording: recordedTxToJsonValue(tx),
    summary: {
      hash: tx.hash,
      ledger: tx.ledger,
      timestamp: tx.timestamp,
      subject: tx.subject,
      calls: tx.calls.map((c) => ({
        contract: c.contract,
        fnName: c.fnName,
        sourceHash: c.sourceHash,
      })),
      flows: tx.flows.map((f) => ({
        contractId: f.asset.contractId,
        symbol: f.asset.symbol,
        decimals: f.asset.decimals,
        resolved: f.asset.resolved,
        direction: f.direction,
        amount: f.amount.toString(),
        amountFormatted: formatAmount(f.amount, f.asset.decimals),
      })),
    },
    warnings: [...tx.warnings],
    ...(outPath === undefined ? {} : { outPath }),
  };
}

// ---------------------------------------------------------------------------
// synthesize
// ---------------------------------------------------------------------------

/**
 * Plain-language minimal-permission decisions and scope gaps for an agent,
 * read off the spec only — what was emitted, never re-derived: an asset is
 * capped iff a spending-limit policy names it; the permission surface is
 * the emitted OZ context rules; the dry run's function-level model is stated
 * as the harness model it is. The recording contributes just the list of
 * assets it mentions.
 */
function scopeNotesFor(tx: RecordedTx, spec: SmartAccountSpec): string[] {
  const notes: string[] = [];
  const spendPolicies = new Map(
    spec.policies.flatMap((p) => (p.kind === 'spending-limit' ? [[p.asset.contractId, p]] : [])),
  );
  const seen = new Set<string>();
  for (const flow of tx.flows) {
    const id = flow.asset.contractId;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label = flow.asset.resolved ? flow.asset.symbol : `${flow.asset.symbol} (unresolved)`;
    const policy = spendPolicies.get(id);
    if (policy !== undefined) {
      notes.push(
        `${label}: outflow capped at ${formatAmount(policy.cap, policy.asset.decimals)} per ${policy.windowSecs}s (observed gross out ${formatAmount(policy.observedGrossOut, policy.asset.decimals)}, capMultiplier ${spec.config.capMultiplier}).`,
      );
    } else {
      notes.push(
        `${label}: no spend cap emitted — the synthesizer caps gross OUTFLOW only and found none for this asset (minimal permission: nothing moved out, nothing to cap).`,
      );
    }
  }
  for (const rule of spec.ozContextRules) {
    const policies =
      rule.policies.length === 0
        ? 'no policies'
        : rule.policies.map((b) => describeBinding(b)).join('; ');
    notes.push(
      `Rule ${rule.name}: CallContract(${rule.contextType.contract}) — authorizes calls on that contract, subject to ${policies}; observed function(s): ${rule.observedFns.join(', ') || '(none)'}. On-chain a rule binds the contract only (observedFns are advisory).`,
    );
  }
  notes.push(
    `Dry-run model: the offline harness scopes exactly the ${spec.contextRule.scopedCalls.length} observed (contract, function) pair(s) — ${spec.contextRule.scopedCalls.map((s) => `${s.fnName} @ ${s.contract.slice(0, 8)}…`).join(', ')} — and denies any other function or contract; the token rule(s) above are enforced on-chain by the bound policy, not modelled as scoped calls.`,
  );
  for (const scope of spec.argumentScopes) {
    notes.push(
      `Argument scope (${scope.rule}): ${scope.fnName} arg[${scope.argIndex}] (${scope.argName}) observed token set of ${scope.allowedTokens.length} — ${spec.config.constrainArguments ? 'ENFORCED: a route through any other token is denied in the dry run' : 'ADVISORY: a route through any other token is permitted and flagged as a scope gap; set config.constrainArguments to enforce'}. Offline-only until the argument-checking policy codegen exists.`,
    );
  }
  notes.push(
    `Lifetime: ${spec.config.lifetimeSecs}s (${spec.ozContextRules[0]?.lifetimeLedgers ?? '?'} ledgers at an estimated ${ESTIMATED_SECS_PER_LEDGER} s/ledger); frequency: at most ${spec.config.frequencyMaxCalls} call(s) per ${spec.config.frequencyWindowSecs}s.`,
  );
  return notes;
}

export function synthesizeTool(input: SynthesizeInput, config: ServerConfig): SynthesizeOutput {
  checkSchemaVersion(input.schemaVersion);
  const tx = loadRecording(config, input);
  const synthConfig = mergeConfig(input.config);
  const targets = toInstallTargets(input.installTargets);
  const now = lifetimeBase(input, tx);
  const spec = synthesize(tx, synthConfig, now, targets);
  const artifacts = emit(tx, spec);
  const contextRule = JSON.parse(artifacts.contextRuleJson) as Record<string, unknown>;
  const specJson = JSON.parse(artifacts.specJson) as Record<string, unknown>;
  const doc = parseContextRuleDocument(contextRule);
  const violations = validateContextRuleDocument(doc, { forInstall: true });

  let outDir: string | undefined;
  let files: string[] | undefined;
  if (input.outDir !== undefined) {
    outDir = resolveInputPath(config, input.outDir);
    mkdirSync(outDir, { recursive: true });
    const overwrite = input.overwrite ?? false;
    files = [
      join(outDir, 'summary.txt'),
      join(outDir, 'spec.json'),
      join(outDir, 'context-rule.json'),
      join(outDir, 'FrequencyLimitPolicy.rs'),
    ];
    // Check every target first so a refusal leaves the directory untouched.
    for (const file of files) {
      if (!overwrite && existsSync(file)) {
        throw new ToolInputError(
          'BAD_INPUT',
          `${file} already exists; pass overwrite: true to replace the files in ${outDir}`,
        );
      }
    }
    writeOutput(files[0] as string, artifacts.summary, overwrite);
    writeOutput(files[1] as string, `${artifacts.specJson}\n`, overwrite);
    writeOutput(files[2] as string, `${artifacts.contextRuleJson}\n`, overwrite);
    writeOutput(files[3] as string, artifacts.rustPolicy, overwrite);
  }
  const includeRustSource = input.includeRustSource ?? outDir === undefined;
  const rustPath = files?.[3];

  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    ok: true,
    unauditedBanner: UNAUDITED_BANNER,
    spec: specJson,
    contextRule,
    summary: artifacts.summary,
    rustPolicy: {
      fileName: 'FrequencyLimitPolicy.rs',
      banner: ILLUSTRATIVE_HEADER,
      unaudited: true,
      sourceBytes: Buffer.byteLength(artifacts.rustPolicy, 'utf8'),
      ...(includeRustSource ? { source: artifacts.rustPolicy } : {}),
      ...(rustPath === undefined ? {} : { path: rustPath }),
    },
    notes: [...spec.notes],
    warnings: [...spec.warnings],
    recordingWarnings: [...tx.warnings],
    scopeNotes: scopeNotesFor(tx, spec),
    realisations: realisePolicies(spec).map((r) => ({
      policy: describePolicy(r.policy),
      kind: r.kind,
      via: r.via,
      rules: [...r.rules],
      because: r.because,
    })),
    installable: { asIs: violations.length === 0, violations },
    config: spec.config,
    installTargets: {
      signers: [...spec.installTargets.signers],
      policyAddresses: { ...spec.installTargets.policyAddresses },
      ledgerHead: spec.installTargets.ledgerHead,
    },
    now,
    ...(outDir === undefined ? {} : { outDir }),
    ...(files === undefined ? {} : { files }),
  };
}

// ---------------------------------------------------------------------------
// simulate
// ---------------------------------------------------------------------------

function toCandidate(
  c: NonNullable<SimulateInput['candidates']>[number],
  tx: RecordedTx,
  spec: SmartAccountSpec,
): CandidateCall {
  const known = new Map(tx.flows.map((f) => [f.asset.contractId, f.asset]));
  const base = spec.contextRule.validUntil - spec.config.lifetimeSecs;
  return {
    label: c.label,
    contract: c.contract,
    fnName: c.fnName,
    args: (c.args ?? []) as CandidateCall['args'],
    outflows: (c.outflows ?? []).map((o) => {
      const fromRecording = known.get(o.contractId);
      const asset =
        fromRecording !== undefined && o.symbol === undefined && o.decimals === undefined
          ? fromRecording
          : {
              contractId: o.contractId,
              symbol: o.symbol ?? fromRecording?.symbol ?? fallbackToken(o.contractId).symbol,
              decimals:
                o.decimals ?? fromRecording?.decimals ?? fallbackToken(o.contractId).decimals,
              resolved: fromRecording?.resolved ?? false,
            };
      return { asset, direction: 'out' as const, amount: BigInt(o.amount) };
    }),
    timestamp: c.timestamp ?? base + 60,
    priorCallTimestamps: c.priorCallTimestamps ?? [],
  };
}

/**
 * The harness evaluates an argument constraint only when the candidate has an
 * array at the constrained index (src/simulate.ts `disallowedArgTokens`); a
 * caller-supplied candidate without one is silently "within limits". Say so.
 */
function unevaluatedConstraintWarnings(
  candidates: readonly CandidateCall[],
  spec: SmartAccountSpec,
): string[] {
  const warnings: string[] = [];
  for (const candidate of candidates) {
    for (const scope of spec.argumentScopes) {
      if (scope.contract !== candidate.contract || scope.fnName !== candidate.fnName) {
        continue;
      }
      if (!Array.isArray(candidate.args[scope.argIndex])) {
        warnings.push(
          `candidate "${candidate.label}": the ${scope.rule} constraint on ${scope.fnName} arg[${scope.argIndex}] (${scope.argName}) was NOT evaluated — no array argument at that index; copy the recorded call's args and edit arg[${scope.argIndex}] to exercise it.`,
        );
      }
    }
  }
  return warnings;
}

export function simulateTool(input: SimulateInput, config: ServerConfig): SimulateOutput {
  checkSchemaVersion(input.schemaVersion);
  const tx = loadRecording(config, input);
  const synthConfig = mergeConfig(input.config);
  const spec = synthesize(tx, synthConfig, lifetimeBase(input, tx));
  const candidates = (input.candidates ?? []).map((c) => toCandidate(c, tx, spec));
  const evaluation = evaluateScenarios(spec, tx, {
    ...(input.probeToken === undefined ? {} : { probeToken: input.probeToken }),
    candidates,
    ...(input.standardScenarios === undefined
      ? {}
      : { standardScenarios: input.standardScenarios }),
  });
  const counts = { permit: 0, deny: 0, flag: 0 };
  for (const row of evaluation.rows) {
    counts[row.result.decision] += 1;
  }
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    ok: true,
    constrainArguments: spec.config.constrainArguments,
    probeToken: evaluation.probe,
    results: evaluation.rows.map((row) => ({
      label: row.result.label,
      decision: row.result.decision,
      reasonCode: row.result.reasonCode,
      reason: row.result.reason,
      enforcedBy: row.result.enforcedBy,
      ...(row.expected === undefined
        ? {}
        : {
            expected: row.expected,
            asExpected:
              row.result.decision === row.expected.decision &&
              row.result.reasonCode === row.expected.reasonCode,
          }),
    })),
    counts,
    deviations: evaluation.deviations.length,
    report: evaluation.report,
    tokens: [...evaluation.labels].map(([contractId, label]) => ({ contractId, label })),
    warnings: unevaluatedConstraintWarnings(candidates, spec),
    config: spec.config,
  };
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

export async function verifyTool(input: VerifyInput, config: ServerConfig): Promise<VerifyOutput> {
  checkSchemaVersion(input.schemaVersion);
  if (!StrKey.isValidContract(input.account)) {
    throw new ToolInputError(
      'BAD_INPUT',
      `"${input.account}" is not a valid contract address (C… StrKey with a valid checksum)`,
    );
  }
  const network = effectiveNetwork(config, input.network);
  const { rpcUrl, explicit } = effectiveRpcUrl(config, network, input.rpcUrl);
  if (input.artifact !== undefined && input.artifactPath !== undefined) {
    throw new ToolInputError('BAD_INPUT', 'pass either artifact or artifactPath, not both');
  }
  if (input.installLog !== undefined && input.installLogPath !== undefined) {
    throw new ToolInputError('BAD_INPUT', 'pass either installLog or installLogPath, not both');
  }
  const raw =
    input.artifact !== undefined
      ? input.artifact
      : input.artifactPath !== undefined
        ? readJsonFile(config, input.artifactPath, 'artifact')
        : undefined;
  if (raw === undefined) {
    throw new ToolInputError(
      'BAD_INPUT',
      'an artifact is required: pass artifact (the synthesize tool’s contextRule) or artifactPath',
    );
  }
  let doc;
  try {
    doc = parseContextRuleDocument(raw);
  } catch (cause) {
    throw new ToolInputError('SHAPE_INVALID', (cause as Error).message);
  }
  const artifactViolations = validateContextRuleDocument(doc, { forInstall: false });

  const logDoc =
    input.installLog !== undefined
      ? input.installLog
      : input.installLogPath !== undefined
        ? readJsonFile(config, input.installLogPath, 'install log')
        : undefined;
  const expectedValidUntil =
    logDoc === undefined ? undefined : expectedValidUntilFromInstallLog(logDoc);

  const { report, warnings } = await verifyArtifact(doc, {
    network,
    account: input.account,
    ...(explicit === undefined ? {} : { rpcUrl: explicit }),
    ...(expectedValidUntil === undefined ? {} : { expectedValidUntil }),
  });

  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    ok: true,
    pass: report.pass,
    account: input.account,
    network,
    rpcUrl: redactUrl(rpcUrl),
    latestLedger: report.latestLedger,
    rows: [...report.rows],
    extraRules: report.extraRules.map((r) => ({
      id: r.id,
      contextType: r.contextType,
      name: r.name,
      signers: [...r.signers],
      policies: [...r.policies],
      validUntil: r.validUntil,
    })),
    report: renderVerifyReport(report),
    warnings: [...warnings],
    artifactViolations,
  };
}
