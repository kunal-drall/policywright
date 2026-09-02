/**
 * Dry-run harness: evaluate a candidate call against a synthesised
 * {@link SmartAccountSpec} and report whether the spec would permit, deny, or
 * flag it — before anything is installed on-chain.
 *
 * Checks run in a fixed order; the first one that fails produces the decision:
 *   1. scope               — is the (contract, fn) pair authorised by the rule?
 *   2. lifetime            — is the call within the rule's validity window?
 *   3. argument-constraint — ENFORCED constraints (constrainArguments on): deny
 *   4. spending-limit      — does any outflow exceed its asset's cap?
 *   5. frequency-limit     — would this call exceed the rolling call cap?
 *   6. argument-constraint — ADVISORY constraints (constrainArguments off): the
 *                            call is permitted but the report carries a flag
 * If every check passes, the call is permitted.
 */

import { describeBinding, describePolicy, formatAmount } from './emitter.js';
import { CONTRACT_ADDRESS_SHAPE, nativeSacContractId } from './network.js';
import { realisePolicies } from './synthesizer.js';
import type {
  ArgumentConstraintPolicy,
  CallArg,
  CandidateCall,
  PolicyRealisation,
  PolicySpec,
  RecordedTx,
  SimulationResult,
  SmartAccountSpec,
  SpendingLimitPolicy,
} from './types.js';

/** A named dry-run scenario plus the decision it is expected to produce. */
export interface Scenario {
  readonly candidate: CandidateCall;
  readonly expectedDecision: SimulationResult['decision'];
  readonly expectedReasonCode: string;
}

/**
 * The token the unobserved-route scenario probes with: an address that is NOT
 * in the observed swap-path set, so routing through it must be flagged or
 * denied. `provenance` says where the address came from so the report can
 * state it.
 */
export interface ProbeToken {
  readonly contractId: string;
  /** Short label for scenario names and the token legend (e.g. `XLM`). */
  readonly label: string;
  readonly provenance: string;
}

/** Options for {@link buildScenarios}. */
export interface ScenarioOptions {
  /** Override the probe token (e.g. from `--probe-token`). */
  readonly probeToken?: string;
}

/** Contract id → human label, used to name tokens in reasons and reports. */
export type TokenLabels = ReadonlyMap<string, string>;

/** A well-formed but synthetic address used only when no better probe exists. */
export const SYNTHETIC_PROBE_TOKEN = `C${'Z'.repeat(55)}`;

function isScoped(spec: SmartAccountSpec, contract: string, fnName: string): boolean {
  return spec.contextRule.scopedCalls.some((s) => s.contract === contract && s.fnName === fnName);
}

function spendPolicyFor(
  spec: SmartAccountSpec,
  contractId: string,
): SpendingLimitPolicy | undefined {
  return spec.policies.find(
    (p): p is SpendingLimitPolicy =>
      p.kind === 'spending-limit' && p.asset.contractId === contractId,
  );
}

/**
 * Return the candidate's argument tokens that fall outside an argument scope's
 * allow-set, or null when the candidate has no array argument at that index to
 * evaluate.
 */
function disallowedArgTokens(
  candidate: CandidateCall,
  scope: ArgumentConstraintPolicy,
): string[] | null {
  const arg: CallArg | undefined = candidate.args[scope.argIndex];
  if (!Array.isArray(arg)) {
    return null;
  }
  const allowed = new Set(scope.allowedTokens);
  const disallowed = arg.filter((t): t is string => typeof t === 'string' && !allowed.has(t));
  return disallowed.length > 0 ? disallowed : null;
}

/** Count prior in-scope calls that fall within the trailing frequency window. */
function callsInWindow(candidate: CandidateCall, windowSecs: number): number {
  const windowStart = candidate.timestamp - windowSecs;
  return candidate.priorCallTimestamps.filter((ts) => ts > windowStart && ts <= candidate.timestamp)
    .length;
}

/** `SYMBOL <id>` when the token has a label, else the bare id. */
function nameToken(id: string, labels: TokenLabels): string {
  const label = labels.get(id);
  return label === undefined ? id : `${label} ${id}`;
}

