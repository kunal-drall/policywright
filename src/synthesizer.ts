/**
 * Synthesizer: turn a {@link RecordedTx} into a least-privilege
 * {@link SmartAccountSpec} — an OpenZeppelin smart-account context rule plus the
 * minimal set of policies that permits exactly the observed flow.
 *
 * The design mirrors OZ's Stellar smart-account model: a context rule fixes the
 * scope (which contract/function calls are authorised) and a small set of
 * policies bound to it enforce quantitative limits (spend caps, call frequency,
 * and — when enabled — argument constraints). OZ caps a rule at
 * {@link MAX_POLICIES} policies, which we surface as a warning.
 */

import { CONTRACT_ADDRESS_SHAPE, isContractAddressShaped } from './network.js';
import {
  ESTIMATED_SECS_PER_LEDGER,
  MAX_POLICIES,
  NO_INSTALL_TARGETS,
  type ArgumentConstraintPolicy,
  type ArgumentRuleId,
  type CallArg,
  type ContextRule,
  type CustomFrequencyLimitBinding,
  type FrequencyLimitPolicy,
  type InstallTargets,
  type InvocationNode,
  type OzContextRule,
  type OzPolicyBinding,
  type PolicyRealisation,
  type PolicySpec,
  type RecordedTx,
  type ScopedCall,
  type SmartAccountSpec,
  type SpendingLimitPolicy,
  type OzSigner,
  type StockSpendingLimitBinding,
  type SynthConfig,
  type TokenRef,
} from './types.js';

/** OZ smart accounts cap a context rule name at 20 BYTES (`MAX_NAME_SIZE`). */
const MAX_NAME_SIZE = 20;

/** Citation for the stock spending-limit install shape (see docs/FACTS.md §2.4/2.5). */
const SPENDING_LIMIT_PARAMS_SOURCE =
  'OpenZeppelin/stellar-contracts@v0.7.2 packages/accounts/src/policies/spending_limit.rs:88-94 — SpendingLimitAccountParams { spending_limit: i128, period_ledgers: u32 }; install guards :367-405 (CallContract-only, positive params, AlreadyInstalled)';

/** Citation for the generated custom policy's install shape. */
const FREQUENCY_PARAMS_SOURCE =
  'policywright-generated FrequencyLimitPolicy (contracts/frequency-limit-policy, emitted by src/rust-policy.ts) — FrequencyLimitParams { window_secs: u64, max_calls: u32 }';

/** Raised when synthesis input or configuration is invalid. */
export class SynthError extends Error {
  override readonly name = 'SynthError';
}

/** Validate a {@link SynthConfig}, throwing {@link SynthError} on bad values. */
export function validateConfig(config: SynthConfig): void {
  const positiveInts: [keyof SynthConfig, number][] = [
    ['lifetimeSecs', config.lifetimeSecs],
    ['spendWindowSecs', config.spendWindowSecs],
    ['frequencyWindowSecs', config.frequencyWindowSecs],
    ['frequencyMaxCalls', config.frequencyMaxCalls],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new SynthError(`${name} must be a positive integer, got ${value}`);
    }
  }
  if (!Number.isFinite(config.capMultiplier) || config.capMultiplier <= 0) {
    throw new SynthError(`capMultiplier must be a positive number, got ${config.capMultiplier}`);
  }
}

/** OZ caps a rule at this many signers (`validate_signers_and_policies`, storage.rs:377-391). */
export const MAX_SIGNERS = 15;

const G_ADDRESS_SHAPE = /^G[A-Z2-7]{55}$/;

