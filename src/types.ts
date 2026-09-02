/**
 * Core domain types for policywright.
 *
 * The pipeline is: a {@link RecordedTx} (captured from a fixture or the live RPC
 * adapter) is fed to the synthesizer, which produces a {@link SmartAccountSpec}
 * (an OpenZeppelin smart-account context rule plus a minimal set of policies).
 * The dry-run simulator then evaluates candidate calls against that spec.
 *
 * This module is the single source of truth for those shapes; every other module
 * imports from here. Keep it free of behaviour.
 */

/** Stellar networks we recognise. The live adapter only supports public networks. */
export type Network = 'testnet' | 'mainnet' | 'futurenet';

/**
 * A native-decoded Soroban contract argument.
 *
 * Mirrors what `scValToNative` produces: addresses/symbols/strings become
 * `string`, small ints become `number`, 64-bit-and-wider ints become `bigint`,
 * vectors become arrays, maps become objects, and raw bytes become `Uint8Array`.
 */
export type CallArg =
  | string
  | number
  | bigint
  | boolean
  | null
  | Uint8Array
  | readonly CallArg[]
  | { readonly [key: string]: CallArg };

/**
 * A reference to a token (a Soroban contract, typically a Stellar Asset Contract).
 *
 * `symbol`/`decimals` are resolved from on-chain SAC metadata when feasible. When
 * resolution is not possible (e.g. RPC unavailable, non-SAC token) the adapter
 * falls back to a best-effort label and sets `resolved` to `false` so downstream
 * output can say so explicitly rather than presenting a guess as fact.
 */
export interface TokenRef {
  /** The token's Soroban contract id (`C...`). */
  readonly contractId: string;
  /** Human-readable symbol, e.g. `USDC`. */
  readonly symbol: string;
  /** Token decimals (SEP-41 `decimals()`); 7 is the Stellar default. */
  readonly decimals: number;
  /** Whether `symbol`/`decimals` came from real metadata vs. a fallback. */
  readonly resolved: boolean;
}

/**
 * One node of a transaction's authorization-entry tree: an authorized contract
 * invocation together with the sub-invocations it was authorized to make.
 * Decoded from `SorobanAuthorizationEntry.rootInvocation` (see FACTS.md §3.2).
 */
export interface InvocationNode {
  /** Invoked contract address (`C...`). */
  readonly contract: string;
  /** Invoked function name (the Soroban symbol). */
  readonly fnName: string;
  /** Native-decoded arguments, in positional order. */
  readonly args: readonly CallArg[];
  /** Nested invocations authorized under this node, in tree order. */
  readonly subInvocations: readonly InvocationNode[];
}

/** A single observed contract invocation, scoped to a contract + function. */
export interface ScopedCall {
  /** Invoked contract address (`C...`). */
  readonly contract: string;
  /** Invoked function name (the Soroban symbol). */
  readonly fnName: string;
  /** Native-decoded arguments, in positional order. */
  readonly args: readonly CallArg[];
  /**
   * Hash of the transaction this invocation came from. In a multi-hash
   * recording each call keeps its own source hash; `null` for simulated
   * invocations, which have no on-chain transaction.
   */
  readonly sourceHash: string | null;
  /**
   * Authorization-entry trees attached to this invocation, when present.
   * These record what the signers *authorized* (including nested calls, e.g.
   * a router swap authorizing a token `transfer`), which the top-level
   * invocation alone cannot show. Empty when the source carries no
   * authorization entries (e.g. the offline fixture).
   */
  readonly authorizations: readonly InvocationNode[];
}

/** Direction of value movement relative to the smart account. */
export type FlowDirection = 'in' | 'out';

/** A single token movement into or out of the smart account during the tx. */
export interface AssetFlow {
  readonly asset: TokenRef;
  readonly direction: FlowDirection;
  /** Amount in the token's smallest unit (stroops-equivalent), always positive. */
  readonly amount: bigint;
}

/** Where a {@link RecordedTx} came from. */
export type RecordedTxSource = 'fixture' | 'rpc' | 'simulation';

/**
 * A normalised record of a transaction sequence the user already performed (or
 * simulated). This is the synthesizer's only input about what happened
 * on-chain.
 *
 * A recording may merge several transactions (Soroban allows one
 * `InvokeHostFunction` per transaction, so a claim→swap flow is multiple
 * hashes): calls are concatenated in ledger-close-time order, each keeping its
 * own {@link ScopedCall.sourceHash}, and flows are aggregated across the
 * sequence.
 */
