/**
 * The bridge between an emitted `context-rule.json` and the OpenZeppelin
 * install surface: validate a document field-by-field against the checks the
 * real contracts perform, and encode each policy binding's install params as
 * the exact `Val` the policy's `AccountParams: FromVal<Env, Val>` decodes.
 *
 * Every check cites the OZ v0.7.2 source line (docs/FACTS.md §2.3–2.5) or the
 * generated crate (contracts/frequency-limit-policy/src/lib.rs) it mirrors.
 * The installer (D2.5) consumes the emitted artifact through this module and
 * nothing else — hand-crafted install arguments are not a path.
 */

import { nativeToScVal, type xdr } from '@stellar/stellar-sdk';
import { CONTRACT_ADDRESS_SHAPE } from './network.js';
import { CONTEXT_RULE_SCHEMA_VERSION } from './types.js';

/** `MAX_NAME_SIZE` — smart_account/mod.rs:522-530 (bytes). */
export const MAX_NAME_BYTES = 20;
/** `MAX_HISTORY_ENTRIES` in the generated crate (install-time bound on max_calls). */
export const FREQUENCY_MAX_HISTORY_ENTRIES = 1000;

/** One violation of the install signature, naming the OZ error it would raise. */
export interface InstallShapeViolation {
  /** JSON path of the offending field. */
  readonly path: string;
  /** The OZ / generated-crate error the real install would raise, or `schema`. */
  readonly ozError: string;
  readonly message: string;
  /** The source the check mirrors. */
  readonly source: string;
}

/** A parsed `context-rule.json` binding (bigints as decimal strings). */
export interface ContextRuleBindingDoc {
  readonly policy: string;
  readonly address: string | null;
  readonly installParams: Record<string, unknown>;
}

/** A parsed `context-rule.json` rule. */
export interface ContextRuleDoc {
  readonly contextType: { readonly type: string; readonly contract: string };
  readonly name: string;
  readonly validUntilLedger: number | null;
  readonly signers: readonly unknown[];
  readonly observedFns: readonly string[];
  readonly policies: readonly ContextRuleBindingDoc[];
}