/** Validate deploy-time install targets, throwing {@link SynthError} on bad values. */
export function validateInstallTargets(targets: InstallTargets): void {
  if (targets.signers.length > MAX_SIGNERS) {
    throw new SynthError(
      `at most ${MAX_SIGNERS} signers per rule (OZ MAX_SIGNERS), got ${targets.signers.length}`,
    );
  }
  const seen = new Set<string>();
  for (const signer of targets.signers) {
    const key = JSON.stringify(signer);
    if (seen.has(key)) {
      throw new SynthError(
        `duplicate signer ${key} (OZ rejects canonical duplicates, storage.rs:646-647)`,
      );
    }
    seen.add(key);
    if (signer.type === 'Delegated') {
      if (!G_ADDRESS_SHAPE.test(signer.address) && !CONTRACT_ADDRESS_SHAPE.test(signer.address)) {
        throw new SynthError(
          `Delegated signer must be a G… or C… address, got "${signer.address}"`,
        );
      }
    } else {
      if (!CONTRACT_ADDRESS_SHAPE.test(signer.verifier)) {
        throw new SynthError(
          `External signer verifier must be a C… address, got "${signer.verifier}"`,
        );
      }
      if (!/^([0-9a-f]{2})+$/i.test(signer.keyData)) {
        throw new SynthError(`External signer keyData must be hex bytes, got "${signer.keyData}"`);
      }
    }
  }
  for (const [policy, address] of Object.entries(targets.policyAddresses)) {
    if (address !== undefined && !CONTRACT_ADDRESS_SHAPE.test(address)) {
      throw new SynthError(`policy address for ${policy} must be a C… address, got "${address}"`);
    }
  }
  if (
    targets.ledgerHead !== null &&
    (!Number.isInteger(targets.ledgerHead) ||
      targets.ledgerHead <= 0 ||
      targets.ledgerHead >= 2 ** 32)
  ) {
    throw new SynthError(
      `ledgerHead must be a positive u32 ledger sequence, got ${targets.ledgerHead}`,
    );
  }
}

/**
 * Multiply a bigint amount by a fractional multiplier, rounding up so the cap is
 * never below the observed outflow. Uses a fixed 1e6 denominator for precision.
 */
function scaleCeil(amount: bigint, multiplier: number): bigint {
  const DENOM = 1_000_000n;
  const numerator = BigInt(Math.round(multiplier * 1_000_000));
  const product = amount * numerator;
  return (product + DENOM - 1n) / DENOM;
}

