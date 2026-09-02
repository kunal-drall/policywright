/**
 * The MCP server's structured I/O contracts: one Zod schema per tool input
 * and output, plus the shared error envelope. These are the single source of
 * truth — the server advertises them as JSON Schema (draft 2020-12) in
 * `tools/list`, and `npm run mcp:schemas` writes the same JSON Schema to
 * `schemas/mcp/` for reviewers (CI checks the committed copies do not drift).
 *
 * Versioning: every input accepts and every output carries
 * `schemaVersion` = {@link MCP_SCHEMA_VERSION}. Artifacts embedded in outputs
 * keep their own version — `contextRule.schemaVersion` is the
 * `context-rule.json` schema version ({@link CONTEXT_RULE_SCHEMA_VERSION}).
 *
 * Shapes are deliberately thin where a library validator already exists
 * (`parseRecordedJson`, `validateConfig`, `parseContextRuleDocument`): the
 * schema guards the wire, the library guards the semantics, and a semantic
 * failure surfaces as a typed error envelope rather than a schema error.
 */

import { z } from 'zod';
import { CONTEXT_RULE_SCHEMA_VERSION, DEFAULT_SYNTH_CONFIG } from '../types.js';

/** The MCP I/O schema version. Bump on any change to a tool's input or output shape. */
export const MCP_SCHEMA_VERSION = 1;

/** The banner every output containing generated code carries, verbatim. */
export const UNAUDITED_BANNER =
  'Generated contracts are illustrative and unaudited — not for production deployment until the Audit Bank audit.';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const schemaVersionIn = z
  .number()
  .int()
  .optional()
  .describe(
    `MCP I/O schema version of this input. Optional; when present it must be ${MCP_SCHEMA_VERSION}.`,
  );

const schemaVersionOut = z
  .literal(MCP_SCHEMA_VERSION)
  .describe('MCP I/O schema version of this output.');

export const NetworkSchema = z
  .enum(['testnet', 'mainnet', 'futurenet'])
  .describe(
    'Stellar network. Defaults to the server configuration (POLICYWRIGHT_NETWORK, testnet).',
  );

const rpcUrl = z
  .url()
  .describe(
    'Soroban RPC endpoint override for this call. Defaults to the server configuration (POLICYWRIGHT_RPC_URL) or the public endpoint for the network.',
  );

const txHash = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/)
  .describe('A 64-hex transaction hash.');

const contractAddress = z
  .string()
  .regex(/^C[A-Z2-7]{55}$/)
  .describe('A Soroban contract address (C… StrKey).');

const anyAddress = z
  .string()
  .regex(/^[GC][A-Z2-7]{55}$/)
  .describe('A Stellar account (G…) or contract (C…) address.');

const jsonPath = z
  .string()
  .min(1)
  .regex(/\.json$/)
  .describe(
    'Path to a .json file the server reads: absolute, or relative to the repository root (POLICYWRIGHT_ROOT).',
  );

const hexBytes = z.string().regex(/^([0-9a-fA-F]{2})+$/);

/** A rule signer in the real OpenZeppelin `Signer` shape (storage.rs:96-102). */
export const SignerSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('Delegated'), address: anyAddress }).strict(),
    z
      .object({
        type: z.literal('External'),
        verifier: contractAddress,
        keyData: hexBytes.describe('Raw public-key bytes, hex (32 bytes for ed25519).'),
      })
      .strict(),
  ])
  .describe('A context-rule signer in the OpenZeppelin Signer shape.');