/** The parsed `context-rule.json` document (the fields the installer needs). */
export interface ContextRuleDocument {
  readonly schemaVersion: number;
  readonly contextRules: readonly ContextRuleDoc[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse an already-JSON-parsed document into the typed shape (throws on gross malformation). */
export function parseContextRuleDocument(doc: unknown): ContextRuleDocument {
  if (
    !isRecord(doc) ||
    typeof doc['schemaVersion'] !== 'number' ||
    !Array.isArray(doc['contextRules'])
  ) {
    throw new Error(
      'context-rule document must have a numeric schemaVersion and a contextRules array',
    );
  }
  return {
    schemaVersion: doc['schemaVersion'],
    contextRules: doc['contextRules'].map((r, i) => {
      if (!isRecord(r) || !isRecord(r['contextType']) || !Array.isArray(r['policies'])) {
        throw new Error(`contextRules[${i}] must have contextType and policies`);
      }
      return {
        contextType: {
          type: String(r['contextType']['type']),
          contract: String(r['contextType']['contract']),
        },
        name: String(r['name']),
        validUntilLedger: typeof r['validUntilLedger'] === 'number' ? r['validUntilLedger'] : null,
        signers: Array.isArray(r['signers']) ? r['signers'] : [],
        observedFns: Array.isArray(r['observedFns']) ? r['observedFns'].map(String) : [],
        policies: r['policies'].map((p, j) => {
          if (!isRecord(p) || !isRecord(p['installParams'])) {
            throw new Error(`contextRules[${i}].policies[${j}] must have installParams`);
          }
          return {
            policy: String(p['policy']),
            address: typeof p['address'] === 'string' ? p['address'] : null,
            installParams: p['installParams'],
          };
        }),
      };
    }),
  };
}

const I128_MAX = 2n ** 127n - 1n;
const U32_MAX = 2 ** 32 - 1;
const U64_MAX = 2n ** 64n - 1n;

function asBigInt(v: unknown): bigint | null {
  if (typeof v === 'bigint') {
    return v;
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v)) {
    return BigInt(v);
  }
  if (typeof v === 'number' && Number.isInteger(v)) {
    return BigInt(v);
  }
  return null;
}

/**
 * Validate one policy binding's install params against the real decoder and
 * install guards of its target. Returns the violations (empty = would install).
 */
export function validateBinding(
  binding: ContextRuleBindingDoc,
  path: string,
): InstallShapeViolation[] {
  const out: InstallShapeViolation[] = [];
  const keys = Object.keys(binding.installParams).sort();
  switch (binding.policy) {
    case 'stock:spending_limit': {
      // spending_limit.rs:88-94 — SpendingLimitAccountParams { spending_limit: i128, period_ledgers: u32 }
      if (keys.join(',') !== 'period_ledgers,spending_limit') {
        out.push({
          path: `${path}.installParams`,
          ozError: 'FromVal(ConversionError)',
          message: `SpendingLimitAccountParams has exactly {spending_limit, period_ledgers}; got {${keys.join(', ')}}`,
          source: 'spending_limit.rs:88-94',
        });
        break;
      }
      const limit = asBigInt(binding.installParams['spending_limit']);
      const period = binding.installParams['period_ledgers'];
      if (limit === null || limit > I128_MAX || limit < -(I128_MAX + 1n)) {
        out.push({
          path: `${path}.installParams.spending_limit`,
          ozError: 'FromVal(ConversionError)',
          message: 'spending_limit must be an i128 (decimal string)',
          source: 'spending_limit.rs:88-94',
        });
      } else if (limit <= 0n) {
        // spending_limit.rs:380-382 — InvalidLimitOrPeriod
        out.push({
          path: `${path}.installParams.spending_limit`,
          ozError: 'InvalidLimitOrPeriod (3228)',
          message: 'spending_limit must be > 0',
          source: 'spending_limit.rs:380-382',
        });
      }
      if (
        typeof period !== 'number' ||
        !Number.isInteger(period) ||
        period < 0 ||
        period > U32_MAX
      ) {
        out.push({
          path: `${path}.installParams.period_ledgers`,
          ozError: 'FromVal(ConversionError)',
          message: 'period_ledgers must be a u32',
          source: 'spending_limit.rs:88-94',
        });
      } else if (period === 0) {
        out.push({
          path: `${path}.installParams.period_ledgers`,
          ozError: 'InvalidLimitOrPeriod (3228)',
          message: 'period_ledgers must be > 0',
          source: 'spending_limit.rs:380-382',
        });
      }
      break;
    }
    case 'custom:FrequencyLimitPolicy': {
      // contracts/frequency-limit-policy/src/lib.rs — FrequencyLimitParams { window_secs: u64, max_calls: u32 }
      if (keys.join(',') !== 'max_calls,window_secs') {
        out.push({
          path: `${path}.installParams`,
          ozError: 'FromVal(ConversionError)',
          message: `FrequencyLimitParams has exactly {window_secs, max_calls}; got {${keys.join(', ')}}`,
          source: 'contracts/frequency-limit-policy/src/lib.rs FrequencyLimitParams',
        });
        break;
      }
      const window = asBigInt(binding.installParams['window_secs']);
      const maxCalls = binding.installParams['max_calls'];
      if (window === null || window < 0n || window > U64_MAX) {
        out.push({
          path: `${path}.installParams.window_secs`,
          ozError: 'FromVal(ConversionError)',
          message: 'window_secs must be a u64',
          source: 'lib.rs FrequencyLimitParams',
        });
      } else if (window === 0n) {
        out.push({
          path: `${path}.installParams.window_secs`,
          ozError: 'InvalidWindowOrLimit (3232)',
          message: 'window_secs must be > 0',
          source: 'lib.rs install: window_secs == 0',
        });
      }
      if (
        typeof maxCalls !== 'number' ||
        !Number.isInteger(maxCalls) ||
        maxCalls < 0 ||
        maxCalls > U32_MAX
      ) {
        out.push({
          path: `${path}.installParams.max_calls`,
          ozError: 'FromVal(ConversionError)',
          message: 'max_calls must be a u32',
          source: 'lib.rs FrequencyLimitParams',
        });
      } else if (maxCalls === 0 || maxCalls > FREQUENCY_MAX_HISTORY_ENTRIES) {
        out.push({
          path: `${path}.installParams.max_calls`,
          ozError: 'InvalidWindowOrLimit (3232)',
          message: `max_calls must be in 1..=${FREQUENCY_MAX_HISTORY_ENTRIES}`,
          source: 'lib.rs install: max_calls == 0 || max_calls > MAX_HISTORY_ENTRIES',
        });
      }
      break;
    }
    default:
      out.push({
        path: `${path}.policy`,
        ozError: 'schema',
        message: `unknown policy binding "${binding.policy}"`,
        source: 'docs/context-rule-schema.md',
      });
  }
  return out;
}

/**
 * Validate a whole document against the `add_context_rule` signature and the
 * install guards of every bound policy. Empty result = installs as-is.
 */
export function validateContextRuleDocument(doc: ContextRuleDocument): InstallShapeViolation[] {
  const out: InstallShapeViolation[] = [];
  if (doc.schemaVersion !== CONTEXT_RULE_SCHEMA_VERSION) {
    out.push({
      path: 'schemaVersion',
      ozError: 'schema',
      message: `expected schemaVersion ${CONTEXT_RULE_SCHEMA_VERSION}, got ${doc.schemaVersion}`,
      source: 'docs/context-rule-schema.md',
    });
  }
  const encoder = new TextEncoder();
  doc.contextRules.forEach((rule, i) => {
    const path = `contextRules[${i}]`;
    // spending_limit.rs:376-378 OnlyCallContractAllowed; storage.rs:143-150 — one contract per rule.
    if (rule.contextType.type !== 'CallContract') {
      out.push({
        path: `${path}.contextType.type`,
        ozError: 'OnlyCallContractAllowed (3227)',
        message: 'policywright emits CallContract rules only',
        source: 'spending_limit.rs:376-378',
      });
    }
    if (!CONTRACT_ADDRESS_SHAPE.test(rule.contextType.contract)) {
      out.push({
        path: `${path}.contextType.contract`,
        ozError: 'FromVal(ConversionError)',
        message: 'contract must be a C… StrKey address',
        source: 'storage.rs ContextRuleType::CallContract(Address)',
      });
    }
    // smart_account/mod.rs:522-530 — MAX_NAME_SIZE = 20 bytes.
    if (encoder.encode(rule.name).length > MAX_NAME_BYTES || rule.name.length === 0) {
      out.push({
        path: `${path}.name`,
        ozError: 'NameTooLong (3xxx)',
        message: `name must be 1..=${MAX_NAME_BYTES} bytes`,
        source: 'smart_account/mod.rs:522-530',
      });
    }
    // storage.rs:282 — valid_until: Option<u32> compared with ledger sequence.
    if (
      rule.validUntilLedger !== null &&
      (!Number.isInteger(rule.validUntilLedger) ||
        rule.validUntilLedger <= 0 ||
        rule.validUntilLedger > U32_MAX)
    ) {
      out.push({
        path: `${path}.validUntilLedger`,
        ozError: 'FromVal(ConversionError)',
        message: 'validUntilLedger must be a positive u32 ledger sequence or null',
        source: 'storage.rs:282',
      });
    }
    // smart_account/mod.rs:20-21 — at least one signer or policy per rule.
    if (rule.signers.length + rule.policies.length === 0) {
      out.push({
        path: `${path}`,
        ozError: 'NoSignersOrPolicies',
        message: 'a rule needs at least one signer or one policy',
        source: 'smart_account/mod.rs:20-21',
      });
    }
    rule.policies.forEach((binding, j) => {
      out.push(...validateBinding(binding, `${path}.policies[${j}]`));
      // spending_limit.rs:222-294 — enforce meters fn_name == "transfer" only.
      if (binding.policy === 'stock:spending_limit' && !rule.observedFns.includes('transfer')) {
        out.push({
          path: `${path}.policies[${j}]`,
          ozError: 'NotAllowed (at enforce)',
          message:
            'spending_limit only meters transfer calls; binding it to a non-transfer rule can never authorize',
          source: 'spending_limit.rs:222-294',
        });
      }
    });
  });
  return out;
}

/**
 * Encode a binding's install params as the `Val` the policy contract decodes.
 * `#[contracttype]` structs are `ScMap`s keyed by field-name symbols in sorted
 * order; `nativeToScVal` with explicit field types produces exactly that
 * (verified with the pinned SDK — docs/FACTS.md §13.1).
 */
export function encodeInstallParams(binding: ContextRuleBindingDoc): xdr.ScVal {
  const violations = validateBinding(binding, 'binding');
  if (violations.length > 0) {
    throw new Error(
      `cannot encode install params: ${violations.map((v) => `${v.path}: ${v.message}`).join('; ')}`,
    );
  }
  switch (binding.policy) {
    case 'stock:spending_limit':
      return nativeToScVal(
        {
          spending_limit: BigInt(binding.installParams['spending_limit'] as string),
          period_ledgers: binding.installParams['period_ledgers'] as number,
        },
        { type: { spending_limit: ['symbol', 'i128'], period_ledgers: ['symbol', 'u32'] } },
      );
    case 'custom:FrequencyLimitPolicy':
      return nativeToScVal(
        {
          window_secs: BigInt(binding.installParams['window_secs'] as number),
          max_calls: binding.installParams['max_calls'] as number,
        },
        { type: { window_secs: ['symbol', 'u64'], max_calls: ['symbol', 'u32'] } },
      );
    default:
      // validateBinding rejected unknown policies above.
      throw new Error(`unknown policy binding "${binding.policy}"`);
  }
}