/** Distinct (contract, fn) pairs, in first-seen order, for the rule scope. */
function deriveScope(tx: RecordedTx): ContextRule['scopedCalls'] {
  const seen = new Set<string>();
  const scoped: { contract: string; fnName: string }[] = [];
  for (const call of tx.calls) {
    const key = `${call.contract}::${call.fnName}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    scoped.push({ contract: call.contract, fnName: call.fnName });
  }
  return scoped;
}

/**
 * Truncate a string so its UTF-8 byte length is at most `maxBytes`, dropping
 * whole characters (OZ checks `String.len()`, which is bytes — FACTS §2.3).
 */
function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let out = value;
  while (out.length > 0 && encoder.encode(out).length > maxBytes) {
    out = out.slice(0, -1);
  }
  return out;
}

/** A short, deterministic, <=20-byte rule name derived from the called fns. */
function deriveRuleName(scopedCalls: ContextRule['scopedCalls']): string {
  const verbs = [...new Set(scopedCalls.map((c) => c.fnName.split('_')[0] ?? c.fnName))];
  return truncateToBytes(`pw:${verbs.join('+')}`, MAX_NAME_SIZE);
}

/** Convert a seconds-based window into ledgers, rounding up (never shorter). */
export function secsToLedgers(secs: number): number {
  return Math.ceil(secs / ESTIMATED_SECS_PER_LEDGER);
}

/**
 * Spend caps from GROSS outflow per asset.
 *
 * The cap is bound to gross out, not net: an asset that is received and then
 * sent within the same flow (e.g. BLND claimed then swapped) nets to ~zero, but
 * the account still moved the gross amount out, so that is what must be capped.
 * Assets that only ever flow in (e.g. USDC received from the swap) move nothing
 * out and therefore get no spend cap — the minimal-permission case.
 */
function deriveSpendingPolicies(tx: RecordedTx, config: SynthConfig): SpendingLimitPolicy[] {
  // Sum gross outflow per asset, keeping the first TokenRef seen for the asset.
  const grossOut = new Map<string, bigint>();
  const assetRef = new Map<string, TokenRef>();
  for (const flow of tx.flows) {
    const id = flow.asset.contractId;
    if (!assetRef.has(id)) {
      assetRef.set(id, flow.asset);
    }
    if (flow.direction === 'out') {
      grossOut.set(id, (grossOut.get(id) ?? 0n) + flow.amount);
    }
  }

  const policies: SpendingLimitPolicy[] = [];
  for (const [id, observedGrossOut] of grossOut) {
    if (observedGrossOut <= 0n) {
      continue; // inflow-only assets need no cap
    }
    const asset = assetRef.get(id);
    if (asset === undefined) {
      // Unreachable: every grossOut key was populated from a flow with a ref.
      throw new SynthError(`internal: missing token reference for ${id}`);
    }
    policies.push({
      kind: 'spending-limit',
      asset,
      cap: scaleCeil(observedGrossOut, config.capMultiplier),
      windowSecs: config.spendWindowSecs,
      observedGrossOut,
    });
  }
  return policies;
}

/**
 * An argument derivation rule: which observed call arguments become
 * {@link ArgumentConstraintPolicy} observations, and how.
 *
 * Rules are applied to every observed call. Each match yields one constraint
 * per `(contract, fnName, argIndex)`, whose allow-set is the union of the
 * token addresses observed there across the whole recording. Rules only ever
 * *derive*; whether a derived constraint is enforced is decided by
 * {@link SynthConfig.constrainArguments}.
 */
export interface ArgumentDerivationRule {
  readonly id: ArgumentRuleId;
  /** Human label for the constrained argument in specs and reports. */
  readonly argName: string;
  /** One-paragraph statement of what the rule reads and what it does not. */
  readonly description: string;
  /** Select the constrained argument of a call, or null when the rule does not apply. */
  readonly select: (call: ScopedCall) => { argIndex: number; tokens: readonly string[] } | null;
}

/** True for a non-empty vector whose every element is a contract-address-shaped string. */
function isContractAddressVec(arg: CallArg): arg is readonly string[] {
  return Array.isArray(arg) && arg.length > 0 && arg.every(isContractAddressShaped);
}

/**
 * `swap-path`: for any call whose function name contains `swap`, the FIRST
 * positional argument that is a non-empty `Vec` of contract-address-shaped
 * strings is taken to be the route (`path: Vec<Address>` in the Soroswap
 * router signature — docs/FACTS.md §4.3), and the set of token addresses
 * observed in it becomes the allow-set.
 */
export const SWAP_PATH_RULE: ArgumentDerivationRule = {
  id: 'swap-path',
  argName: 'path',
  description:
    'Applies to every observed call whose function name contains "swap". Reads the first ' +
    'positional argument that is a non-empty vector of contract-address-shaped strings ' +
    '(StrKey shape "C" + 55 base32 chars; shape, not checksum) and pins the SET of token ' +
    'addresses observed there. Not constrained: ordering, hop count, amounts (amounts are ' +
    "the spending-limit policy's job). A swap whose route is not an address vector (e.g. " +
    "Comet's token_in/token_out addresses) derives nothing.",
  select: (call) => {
    if (!call.fnName.includes('swap')) {
      return null;
    }
    const argIndex = call.args.findIndex(isContractAddressVec);
    if (argIndex === -1) {
      return null;
    }
    return { argIndex, tokens: call.args[argIndex] as readonly string[] };
  },
};

/** Every argument derivation rule, in application order. */
export const ARGUMENT_DERIVATION_RULES: readonly ArgumentDerivationRule[] = [SWAP_PATH_RULE];

/**
 * Derive argument-constraint observations from the recording by applying
 * {@link ARGUMENT_DERIVATION_RULES} to every observed call.
 *
 * These are always returned (as observations); the caller decides whether to
 * enforce them based on {@link SynthConfig.constrainArguments}.
 */
function deriveArgumentScopes(tx: RecordedTx): ArgumentConstraintPolicy[] {
  const byKey = new Map<string, { policy: ArgumentConstraintPolicy; tokens: Set<string> }>();
  for (const call of tx.calls) {
    for (const rule of ARGUMENT_DERIVATION_RULES) {
      const selected = rule.select(call);
      if (selected === null) {
        continue;
      }
      const key = `${rule.id}::${call.contract}::${call.fnName}::${selected.argIndex}`;
      let entry = byKey.get(key);
      if (entry === undefined) {
        entry = {
          tokens: new Set<string>(),
          policy: {
            kind: 'argument-constraint',
            rule: rule.id,
            contract: call.contract,
            fnName: call.fnName,
            argIndex: selected.argIndex,
            argName: rule.argName,
            allowedTokens: [],
          },
        };
        byKey.set(key, entry);
      }
      for (const token of selected.tokens) {
        entry.tokens.add(token);
      }
    }
  }
  return [...byKey.values()].map((e) => ({ ...e.policy, allowedTokens: [...e.tokens] }));
}

/** The frequency-limit policy is always emitted from config. */
function deriveFrequencyPolicy(config: SynthConfig): FrequencyLimitPolicy {
  return {
    kind: 'frequency-limit',
    windowSecs: config.frequencyWindowSecs,
    maxCalls: config.frequencyMaxCalls,
  };
}

/**
 * Token contracts on which the recording's subject authorized a DIRECT
 * `transfer` (SEP-41 `transfer(from, to, amount)` with `from == subject`),
 * anywhere in the authorization-entry trees. Every `require_auth` call is its
 * own `Context` at `__check_auth` (FACTS §2.5), so each such token needs its
 * own `CallContract` rule — which is exactly where the stock `spending_limit`
 * can meter the outflow.
 */
function collectSubjectTransferContracts(tx: RecordedTx): Set<string> {
  const found = new Set<string>();
  const subject = tx.subject;
  if (subject === null) {
    return found;
  }
  const visit = (node: InvocationNode): void => {
    if (node.fnName === 'transfer' && node.args[0] === subject) {
      found.add(node.contract);
    }
    for (const sub of node.subInvocations) {
      visit(sub);
    }
  };
  for (const call of tx.calls) {
    for (const root of call.authorizations) {
      visit(root);
    }
  }
  return found;
}

/** A unique <=20-byte rule name, disambiguated with a `~N` suffix on collision. */
function uniqueRuleName(base: string, used: Set<string>): string {
  let name = truncateToBytes(base, MAX_NAME_SIZE);
  for (let i = 2; used.has(name); i += 1) {
    const suffix = `~${i}`;
    name = truncateToBytes(base, MAX_NAME_SIZE - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

/** Short token label for rule names and notes. */
function assetLabel(asset: TokenRef): string {
  return asset.resolved ? asset.symbol : asset.contractId.slice(0, 8);
}

/**
 * Derive the installable OZ context rules and the composition-delta notes.
 *
 * One `CallContract` rule per called contract (rules cannot scope multiple
 * contracts or function names — RECONCILIATION row 13), plus one rule per
 * token the subject authorized a direct `transfer` on. Spend caps compose
 * onto the token rules as REAL stock `spending_limit` install params; caps
 * the stock policy cannot express are recorded as deltas instead of being
 * emitted in a shape the real contract would reject.
 */
function deriveOzContextRules(
  tx: RecordedTx,
  config: SynthConfig,
  spendingPolicies: readonly SpendingLimitPolicy[],
  targets: InstallTargets,
): { rules: OzContextRule[]; notes: string[] } {
  const notes: string[] = [];
  const lifetimeLedgers = secsToLedgers(config.lifetimeSecs);
  // E1: never derive valid_until from the recording ledger (it is in the past
  // by install time). Absolute only when a live head was supplied.
  const validUntilLedger =
    targets.ledgerHead !== null ? targets.ledgerHead + lifetimeLedgers : null;
  const signers: readonly OzSigner[] = targets.signers;

  const frequencyBinding: CustomFrequencyLimitBinding = {
    policy: 'custom:FrequencyLimitPolicy',
    address: targets.policyAddresses['custom:FrequencyLimitPolicy'] ?? null,
    installParams: {
      window_secs: config.frequencyWindowSecs,
      max_calls: config.frequencyMaxCalls,
    },
    paramsSource: FREQUENCY_PARAMS_SOURCE,
  };

  // One rule draft per contract, in first-seen order. Called contracts get the
  // frequency policy; token-transfer contracts get the spending limit below.
  const drafts = new Map<string, { fns: string[]; policies: OzPolicyBinding[] }>();
  for (const call of tx.calls) {
    let draft = drafts.get(call.contract);
    if (draft === undefined) {
      draft = { fns: [], policies: [frequencyBinding] };
      drafts.set(call.contract, draft);
    }
    if (!draft.fns.includes(call.fnName)) {
      draft.fns.push(call.fnName);
    }
  }

  const transferContracts = collectSubjectTransferContracts(tx);
  const tokenSymbols = new Map<string, TokenRef>();
  for (const flow of tx.flows) {
    if (!tokenSymbols.has(flow.asset.contractId)) {
      tokenSymbols.set(flow.asset.contractId, flow.asset);
    }
  }

  // Compose each spend cap onto its token's rule where the stock policy can
  // actually fire; record the delta where it cannot.
  const composedAssets = new Set<string>();
  for (const policy of spendingPolicies) {
    const tokenContract = policy.asset.contractId;
    if (!transferContracts.has(tokenContract)) {
      notes.push(
        `DELTA: the ${assetLabel(policy.asset)} spend cap (${policy.cap} per ${policy.windowSecs}s) is not expressible with the stock spending_limit policy — the recording shows no subject-authorized direct transfer of this token, and spending_limit only meters direct transfer calls, panicking NotAllowed on anything else (spending_limit.rs:222-294; RECONCILIATION row 12). The cap stays enforced in the offline dry run; on-chain enforcement of it needs a custom policy.`,
      );
      continue;
    }
    composedAssets.add(tokenContract);
    const binding: StockSpendingLimitBinding = {
      policy: 'stock:spending_limit',
      address: targets.policyAddresses['stock:spending_limit'] ?? null,
      installParams: {
        spending_limit: policy.cap,
        period_ledgers: secsToLedgers(policy.windowSecs),
      },
      paramsSource: SPENDING_LIMIT_PARAMS_SOURCE,
      derivedFrom: {
        asset: policy.asset,
        observedGrossOut: policy.observedGrossOut,
        spendWindowSecs: policy.windowSecs,
      },
    };
    let draft = drafts.get(tokenContract);
    if (draft === undefined) {
      draft = { fns: [], policies: [] };
      drafts.set(tokenContract, draft);
    }
    if (!draft.fns.includes('transfer')) {
      draft.fns.push('transfer');
    }
    draft.policies.push(binding);
  }

  // A subject-authorized transfer with no derived cap still needs its rule
  // (every require_auth context must match one), and OZ requires >=1 signer
  // or policy per rule — bind the frequency policy so it carries one.
  for (const tokenContract of transferContracts) {
    if (drafts.has(tokenContract)) {
      continue;
    }
    drafts.set(tokenContract, { fns: ['transfer'], policies: [frequencyBinding] });
    notes.push(
      `the subject authorized a direct transfer on ${tokenContract} but no outflow of it was observed; its CallContract rule is still required (each require_auth is its own context at __check_auth — FACTS §2.5) and carries the frequency policy so the rule is not empty.`,
    );
  }

  if (composedAssets.size > 0) {
    notes.push(
      `spend windows are measured in LEDGERS on-chain: ${config.spendWindowSecs}s → ${secsToLedgers(config.spendWindowSecs)} ledgers at an estimated ${ESTIMATED_SECS_PER_LEDGER}s/ledger (spending_limit.rs:88-94; OZ's own DAY_IN_LEDGERS = 17280 = 86400s at this rate).`,
    );
    // E5: one RULE per token; the same policy instance serves every rule.
    notes.push(
      `spending_limit is asset-blind: it meters whatever transfer amounts pass through its rule, so the metered token is the rule's CallContract target — one RULE per token. The same deployed spending_limit instance serves every rule (state is keyed on (account, rule id), spending_limit.rs:144-149).`,
    );
  }
  // E1: lifetime is relative; valid_until is absolute only from a live head.
  notes.push(
    validUntilLedger !== null
      ? `valid_until is a LEDGER SEQUENCE, not a Unix time (storage.rs:282): emitted ${validUntilLedger} = supplied ledger head ${targets.ledgerHead} + lifetimeLedgers ${lifetimeLedgers} (${config.lifetimeSecs}s at ${ESTIMATED_SECS_PER_LEDGER}s/ledger). Install before that ledger passes; add_context_rule rejects a past valid_until (PastValidUntil 3005, storage.rs:649-654).`
      : `validUntilLedger is null because no live ledger head was supplied (--ledger-head): the installer adds lifetimeLedgers ${lifetimeLedgers} (${config.lifetimeSecs}s at ${ESTIMATED_SECS_PER_LEDGER}s/ledger) to the ledger head it observes. valid_until is a ledger sequence, not a Unix time (storage.rs:282); the recording ledger is never used — it is in the past.`,
  );
  notes.push(
    `context rules cannot carry function names (matching is contract-level — storage.rs:289-304; RECONCILIATION rows 13-14): observedFns is advisory. Function-level narrowing must live in a policy's enforce; that codegen is Tranche 2 (docs/T2-NOTES.md).`,
  );
  // E2: signers in the real shape, or an explicit statement that none were supplied.
  notes.push(
    signers.length > 0
      ? `every rule carries the supplied signer(s) in the real OZ Signer shape (${signers.map((sg) => (sg.type === 'Delegated' ? `Delegated(${sg.address})` : `External(${sg.verifier}, ${sg.keyData.length / 2} bytes)`)).join(', ')}); a Delegated signer authorizes through its own nested __check_auth auth entry (FACTS §8.4).`
      : `emitted rules carry no signers (none supplied via --signer), so this artifact is a design document, not installable as-is: add_context_rule requires at least one signer or policy per rule (mod.rs:20-21), and stock spending_limit::enforce rejects when no signers authenticated (spending_limit.rs:232-234) — the installer refuses a spending_limit rule with no signers.`,
  );
  // E3: policy addresses, or an explicit statement that they are missing.
  const missing = (['custom:FrequencyLimitPolicy', 'stock:spending_limit'] as const).filter(
    (p) =>
      targets.policyAddresses[p] === undefined &&
      drafts.size > 0 &&
      [...drafts.values()].some((d) => d.policies.some((b) => b.policy === p)),
  );
  if (missing.length > 0) {
    notes.push(
      `policy address is null for ${missing.join(', ')}: supply the deployed contract address(es) via --policy-address <policy>=<C…> to make the artifact installable (add_context_rule takes policies as Map<Address, Val>, mod.rs:238-248).`,
    );
  }

  const usedNames = new Set<string>();
  const rules: OzContextRule[] = [];
  for (const [contract, draft] of drafts) {
    const isTokenRule = !tx.calls.some((c) => c.contract === contract);
    const asset = tokenSymbols.get(contract);
    const base =
      isTokenRule && asset !== undefined
        ? `pw:xfer:${assetLabel(asset)}`
        : `pw:${[...new Set(draft.fns.map((f) => f.split('_')[0] ?? f))].join('+')}`;
    // E4: two bindings with the same address would collapse into one map key.
    const addresses = draft.policies.map((b) => b.address).filter((a): a is string => a !== null);
    if (new Set(addresses).size !== addresses.length) {
      throw new SynthError(
        `rule for ${contract} binds the same policy address twice (${addresses.join(', ')}); add_context_rule takes policies as a Map<Address, Val>, so duplicate addresses collapse`,
      );
    }
    if (draft.policies.length > MAX_POLICIES) {
      throw new SynthError(
        `rule for ${contract} binds ${draft.policies.length} policies; OZ allows at most ${MAX_POLICIES} (TooManyPolicies 3011)`,
      );
    }
    rules.push({
      contextType: { type: 'CallContract', contract },
      name: uniqueRuleName(base, usedNames),
      lifetimeLedgers,
      validUntilLedger,
      signers,
      observedFns: draft.fns,
      policies: draft.policies,
    });
  }
  return { rules, notes };
}