export interface RecordedTx {
  /**
   * Primary transaction hash (hex): the earliest transaction in the sequence.
   * `null` for simulated recordings, which never touched the chain.
   */
  readonly hash: string | null;
  readonly network: Network;
  readonly source: RecordedTxSource;
  /** Ledger sequence the (first) tx was applied in, when known. */
  readonly ledger: number | null;
  /** Unix seconds the (first) tx was applied, when known. */
  readonly timestamp: number | null;
  /**
   * The account token movements are attributed to (`G...` or `C...`), when
   * known. Flows are directional relative to this account.
   */
  readonly subject: string | null;
  /** Distinct contract calls observed, in invocation order. */
  readonly calls: readonly ScopedCall[];
  /**
   * Token movements observed, derived from token movement events (`transfer`,
   * SAC `mint`/`burn`/`clawback`), aggregated per (token, direction) across
   * the sequence.
   */
  readonly flows: readonly AssetFlow[];
  /**
   * Non-fatal recording caveats (defaulted subject, unresolved token
   * metadata, skipped undecodable events). Never silently empty: anything the
   * recorder could not decode or had to assume is surfaced here.
   */
  readonly warnings: readonly string[];
}

/**
 * Knobs that shape synthesis. All have documented defaults
 * (see {@link DEFAULT_SYNTH_CONFIG}); the CLI exposes each as a flag.
 */
export interface SynthConfig {
  /** Context-rule lifetime in seconds (sets `valid_until` = synth time + this). */
  readonly lifetimeSecs: number;
  /** Rolling window, in seconds, the spend cap is measured over. */
  readonly spendWindowSecs: number;
  /** Multiplier applied to observed gross outflow to set each spend cap. */
  readonly capMultiplier: number;
  /** Rolling window, in seconds, for the frequency-limit policy. */
  readonly frequencyWindowSecs: number;
  /** Maximum calls permitted within {@link frequencyWindowSecs}. */
  readonly frequencyMaxCalls: number;
  /**
   * Argument-level scope (opt-in tightening; default `false`).
   *
   * Observed-argument constraints (see {@link ArgumentConstraintPolicy} and
   * the derivation rules in `src/synthesizer.ts`) are always *derived* and
   * recorded on the spec. When `true` they are also *enforced*: a candidate
   * violating one is denied in the dry run. When `false` they are advisory:
   * the same candidate is permitted and the report carries a scope-gap flag.
   */
  readonly constrainArguments: boolean;
}

/** OpenZeppelin smart accounts cap a context rule at this many policies. */
export const MAX_POLICIES = 5;

/**
 * Estimated seconds per Stellar ledger, used to convert configured
 * seconds-based windows into the ledger-based units the OZ contracts measure
 * in (`period_ledgers`, `valid_until`). A documented estimate, not a network
 * read: OZ's own `DAY_IN_LEDGERS = 17280` equals 86400 s at exactly this rate
 * (see docs/FACTS.md §2.4, RECONCILIATION rows 11 and 15).
 */
export const ESTIMATED_SECS_PER_LEDGER = 5;

/**
 * Version of the emitted `context-rule.json` schema. Bump on any change to
 * the emitted shape; the schema is documented in docs/context-rule-schema.md.
 *
 * v2 (D2.5, emitter fixes E1–E5): relative `lifetimeLedgers` per rule and an
 * absolute `validUntilLedger` only when a live ledger head was supplied;
 * signers in the real OZ `Signer` shape; deployed policy addresses; an
 * `installTargets` echo. v1 artifacts predate these fields.
 */
export const CONTEXT_RULE_SCHEMA_VERSION = 2;

/**
 * A rule signer in the real OpenZeppelin `Signer` shape
 * (`smart_account/storage.rs:96-102`): `Delegated(Address)` needs no
 * verifier; `External(verifier, key_data)` names a deployed verifier contract
 * and the raw public-key bytes (hex here; 32 bytes for ed25519).
 */
export type OzSigner =
  | { readonly type: 'Delegated'; readonly address: string }
  | { readonly type: 'External'; readonly verifier: string; readonly keyData: string };