/** Synthesis knobs; anything omitted keeps the documented default. */
export const SynthConfigSchema = z
  .object({
    lifetimeSecs: z
      .number()
      .describe(`Context-rule lifetime in seconds (default ${DEFAULT_SYNTH_CONFIG.lifetimeSecs}).`)
      .optional(),
    spendWindowSecs: z
      .number()
      .describe(
        `Rolling spend-cap window in seconds (default ${DEFAULT_SYNTH_CONFIG.spendWindowSecs}).`,
      )
      .optional(),
    capMultiplier: z
      .number()
      .describe(
        `Cap = observed gross outflow × this, rounded up (default ${DEFAULT_SYNTH_CONFIG.capMultiplier}).`,
      )
      .optional(),
    frequencyWindowSecs: z
      .number()
      .describe(
        `Rolling frequency window in seconds (default ${DEFAULT_SYNTH_CONFIG.frequencyWindowSecs}).`,
      )
      .optional(),
    frequencyMaxCalls: z
      .number()
      .describe(
        `Max calls per frequency window (default ${DEFAULT_SYNTH_CONFIG.frequencyMaxCalls}).`,
      )
      .optional(),
    constrainArguments: z
      .boolean()
      .describe(
        'Enforce the derived argument constraints (swap-path token set): a violating route is DENIED. Default false: permitted and FLAGGED as a scope gap.',
      )
      .optional(),
  })
  .strict()
  .describe('Synthesis configuration overrides; omitted fields keep their defaults.');

const synthConfigOut = z
  .object({
    lifetimeSecs: z.number(),
    spendWindowSecs: z.number(),
    capMultiplier: z.number(),
    frequencyWindowSecs: z.number(),
    frequencyMaxCalls: z.number(),
    constrainArguments: z.boolean(),
  })
  .strict();

/** Deploy-time facts the emitted rules must carry to install as-is (schema v2). */
export const InstallTargetsSchema = z
  .object({
    signers: z
      .array(SignerSchema)
      .describe('Signers attached to every emitted rule (≤ 15).')
      .optional(),
    policyAddresses: z
      .object({
        'custom:FrequencyLimitPolicy': contractAddress.optional(),
        'stock:spending_limit': contractAddress.optional(),
      })
      .strict()
      .describe('Deployed policy contract address per binding kind.')
      .optional(),
    ledgerHead: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe(
        'Live ledger head at synthesis time; when given, validUntilLedger is emitted absolute (head + lifetime). Omit to emit the relative lifetimeLedgers only.',
      )
      .optional(),
  })
  .strict()
  .describe(
    'Deploy-time facts (signers, deployed policy addresses, ledger head). Without them the artifact is a design document and installable.asIs is false.',
  );

const installTargetsOut = z
  .object({
    signers: z.array(SignerSchema),
    policyAddresses: z
      .object({
        'custom:FrequencyLimitPolicy': contractAddress.optional(),
        'stock:spending_limit': contractAddress.optional(),
      })
      .strict(),
    ledgerHead: z.number().int().nullable(),
  })
  .strict();

const recordingObject = z
  .record(z.string(), z.unknown())
  .describe(
    'A RecordedTx exactly as the record tool returns it in `recording` (or as `npm run record` prints): bigints as decimal strings, bytes as hex:… strings.',
  );

const jsonObject = z.record(z.string(), z.unknown());

/** A JSON-decoded Soroban call argument (what scValToNative produces, JSON-safe). */
const callArg: z.ZodType<unknown> = z.unknown();

const outflowIn = z
  .object({
    contractId: contractAddress.describe('The token contract.'),
    amount: z
      .string()
      .regex(/^\d+$/)
      .describe('Amount in the token’s smallest unit, as a decimal string.'),
    symbol: z
      .string()
      .describe('Token symbol; defaults to the recording’s label for this token.')
      .optional(),
    decimals: z
      .number()
      .int()
      .nonnegative()
      .describe('Token decimals; defaults to the recording’s value for this token (7 if unknown).')
      .optional(),
  })
  .strict();