/**
 * The compose-first decision, made explicit per synthesised policy.
 *
 * Decision boundary as implemented (docs/compose-vs-generate.md):
 * 1. A spending limit whose asset the subject directly `transfer`red (so a
 *    `CallContract(token)` rule exists) is COMPOSED: the stock OZ
 *    `spending_limit` is bound with real install params. Never generated.
 * 2. A spending limit with no such transfer cannot fire through the stock
 *    policy (it meters `transfer` only) and no policywright codegen covers
 *    it yet → OFFLINE-ONLY (DELTA note; harness enforces).
 * 3. The frequency limit has no stock counterpart → GENERATED
 *    (`FrequencyLimitPolicy`), bound to every called-contract rule.
 * 4. Argument constraints have no stock counterpart and no codegen yet →
 *    OFFLINE-ONLY.
 */
export function realisePolicies(spec: SmartAccountSpec): PolicyRealisation[] {
  const rulesWith = (predicate: (b: OzPolicyBinding) => boolean): string[] =>
    spec.ozContextRules.filter((r) => r.policies.some(predicate)).map((r) => r.name);

  return spec.policies.map((policy): PolicyRealisation => {
    switch (policy.kind) {
      case 'spending-limit': {
        const rules = rulesWith(
          (b) =>
            b.policy === 'stock:spending_limit' &&
            b.derivedFrom.asset.contractId === policy.asset.contractId,
        );
        if (rules.length > 0) {
          return {
            policy,
            kind: 'composed',
            via: 'stock:spending_limit',
            rules,
            because:
              'the stock spending_limit expresses a per-window cap on direct transfers, and the subject authorized a direct transfer of this token (FACTS §2.4–2.5)',
          };
        }
        return {
          policy,
          kind: 'offline-only',
          via: 'dry-run harness',
          rules: [],
          because:
            'the stock spending_limit meters direct transfer calls only and the recording shows no subject-authorized transfer of this token; no policywright codegen covers it yet (DELTA note in context-rule.json)',
        };
      }
      case 'frequency-limit':
        return {
          policy,
          kind: 'generated',
          via: 'custom:FrequencyLimitPolicy',
          rules: rulesWith((b) => b.policy === 'custom:FrequencyLimitPolicy'),
          because:
            'OpenZeppelin ships no call-frequency policy (FACTS §2.4), so policywright generates one implementing the real Policy trait',
        };
      case 'argument-constraint':
        return {
          policy,
          kind: 'offline-only',
          via: 'dry-run harness',
          rules: [],
          because:
            'no stock policy scopes argument values and the argument-checking policy codegen is not built yet (docs/T2-NOTES.md)',
        };
    }
  });
}