/**
 * Deploy-time facts the emitter takes as INPUT so the artifact installs
 * as-is (RECONCILIATION-T2 E1–E3): the rule signers, the deployed policy
 * contract addresses, and the live ledger head. None is a synthesis knob;
 * all are echoed into `context-rule.json` for reproducibility.
 */
export interface InstallTargets {
  /** Signers attached to every emitted rule (E2). Empty = design artifact only. */
  readonly signers: readonly OzSigner[];
  /** Deployed policy contract address per binding kind (E3); missing → `null`. */
  readonly policyAddresses: Partial<Record<OzPolicyBinding['policy'], string>>;
  /**
   * Live ledger head at synthesis time (E1). When present, `validUntilLedger`
   * is emitted absolute (head + lifetime); otherwise it is `null` and the
   * installer adds `lifetimeLedgers` to the head it observes.
   */
  readonly ledgerHead: number | null;
}

/** No deploy-time facts: the artifact is a design document, not yet installable. */
export const NO_INSTALL_TARGETS: InstallTargets = {
  signers: [],
  policyAddresses: {},
  ledgerHead: null,
};

/**
 * The OpenZeppelin release every emitted install shape is verified against.
 * File:line citations to OZ sources in emitted artifacts are relative to this
 * commit; the custom frequency policy's `paramsSource` cites the in-repo
 * compiled crate (contracts/frequency-limit-policy) instead.
 */
export const OZ_TARGET = {
  package: 'stellar-accounts (OpenZeppelin/stellar-contracts)',
  version: 'v0.7.2',
  commit: 'a9c42169000638da937577f592ebf61a7a3c94ca',
  installEntryPoint:
    'SmartAccount::add_context_rule(context_type, name, valid_until, signers, policies: Map<Address, Val>) — packages/accounts/src/smart_account/mod.rs:238-248',
} as const;

/** Default synthesis configuration. Conservative but demo-friendly. */
export const DEFAULT_SYNTH_CONFIG: SynthConfig = {
  lifetimeSecs: 30 * 24 * 60 * 60, // 30 days
  spendWindowSecs: 24 * 60 * 60, // 1 day
  capMultiplier: 1.1, // 10% headroom over observed gross outflow
  frequencyWindowSecs: 24 * 60 * 60, // 1 day
  frequencyMaxCalls: 5,
  constrainArguments: false,
};

/** Discriminant tags for the policy union. */
export type PolicyKind = 'spending-limit' | 'frequency-limit' | 'argument-constraint';

/**
 * Bounds gross outflow of a single asset over a rolling window. Mirrors OZ's
 * `spending_limit` building block.
 */
export interface SpendingLimitPolicy {
  readonly kind: 'spending-limit';
  readonly asset: TokenRef;
  /** Cap in the asset's smallest unit, over `windowSecs`. */
  readonly cap: bigint;
  readonly windowSecs: number;
  /** Observed gross outflow the cap was derived from (for transparency). */
  readonly observedGrossOut: bigint;
}

/**
 * Bounds how often the scoped calls may run within a rolling window. Emitted as
 * the illustrative custom Rust policy.
 */
export interface FrequencyLimitPolicy {
  readonly kind: 'frequency-limit';
  readonly windowSecs: number;
  readonly maxCalls: number;
}

/**
 * Identifies the derivation rule that produced an {@link ArgumentConstraintPolicy}.
 * Rules are defined and documented in `src/synthesizer.ts`
 * (`ARGUMENT_DERIVATION_RULES`); `swap-path` is the only rule today.
 */
export type ArgumentRuleId = 'swap-path';

/**
 * Constrains a positional argument of a specific call to an observed allow-set.
 * Derived by one of the argument derivation rules (today: the swap `path`
 * token set). Always recorded on the spec as an observation; counted as an
 * enforced policy only when {@link SynthConfig.constrainArguments} is enabled.
 */
export interface ArgumentConstraintPolicy {
  readonly kind: 'argument-constraint';
  /** The derivation rule that produced this constraint. */
  readonly rule: ArgumentRuleId;
  /** Contract the constraint applies to. */
  readonly contract: string;
  /** Function the constraint applies to. */
  readonly fnName: string;
  /** Zero-based index of the constrained argument. */
  readonly argIndex: number;
  /** Human label for the argument (e.g. `path`). */
  readonly argName: string;
  /**
   * Allowed token contract ids observed for this argument (set semantics —
   * order, hop count, and amounts are not constrained). A candidate call
   * routing through any address outside this set violates the constraint:
   * denied when enforced, flagged when advisory.
   */
  readonly allowedTokens: readonly string[];
}