/** The constraint a candidate violated, named fully: rule, call, argument, allow-set. */
function describeViolation(
  scope: ArgumentConstraintPolicy,
  bad: readonly string[],
  labels: TokenLabels,
): string {
  const allowed = scope.allowedTokens.map((t) => nameToken(t, labels)).join(', ');
  const violating = bad.map((t) => nameToken(t, labels)).join(', ');
  return `${scope.fnName} arg[${scope.argIndex}] ${scope.argName} (rule ${scope.rule}) must stay within the observed token set {${allowed}}; candidate routes through unobserved ${violating}`;
}

/** Short statement of which artifact realises a policy (for the report). */
function realisationLabel(r: PolicyRealisation): string {
  switch (r.kind) {
    case 'composed':
      return `composed ${r.via} on rule ${r.rules.join(', ')}`;
    case 'generated':
      return `generated ${r.via} (FrequencyLimitPolicy.rs) on rules ${r.rules.join(', ')}`;
    case 'offline-only':
      return `${r.via} only — no on-chain artifact yet`;
  }
}

/** What enforces a given policy, looked up from the spec's realisations. */
function enforcedByPolicy(spec: SmartAccountSpec, policy: PolicySpec): string {
  const realisation = realisePolicies(spec).find((r) => r.policy === policy);
  return realisation === undefined ? 'dry-run harness only' : realisationLabel(realisation);
}

/** The context rule's own scope model (contract + observed function). */
const ENFORCED_BY_SCOPE =
  'context rule scope — CallContract(contract) on-chain; the function-level narrowing is the harness model (a generated policy would be needed on-chain)';
/** The context rule's own lifetime. */
const ENFORCED_BY_LIFETIME =
  'context rule valid_until — a ledger sequence on-chain (storage.rs:282); seconds in the harness';
const ENFORCED_BY_ADVISORY = 'dry-run harness only — advisory, no on-chain artifact';

/**
 * Evaluate one candidate call against the spec.
 *
 * @param labels optional contract-id → symbol map so reasons can name tokens
 */
export function simulateCall(
  spec: SmartAccountSpec,
  candidate: CandidateCall,
  labels: TokenLabels = new Map(),
): SimulationResult {
  // 1. Scope.
  if (!isScoped(spec, candidate.contract, candidate.fnName)) {
    return {
      label: candidate.label,
      decision: 'deny',
      reasonCode: 'scope',
      reason: `${candidate.fnName} @ ${candidate.contract} is outside the context rule's scope`,
      enforcedBy: ENFORCED_BY_SCOPE,
    };
  }

  // 2. Lifetime.
  if (candidate.timestamp > spec.contextRule.validUntil) {
    return {
      label: candidate.label,
      decision: 'deny',
      reasonCode: 'lifetime',
      reason: `call at ${candidate.timestamp} is after the rule expires at ${spec.contextRule.validUntil}`,
      enforcedBy: ENFORCED_BY_LIFETIME,
    };
  }

  // 3. Enforced argument constraints (deny routing through unobserved tokens).
  for (const policy of spec.policies) {
    if (policy.kind !== 'argument-constraint') {
      continue;
    }
    const bad = disallowedArgTokens(candidate, policy);
    if (bad !== null) {
      return {
        label: candidate.label,
        decision: 'deny',
        reasonCode: 'argument-constraint',
        reason: `argument constraint violated: ${describeViolation(policy, bad, labels)}`,
        enforcedBy: enforcedByPolicy(spec, policy),
      };
    }
  }

  // 4. Spending limits (per outflow asset that has a cap).
  for (const outflow of candidate.outflows) {
    if (outflow.direction !== 'out') {
      continue;
    }
    const policy = spendPolicyFor(spec, outflow.asset.contractId);
    if (policy !== undefined && outflow.amount > policy.cap) {
      const sent = formatAmount(outflow.amount, policy.asset.decimals);
      const cap = formatAmount(policy.cap, policy.asset.decimals);
      return {
        label: candidate.label,
        decision: 'deny',
        reasonCode: 'spending-limit',
        reason: `outflow of ${sent} ${policy.asset.symbol} exceeds the ${cap} cap per ${policy.windowSecs}s`,
        enforcedBy: enforcedByPolicy(spec, policy),
      };
    }
  }

  // 5. Frequency limit.
  const frequency = spec.policies.find((p) => p.kind === 'frequency-limit');
  if (frequency !== undefined) {
    const prior = callsInWindow(candidate, frequency.windowSecs);
    if (prior + 1 > frequency.maxCalls) {
      return {
        label: candidate.label,
        decision: 'deny',
        reasonCode: 'frequency-limit',
        reason: `this would be call ${prior + 1} within ${frequency.windowSecs}s, over the cap of ${frequency.maxCalls}`,
        enforcedBy: enforcedByPolicy(spec, frequency),
      };
    }
  }

  // 6. Advisory argument constraints: permitted, but flagged as a scope gap.
  if (!spec.config.constrainArguments) {
    for (const scope of spec.argumentScopes) {
      const bad = disallowedArgTokens(candidate, scope);
      if (bad !== null) {
        return {
          label: candidate.label,
          decision: 'flag',
          reasonCode: 'argument-constraint',
          reason: `permitted with a scope gap (constrainArguments is off, so this constraint is advisory): ${describeViolation(scope, bad, labels)}; enable --constrain-arguments to deny it`,
          enforcedBy: ENFORCED_BY_ADVISORY,
        };
      }
    }
  }

  return {
    label: candidate.label,
    decision: 'permit',
    reasonCode: 'permit',
    reason: 'within scope, lifetime, argument, spend cap, and frequency limits',
    enforcedBy: '—',
  };
}