/**
 * Synthesize a least-privilege smart-account spec for a recorded transaction.
 *
 * @param tx      the normalised recording to authorise
 * @param config  synthesis knobs (validated here)
 * @param now     Unix seconds used as the base for the rule lifetime
 * @param targets deploy-time facts (signers, policy addresses, ledger head)
 *                the emitted rules carry so the artifact installs as-is
 */
export function synthesize(
  tx: RecordedTx,
  config: SynthConfig,
  now: number,
  targets: InstallTargets = NO_INSTALL_TARGETS,
): SmartAccountSpec {
  validateConfig(config);
  validateInstallTargets(targets);
  if (!Number.isInteger(now) || now < 0) {
    throw new SynthError(`now must be a non-negative Unix timestamp, got ${now}`);
  }
  if (tx.calls.length === 0) {
    throw new SynthError('recorded transaction has no contract calls to authorise');
  }

  const scopedCalls = deriveScope(tx);
  const contextRule: ContextRule = {
    name: deriveRuleName(scopedCalls),
    scopedCalls,
    validUntil: now + config.lifetimeSecs,
  };

  const argumentScopes = deriveArgumentScopes(tx);
  const spendingPolicies = deriveSpendingPolicies(tx, config);
  const policies: PolicySpec[] = [
    ...spendingPolicies,
    deriveFrequencyPolicy(config),
    // Argument constraints are enforced (count as policies) only when enabled.
    ...(config.constrainArguments ? argumentScopes : []),
  ];

  const { rules: ozContextRules, notes } = deriveOzContextRules(
    tx,
    config,
    spendingPolicies,
    targets,
  );
  if (argumentScopes.length > 0) {
    notes.push(
      `DELTA: no stock policy can express the observed argument constraints (${argumentScopes.map((s) => `${s.rule}: ${s.fnName} ${s.argName} token set`).join('; ')}); they are ${config.constrainArguments ? 'ENFORCED (deny)' : 'advisory (flag)'} in the offline dry-run harness only. On-chain enforcement needs a generated policy whose enforce checks the argument — that codegen is the remaining T2 policy-codegen deliverable and is not built yet (docs/T2-NOTES.md).`,
    );
  }

  const warnings: string[] = [];
  if (policies.length > MAX_POLICIES) {
    warnings.push(
      `synthesised ${policies.length} policies, but OpenZeppelin smart accounts allow at most ${MAX_POLICIES} per context rule; split the flow across multiple rules or relax constraints`,
    );
  }

  return {
    contextRule,
    policies,
    argumentScopes,
    ozContextRules,
    notes,
    warnings,
    config,
    installTargets: targets,
  };
}