/** The synthesised policy set. */
export type PolicySpec = SpendingLimitPolicy | FrequencyLimitPolicy | ArgumentConstraintPolicy;

/**
 * A policy bound to an installable OZ context rule, in the shape
 * `add_context_rule` consumes: a policy contract address (unknown until
 * deployment, hence `null`) mapped to its install params. `installParams`
 * uses the REAL parameter names of the target contract; `paramsSource` cites
 * the file:line (at {@link OZ_TARGET}) the shape was verified against.
 */
export interface StockSpendingLimitBinding {
  readonly policy: 'stock:spending_limit';
  /** Deployed policy-wrapper contract address from {@link InstallTargets}; null when not supplied. */
  readonly address: string | null;
  /** Exact `SpendingLimitAccountParams` field names and types. */
  readonly installParams: {
    /** i128 — max spend within the period, smallest token unit. */
    readonly spending_limit: bigint;
    /** u32 — rolling window length in LEDGERS (not seconds). */
    readonly period_ledgers: number;
  };
  readonly paramsSource: string;
  /** How the params were derived from the recording (transparency). */
  readonly derivedFrom: {
    readonly asset: TokenRef;
    readonly observedGrossOut: bigint;
    readonly spendWindowSecs: number;
  };
}

/** The generated custom frequency policy, bound with its own install params. */
export interface CustomFrequencyLimitBinding {
  readonly policy: 'custom:FrequencyLimitPolicy';
  /** Deployed policy contract address from {@link InstallTargets}; null when not supplied. */
  readonly address: string | null;
  /** Exact `FrequencyLimitParams` field names of the generated Rust. */
  readonly installParams: {
    /** u64 — rolling window length in seconds. */
    readonly window_secs: number;
    /** u32 — max enforcements within the window. */
    readonly max_calls: number;
  };
  readonly paramsSource: string;
}

export type OzPolicyBinding = StockSpendingLimitBinding | CustomFrequencyLimitBinding;

/**
 * One installable OZ context rule. Mirrors what `add_context_rule` accepts
 * (see {@link OZ_TARGET}): a rule binds exactly ONE contract via
 * `CallContract` and carries no function names — the observed functions are
 * recorded in {@link observedFns} for review, and function-level narrowing
 * must live in a policy (RECONCILIATION row 14).
 */
export interface OzContextRule {
  readonly contextType: { readonly type: 'CallContract'; readonly contract: string };
  /** Rule name, capped at 20 BYTES (OZ `MAX_NAME_SIZE`). */
  readonly name: string;
  /**
   * The rule lifetime in LEDGERS: the configured `lifetimeSecs` at
   * {@link ESTIMATED_SECS_PER_LEDGER}. Always emitted (E1); the installer adds
   * it to the live ledger head when {@link validUntilLedger} is null.
   */
  readonly lifetimeLedgers: number;
  /**
   * `valid_until` as an absolute LEDGER SEQUENCE (u32): the live ledger head
   * supplied via {@link InstallTargets.ledgerHead} + {@link lifetimeLedgers}.
   * Null when no head was supplied — never derived from the recording ledger,
   * which is in the past (RECONCILIATION-T2 E1).
   */
  readonly validUntilLedger: number | null;
  /** Rule signers in the real OZ `Signer` shape (E2); empty when none were supplied. */
  readonly signers: readonly OzSigner[];
  /** Functions observed on this contract in the recording (advisory). */
  readonly observedFns: readonly string[];
  readonly policies: readonly OzPolicyBinding[];
}

/** The scope of the context rule: which (contract, fn) pairs are permitted. */
export interface ContextRule {
  /** Short human-readable rule name (OZ caps names at 20 bytes, `MAX_NAME_SIZE`). */
  readonly name: string;
  /** Exact (contract, fn) pairs the rule authorises. */
  readonly scopedCalls: readonly { readonly contract: string; readonly fnName: string }[];
  /** Unix seconds after which the rule is invalid (synth time + lifetime). */
  readonly validUntil: number;
}