/**
 * Choose the probe token for the unobserved-route scenario.
 *
 * Preference order: an explicit override; else the recording network's native
 * XLM Stellar Asset Contract (its address derives from the network passphrase,
 * so it is real on every network and needs no lookup) provided XLM was not
 * itself observed in a constrained argument; else a synthetic placeholder.
 */
export function probeTokenFor(
  spec: SmartAccountSpec,
  tx: RecordedTx,
  override?: string,
): ProbeToken {
  if (override !== undefined) {
    if (!CONTRACT_ADDRESS_SHAPE.test(override)) {
      throw new Error(
        `probe token must be a contract address (C… + 55 base32 chars), got "${override}"`,
      );
    }
    return { contractId: override, label: 'probe', provenance: 'supplied via --probe-token' };
  }
  const native = nativeSacContractId(tx.network);
  const observed = spec.argumentScopes.some((s) => s.allowedTokens.includes(native));
  if (!observed) {
    return {
      contractId: native,
      label: 'XLM',
      provenance: `native XLM Stellar Asset Contract on ${tx.network}, derived from the network passphrase (Asset.native().contractId)`,
    };
  }
  return {
    contractId: SYNTHETIC_PROBE_TOKEN,
    label: 'ZZZ',
    provenance: 'synthetic placeholder — the native XLM SAC is already in the observed set',
  };
}

/** Contract-id → symbol labels from the recording's flows plus the probe token. */
export function tokenLabelsFor(tx: RecordedTx, probe?: ProbeToken): TokenLabels {
  const labels = new Map<string, string>();
  for (const flow of tx.flows) {
    if (!labels.has(flow.asset.contractId)) {
      labels.set(flow.asset.contractId, flow.asset.symbol);
    }
  }
  if (probe !== undefined && !labels.has(probe.contractId)) {
    labels.set(probe.contractId, probe.label);
  }
  return labels;
}

/**
 * Build the standard dry-run scenarios for a spec + recording. Each is derived
 * generically from the spec so the set stays consistent with whatever was
 * synthesised. Returns the recorded ("original") permit case plus one deny case
 * per enforced check, and — when an argument constraint was derived — the
 * unobserved-route case built from the REAL observed call with its route
 * redirected to the probe token (flag when advisory, deny when enforced).
 */