/** A candidate call for the dry run (the CandidateCall shape, JSON-safe). */
export const CandidateSchema = z
  .object({
    label: z.string().min(1).describe('Label shown in the report.'),
    contract: contractAddress.describe('Contract the candidate invokes.'),
    fnName: z.string().min(1).describe('Function the candidate invokes.'),
    args: z
      .array(callArg)
      .describe(
        'Positional arguments (JSON form). Required to exercise an argument constraint (e.g. the swap-path token set on swap_exact_tokens_for_tokens): copy recording.calls[i].args for that function and edit the constrained argument. When no array is present at the constrained index the constraint is NOT evaluated and the simulate output says so in warnings.',
      )
      .optional(),
    outflows: z.array(outflowIn).describe('Token outflows this candidate would cause.').optional(),
    timestamp: z
      .number()
      .int()
      .describe('Unix seconds the candidate executes at; defaults to 60 s into the rule lifetime.')
      .optional(),
    priorCallTimestamps: z
      .array(z.number().int())
      .describe(
        'Prior in-scope call timestamps (Unix seconds) for the frequency check; default none.',
      )
      .optional(),
  })
  .strict()
  .describe('A candidate call to evaluate against the synthesized policy set.');

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

/** Machine-readable failure codes, mapped from the existing typed taxonomies. */
export const ErrorCodeSchema = z.enum([
  'BAD_INPUT',
  'TX_NOT_FOUND',
  'NETWORK',
  'DECODE_FAILED',
  'SHAPE_INVALID',
  'INTERNAL',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** The `structuredContent` of every `isError: true` result. */
export const ErrorEnvelopeSchema = z
  .object({
    schemaVersion: schemaVersionOut,
    ok: z.literal(false),
    error: z
      .object({
        code: ErrorCodeSchema.describe('Machine-readable failure category.'),
        message: z
          .string()
          .describe('Human-readable, actionable message. Never contains a secret.'),
        source: z
          .string()
          .describe(
            'The typed error class this was mapped from (RecorderError, InstallError, SynthError, …).',
          ),
        section: z.string().describe('DECODE_FAILED only: the XDR section that failed.').optional(),
        details: z
          .unknown()
          .describe(
            'Structured details when the source carried them (InstallError details; the server’s own semantic checks). Absent for RecorderError, whose message is self-contained.',
          )
          .optional(),
      })
      .strict(),
  })
  .strict()
  .describe('Tool execution error envelope (the result has isError: true).');

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

export const RecordInputSchema = z
  .object({
    schemaVersion: schemaVersionIn,
    hashes: z
      .array(txHash)
      .min(1)
      .describe(
        'Transaction hashes to fetch and merge into ONE recording, in any order (Soroban allows one InvokeHostFunction per transaction, so a multi-step flow is several hashes). Exclusive with simulation/simulationPath.',
      )
      .optional(),
    simulation: jsonObject
      .describe(
        'A saved simulateTransaction exchange to ingest instead of fetching hashes (the shape scripts/capture-simulation.ts writes; request.params.transaction + response.result). Exclusive with hashes.',
      )
      .optional(),
    simulationPath: jsonPath
      .describe('Path to a saved simulateTransaction exchange (alternative to simulation).')
      .optional(),
    account: anyAddress
      .describe(
        'The account (G… or C…) token movements are attributed to. Pass it explicitly for smart-account flows; without it the first transaction’s source account is assumed and a warning records the assumption.',
      )
      .optional(),
    network: NetworkSchema.optional(),
    rpcUrl: rpcUrl.optional(),
    outPath: jsonPath
      .describe(
        'If given, also write the recording JSON to this path (what `npm run record` would print). An existing file is not replaced unless overwrite is true.',
      )
      .optional(),
    overwrite: z
      .boolean()
      .describe(
        'Allow outPath to replace an existing file (default false: an existing file is a BAD_INPUT).',
      )
      .optional(),
  })
  .strict();

const flowOut = z
  .object({
    contractId: contractAddress,
    symbol: z.string(),
    decimals: z.number().int(),
    resolved: z
      .boolean()
      .describe('Whether symbol/decimals came from on-chain metadata (false = fallback).'),
    direction: z.enum(['in', 'out']),
    amount: z.string().describe('Smallest-unit amount, decimal string.'),
    amountFormatted: z.string().describe('Human amount using the token decimals.'),
  })
  .strict();

export const RecordOutputSchema = z
  .object({
    schemaVersion: schemaVersionOut,
    ok: z.literal(true),
    source: z.enum(['rpc', 'simulation']).describe('Where the recording came from.'),
    network: NetworkSchema,
    rpcUrl: z.string().describe('The RPC endpoint that was used.'),
    recording: recordingObject.describe(
      'The RecordedTx. Pass this object (or write it with outPath and pass the path) to synthesize and simulate.',
    ),
    summary: z
      .object({
        hash: z
          .string()
          .nullable()
          .describe('Primary (earliest) transaction hash; null for a simulation.'),
        ledger: z.number().int().nullable(),
        timestamp: z
          .number()
          .int()
          .nullable()
          .describe('Unix seconds the first transaction was applied.'),
        subject: z.string().nullable().describe('The account movements are attributed to.'),
        calls: z
          .array(
            z
              .object({
                contract: contractAddress,
                fnName: z.string(),
                sourceHash: z.string().nullable(),
              })
              .strict(),
          )
          .describe('Observed contract calls in ledger order.'),
        flows: z
          .array(flowOut)
          .describe('Token movements relative to the subject, aggregated per (token, direction).'),
      })
      .strict(),
    warnings: z
      .array(z.string())
      .describe(
        'Recorder caveats (assumed subject, unresolved token metadata, skipped events). Surface these to the user.',
      ),
    outPath: z
      .string()
      .describe('Where the recording was written, when outPath was given.')
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// synthesize
// ---------------------------------------------------------------------------

const recordingInput = {
  recording: recordingObject.optional(),
  recordingPath: jsonPath
    .describe(
      'Path to a saved recording (e.g. examples/live/recorded-claim-swap-fresh.json). Alternative to recording.',
    )
    .optional(),
};

export const SynthesizeInputSchema = z
  .object({
    schemaVersion: schemaVersionIn,
    ...recordingInput,
    config: SynthConfigSchema.optional(),
    installTargets: InstallTargetsSchema.optional(),
    now: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Unix seconds used as the base of the rule lifetime. Defaults to the recording timestamp (the CLI’s rule), keeping the output deterministic.',
      )
      .optional(),
    outDir: z
      .string()
      .min(1)
      .describe(
        'If given, also write summary.txt, spec.json, context-rule.json and FrequencyLimitPolicy.rs into this directory (created if missing). Existing files are not replaced unless overwrite is true.',
      )
      .optional(),
    overwrite: z
      .boolean()
      .describe(
        'Allow outDir writes to replace existing files (default false: an existing file is a BAD_INPUT and nothing is written).',
      )
      .optional(),
    includeRustSource: z
      .boolean()
      .describe(
        'Include the full generated Rust source inline in rustPolicy.source (about 11 KB). Default: true when outDir is not given; false when the file was written to outDir (rustPolicy.path names it). The banner, fileName and sourceBytes are always present.',
      )
      .optional(),
  })
  .strict();

const violationOut = z
  .object({ path: z.string(), ozError: z.string(), message: z.string(), source: z.string() })
  .strict();

export const SynthesizeOutputSchema = z
  .object({
    schemaVersion: schemaVersionOut,
    ok: z.literal(true),
    unauditedBanner: z
      .literal(UNAUDITED_BANNER)
      .describe('Applies to rustPolicy. Show it whenever generated code is shown.'),
    spec: jsonObject.describe(
      'spec.json: the synthesized SmartAccountSpec (bigints as decimal strings).',
    ),
    contextRule: jsonObject.describe(
      `context-rule.json (schemaVersion ${CONTEXT_RULE_SCHEMA_VERSION}): the installable OpenZeppelin context rules with real policy install params. This is what the human installs with the CLI.`,
    ),
    summary: z.string().describe('summary.txt: the human-readable rundown.'),
    rustPolicy: z
      .object({
        fileName: z.literal('FrequencyLimitPolicy.rs'),
        banner: z
          .string()
          .describe('The ILLUSTRATIVE / UNAUDITED header the file starts with, verbatim.'),
        unaudited: z.literal(true),
        sourceBytes: z.number().int().describe('Size of the generated Rust source in bytes.'),
        source: z
          .string()
          .describe(
            'The generated Rust source (starts with the banner). Present unless it was written to outDir and includeRustSource was not set.',
          )
          .optional(),
        path: z
          .string()
          .describe('Where the source was written, when outDir was given.')
          .optional(),
      })
      .strict(),
    notes: z
      .array(z.string())
      .describe(
        'Composition deltas: unit conversions, constraints the stock policies cannot express, install-time obligations. Read these before installing.',
      ),
    warnings: z
      .array(z.string())
      .describe('Synthesis advisories (e.g. policy count over the OZ cap).'),
    recordingWarnings: z
      .array(z.string())
      .describe('The recorder caveats carried by the input recording.'),
    scopeNotes: z
      .array(z.string())
      .describe(
        'Minimal-permission decisions and scope gaps in plain language, derived from the spec (what is NOT permitted and why).',
      ),
    realisations: z
      .array(
        z
          .object({
            policy: z.string().describe('The policy, described.'),
            kind: z.enum(['composed', 'generated', 'offline-only']),
            via: z.string(),
            rules: z.array(z.string()).describe('Context rules the binding is attached to.'),
            because: z.string(),
          })
          .strict(),
      )
      .describe('How each policy is realised on-chain (compose-first decision per policy).'),
    installable: z
      .object({
        asIs: z.boolean().describe('Would the CLI install this artifact unmodified?'),
        violations: z
          .array(violationOut)
          .describe('What the install gate would refuse, naming the OZ error.'),
      })
      .strict(),
    config: synthConfigOut.describe('The effective synthesis configuration.'),
    installTargets: installTargetsOut.describe(
      'The deploy-time facts the rules were emitted with.',
    ),
    now: z.number().int().describe('The lifetime base that was used.'),
    outDir: z.string().optional(),
    files: z.array(z.string()).describe('Paths written, when outDir was given.').optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// simulate
// ---------------------------------------------------------------------------

export const SimulateInputSchema = z
  .object({
    schemaVersion: schemaVersionIn,
    ...recordingInput,
    config: SynthConfigSchema.optional(),
    now: z.number().int().nonnegative().describe('As for synthesize.').optional(),
    probeToken: contractAddress
      .describe(
        'Token the unobserved-route scenario routes through. Default: the network’s native XLM Stellar Asset Contract.',
      )
      .optional(),
    candidates: z.array(CandidateSchema).describe('Extra candidate calls to evaluate.').optional(),
    standardScenarios: z
      .boolean()
      .describe(
        'Include the standard scenario set (replay, over-cap, unseen fn, expiry, frequency, unobserved route). Default true.',
      )
      .optional(),
  })
  .strict();

const decision = z.enum(['permit', 'deny', 'flag']);

export const SimulateOutputSchema = z
  .object({
    schemaVersion: schemaVersionOut,
    ok: z.literal(true),
    constrainArguments: z
      .boolean()
      .describe('Whether argument constraints were enforced (deny) or advisory (flag).'),
    probeToken: z
      .object({ contractId: contractAddress, label: z.string(), provenance: z.string() })
      .strict(),
    results: z
      .array(
        z
          .object({
            label: z.string(),
            decision: decision.describe(
              'permit — every check passed; deny — the named check failed; flag — permitted, but an advisory argument constraint was violated (scope gap).',
            ),
            reasonCode: z
              .string()
              .describe(
                'scope | lifetime | argument-constraint | spending-limit | frequency-limit | permit',
              ),
            reason: z.string(),
            enforcedBy: z.string().describe('Which artifact realises the deciding check.'),
            expected: z.object({ decision, reasonCode: z.string() }).strict().optional(),
            asExpected: z
              .boolean()
              .describe('Standard scenarios only: did the decision match its expectation?')
              .optional(),
          })
          .strict(),
      )
      .describe('The permit/deny/flag table.'),
    counts: z
      .object({ permit: z.number().int(), deny: z.number().int(), flag: z.number().int() })
      .strict(),
    deviations: z
      .number()
      .int()
      .describe(
        'Standard scenarios whose decision deviated from expectation (0 = the harness self-check passed).',
      ),
    report: z
      .string()
      .describe('The Markdown dry-run report with provenance header, table, and token legend.'),
    tokens: z.array(z.object({ contractId: contractAddress, label: z.string() }).strict()),
    warnings: z
      .array(z.string())
      .describe(
        'Caveats about the evaluation — e.g. a caller-supplied candidate whose argument constraint could not be evaluated because it carries no array at the constrained index. Empty when nothing was skipped.',
      ),
    config: synthConfigOut,
  })
  .strict();

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

export const VerifyInputSchema = z
  .object({
    schemaVersion: schemaVersionIn,
    artifact: jsonObject
      .describe(
        'The emitted context-rule.json document (as synthesize returns in contextRule). Alternative to artifactPath.',
      )
      .optional(),
    artifactPath: jsonPath.describe('Path to an emitted context-rule.json.').optional(),
    account: contractAddress.describe('The OpenZeppelin smart account (C…) to read.'),
    installLog: jsonObject
      .describe(
        'A policywright install log; when given, valid_until is compared with what the install computed.',
      )
      .optional(),
    installLogPath: jsonPath
      .describe('Path to a policywright install log (alternative to installLog).')
      .optional(),
    network: NetworkSchema.optional(),
    rpcUrl: rpcUrl.optional(),
  })
  .strict();

const installedRuleOut = z
  .object({
    id: z.number().int(),
    contextType: z.object({ type: z.string(), contract: z.string().nullable() }).strict(),
    name: z.string(),
    signers: z.array(SignerSchema),
    policies: z.array(z.string()),
    validUntil: z.number().int().nullable(),
  })
  .strict();

export const VerifyOutputSchema = z
  .object({
    schemaVersion: schemaVersionOut,
    ok: z.literal(true),
    pass: z.boolean().describe('Every diff row matched.'),
    account: contractAddress,
    network: NetworkSchema,
    rpcUrl: z.string(),
    latestLedger: z.number().int().describe('The ledger the on-chain state was read at.'),
    rows: z
      .array(
        z
          .object({
            rule: z.string(),
            field: z.string(),
            expected: z.string(),
            actual: z.string(),
            ok: z.boolean(),
          })
          .strict(),
      )
      .describe('The diff, one row per (rule, field).'),
    extraRules: z
      .array(installedRuleOut)
      .describe(
        'Installed rules the artifact does not describe (e.g. the constructor’s admin rule). Informational.',
      ),
    report: z.string().describe('The Markdown verify report (PASS/FAIL).'),
    warnings: z.array(z.string()).describe('Policy params that could not be read back.'),
    artifactViolations: z
      .array(violationOut)
      .describe(
        'Schema/shape issues found in the artifact itself (checked as a design document, not for install).',
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type RecordInput = z.infer<typeof RecordInputSchema>;
export type RecordOutput = z.infer<typeof RecordOutputSchema>;
export type SynthesizeInput = z.infer<typeof SynthesizeInputSchema>;
export type SynthesizeOutput = z.infer<typeof SynthesizeOutputSchema>;
export type SimulateInput = z.infer<typeof SimulateInputSchema>;
export type SimulateOutput = z.infer<typeof SimulateOutputSchema>;
export type VerifyInput = z.infer<typeof VerifyInputSchema>;
export type VerifyOutput = z.infer<typeof VerifyOutputSchema>;

/** Every tool's I/O schema pair, in registration order. */
export const TOOL_SCHEMAS = {
  record: { input: RecordInputSchema, output: RecordOutputSchema },
  synthesize: { input: SynthesizeInputSchema, output: SynthesizeOutputSchema },
  simulate: { input: SimulateInputSchema, output: SimulateOutputSchema },
  verify: { input: VerifyInputSchema, output: VerifyOutputSchema },
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

/** The four tools, in registration order. There is deliberately no install/deploy tool. */
export const TOOL_NAMES: readonly ToolName[] = ['record', 'synthesize', 'simulate', 'verify'];