/** The synthesised least-privilege authorization for a recorded transaction. */
export interface SmartAccountSpec {
  readonly contextRule: ContextRule;
  readonly policies: readonly PolicySpec[];
  /**
   * Argument constraints observed from the recording (e.g. the swap `path`
   * token set), always populated when an argument worth constraining is found.
   * They are also added to {@link policies} (and thus enforced as denials) only
   * when {@link SynthConfig.constrainArguments} is enabled; otherwise they are
   * advisory and the simulator flags — rather than denies — violations.
   */
  readonly argumentScopes: readonly ArgumentConstraintPolicy[];
  /**
   * Installable OZ context rules derived from the recording: one
   * `CallContract` rule per called contract, plus one per token the subject
   * authorized a direct `transfer` on (each `require_auth` in the tree is its
   * own context at `__check_auth` — FACTS §2.5). Spend caps compose onto the
   * token rules as stock `spending_limit` params.
   */
  readonly ozContextRules: readonly OzContextRule[];
  /**
   * Composition deltas: places where this spec's internal model and the real
   * OZ primitives differ (unit conversions, caps the stock policies cannot
   * express). These are expected mapping notes, not warnings.
   */
  readonly notes: readonly string[];
  /** Non-fatal advisories surfaced to the user (e.g. policy-count over the cap). */
  readonly warnings: readonly string[];
  /** The config the spec was synthesised with (echoed for reproducibility). */
  readonly config: SynthConfig;
  /** The deploy-time facts the rules were emitted with (echoed for reproducibility). */
  readonly installTargets: InstallTargets;
}

/**
 * The outcome of a dry-run evaluation of one candidate call.
 *
 * - `permit` — every check passed.
 * - `deny`   — a check failed; `reasonCode` names it.
 * - `flag`   — every *enforced* check passed, so the call would be permitted,
 *              but an advisory (unenforced) argument constraint was violated.
 *              The report surfaces this as a scope gap for the reviewer.
 */
export type SimulationDecision = 'permit' | 'deny' | 'flag';

/** A candidate call to evaluate against a spec in the dry run. */
export interface CandidateCall {
  /** Label shown in reports. */
  readonly label: string;
  readonly contract: string;
  readonly fnName: string;
  readonly args: readonly CallArg[];
  /** Outflows this candidate would cause, by token contract id. */
  readonly outflows: readonly AssetFlow[];
  /** Unix seconds the candidate would execute at. */
  readonly timestamp: number;
  /**
   * Prior call timestamps (Unix seconds) within scope, used to evaluate the
   * frequency policy. Excludes the candidate itself.
   */
  readonly priorCallTimestamps: readonly number[];
}

/** Result of evaluating a {@link CandidateCall}. */
export interface SimulationResult {
  readonly label: string;
  readonly decision: SimulationDecision;
  /** The policy/rule that produced the decision (e.g. `scope`, `spending-limit`). */
  readonly reasonCode: string;
  /** Human-readable explanation. */
  readonly reason: string;
  /**
   * Which artifact realises the check that decided: a composed stock OZ
   * policy binding, the generated policy contract, the context rule itself,
   * or the offline harness alone (no on-chain artifact). `—` for a permit.
   */
  readonly enforcedBy: string;
}

/**
 * How a synthesised policy is realised on-chain — the compose-first decision
 * made explicit per policy (see docs/compose-vs-generate.md).
 *
 * - `composed`     — a stock OpenZeppelin policy expresses it; only params are emitted.
 * - `generated`    — no stock policy can; policywright emits a policy contract.
 * - `offline-only` — no on-chain realisation exists yet; the dry-run harness
 *                    enforces it and `context-rule.json` records the delta.
 */
export type RealisationKind = 'composed' | 'generated' | 'offline-only';

/** One policy's realisation, with the binding(s) and rule(s) that carry it. */
export interface PolicyRealisation {
  readonly policy: PolicySpec;
  readonly kind: RealisationKind;
  /** The binding id (`stock:spending_limit`, `custom:FrequencyLimitPolicy`) or `dry-run harness`. */
  readonly via: string;
  /** Names of the OZ context rules the binding is attached to (empty for offline-only). */
  readonly rules: readonly string[];
  /** Why this realisation (the compose-first rule that applied). */
  readonly because: string;
}