export function buildScenarios(
  spec: SmartAccountSpec,
  tx: RecordedTx,
  options: ScenarioOptions = {},
): Scenario[] {
  const base = spec.contextRule.validUntil - spec.config.lifetimeSecs;
  const scoped = spec.contextRule.scopedCalls;
  const spendCall = scoped[scoped.length - 1];
  if (spendCall === undefined) {
    throw new Error('cannot build scenarios: context rule has no scoped calls');
  }
  const spendPolicy = spec.policies.find(
    (p): p is SpendingLimitPolicy => p.kind === 'spending-limit',
  );

  const scenarios: Scenario[] = [];

  // permit: replay the recorded outflow exactly.
  const recordedOutflows = tx.flows.filter((f) => f.direction === 'out');
  scenarios.push({
    candidate: {
      label: 'replay recorded flow',
      contract: spendCall.contract,
      fnName: spendCall.fnName,
      args: [],
      outflows: recordedOutflows,
      timestamp: base + 60,
      priorCallTimestamps: [],
    },
    expectedDecision: 'permit',
    expectedReasonCode: 'permit',
  });

  // deny over-cap: send one unit more than the cap of the first capped asset.
  if (spendPolicy !== undefined) {
    scenarios.push({
      candidate: {
        label: 'over the spend cap',
        contract: spendCall.contract,
        fnName: spendCall.fnName,
        args: [],
        outflows: [{ asset: spendPolicy.asset, direction: 'out', amount: spendPolicy.cap + 1n }],
        timestamp: base + 60,
        priorCallTimestamps: [],
      },
      expectedDecision: 'deny',
      expectedReasonCode: 'spending-limit',
    });
  }

  // deny unseen fn: an unscoped function on a scoped contract.
  scenarios.push({
    candidate: {
      label: 'call to an unseen function',
      contract: spendCall.contract,
      fnName: 'set_admin',
      args: [],
      outflows: [],
      timestamp: base + 60,
      priorCallTimestamps: [],
    },
    expectedDecision: 'deny',
    expectedReasonCode: 'scope',
  });

  // deny expired: a call after the rule's validity window.
  scenarios.push({
    candidate: {
      label: 'call after rule expiry',
      contract: spendCall.contract,
      fnName: spendCall.fnName,
      args: [],
      outflows: [],
      timestamp: spec.contextRule.validUntil + 1,
      priorCallTimestamps: [],
    },
    expectedDecision: 'deny',
    expectedReasonCode: 'lifetime',
  });

  // deny frequency: enough prior calls in-window that this one tips over.
  const frequency = spec.policies.find((p) => p.kind === 'frequency-limit');
  if (frequency !== undefined) {
    const prior = Array.from({ length: frequency.maxCalls }, (_, i) => base - (i + 1));
    scenarios.push({
      candidate: {
        label: 'over the frequency limit',
        contract: spendCall.contract,
        fnName: spendCall.fnName,
        args: [],
        outflows: [],
        timestamp: base,
        priorCallTimestamps: prior,
      },
      expectedDecision: 'deny',
      expectedReasonCode: 'frequency-limit',
    });
  }

  // argument scope: the REAL observed swap, re-routed through the probe token
  // (BLND→XLM for the claim→swap recordings). Denied when constrainArguments
  // is enabled, flagged (permitted, advisory) when it is not.
  const argScope = spec.argumentScopes[0];
  if (argScope !== undefined) {
    const probe = probeTokenFor(spec, tx, options.probeToken);
    const labels = tokenLabelsFor(tx, probe);
    const observedCall = tx.calls.find(
      (c) => c.contract === argScope.contract && c.fnName === argScope.fnName,
    );
    const observedArgs: readonly CallArg[] =
      observedCall?.args ?? Array.from({ length: argScope.argIndex + 1 }, () => null);
    const from = argScope.allowedTokens[0] ?? probe.contractId;
    const args = observedArgs.map((arg, i) =>
      i === argScope.argIndex ? [from, probe.contractId] : arg,
    );
    const fromLabel = labels.get(from) ?? from.slice(0, 8);
    scenarios.push({
      candidate: {
        label: `${fromLabel}→${probe.label} swap (route through unobserved ${probe.label})`,
        contract: argScope.contract,
        fnName: argScope.fnName,
        args,
        outflows: recordedOutflows,
        timestamp: base + 60,
        priorCallTimestamps: [],
      },
      expectedDecision: spec.config.constrainArguments ? 'deny' : 'flag',
      expectedReasonCode: 'argument-constraint',
    });
  }

  return scenarios;
}

/** What a report was evaluated against, rendered as its provenance header. */
export interface ReportContext {
  readonly tx: RecordedTx;
  readonly spec: SmartAccountSpec;
  /** The probe token the unobserved-route scenario used, when one was built. */
  readonly probe?: ProbeToken;
}

/**
 * Render dry-run results as a Markdown report. With a {@link ReportContext}
 * the report is self-describing: which recording, which generated policy set
 * and mode it was evaluated against, what each decision means, and which
 * addresses the token symbols refer to.
 */
export function renderReport(
  results: readonly SimulationResult[],
  context?: ReportContext,
): string {
  const icon = (d: SimulationResult['decision']): string =>
    d === 'permit' ? '✅' : d === 'flag' ? '⚠️' : '⛔';
  const lines: string[] = [];
  lines.push('# policywright dry-run report');
  lines.push('');
  if (context !== undefined) {
    const { tx, spec } = context;
    const hashes = [...new Set(tx.calls.map((c) => c.sourceHash))].filter(
      (h): h is string => h !== null,
    );
    lines.push(
      `Recording: ${tx.network}, from ${tx.source}${hashes.length > 0 ? `, tx ${hashes.join(', ')}` : ''}${tx.subject !== null ? `; subject ${tx.subject}` : ''}.`,
    );
    lines.push(
      `Generated policy set (context rule \`${spec.contextRule.name}\`, ${spec.policies.length} enforced polic${spec.policies.length === 1 ? 'y' : 'ies'}):`,
    );
    for (const r of realisePolicies(spec)) {
      const binding = spec.ozContextRules
        .flatMap((rule) => rule.policies)
        .find((b) => b.policy === r.via);
      const via =
        r.kind === 'offline-only' || binding === undefined
          ? realisationLabel(r)
          : `${r.kind}: ${describeBinding(binding)} on rule${r.rules.length === 1 ? '' : 's'} ${r.rules.join(', ')}`;
      lines.push(`- ${describePolicy(r.policy)} — ${via}`);
    }
    if (spec.argumentScopes.length > 0) {
      lines.push(
        `Argument constraints (\`constrainArguments: ${spec.config.constrainArguments}\`): ${spec.config.constrainArguments ? 'ENFORCED — a violation is denied.' : 'advisory (default) — a violation is permitted and flagged as a scope gap; `--constrain-arguments` enforces it.'}`,
      );
      for (const scope of spec.argumentScopes) {
        lines.push(`- ${describePolicy(scope)}: ${scope.allowedTokens.join(', ')}`);
      }
    }
    lines.push('');
    lines.push(
      'Decisions: ✅ permit — every check passed; ⛔ deny — the named check failed; ⚠️ flag — every enforced check passed (the call would be permitted) but an advisory argument constraint was violated. "Enforced by" names the artifact that realises the deciding check: a composed stock OZ policy, the generated policy contract, the context rule itself, or the offline harness alone.',
    );
    lines.push('');
  }
  lines.push('| Scenario | Decision | Enforced by | Reason |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of results) {
    lines.push(
      `| ${r.label} | ${icon(r.decision)} ${r.decision} (${r.reasonCode}) | ${r.enforcedBy} | ${r.reason} |`,
    );
  }
  lines.push('');
  if (context !== undefined) {
    const labels = tokenLabelsFor(context.tx, context.probe);
    if (labels.size > 0) {
      lines.push('Tokens:');
      for (const [id, label] of labels) {
        const note =
          context.probe !== undefined && id === context.probe.contractId
            ? ` — ${context.probe.provenance}`
            : '';
        lines.push(`- ${label} = ${id}${note}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
