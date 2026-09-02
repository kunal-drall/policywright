/**
 * The bridge between an emitted `context-rule.json` and the OpenZeppelin
 * install surface: validate a document field-by-field against the checks the
 * real contracts perform, and encode each policy binding's install params as
 * the exact `Val` the policy's `AccountParams: FromVal<Env, Val>` decodes.
 *
 * Every check cites the OZ v0.7.2 source line (docs/FACTS.md §2.3–2.5, §8.2)
 * or the generated crate (contracts/frequency-limit-policy/src/lib.rs) it
 * mirrors. The installer (D2.5) consumes the emitted artifact through this
 * module and nothing else — hand-crafted install arguments are not a path.
 */

import { nativeToScVal, type xdr } from '@stellar/stellar-sdk';
import { CONTRACT_ADDRESS_SHAPE } from './network.js';
import { CONTEXT_RULE_SCHEMA_VERSION, MAX_POLICIES, type OzSigner } from './types.js';

/** `MAX_NAME_SIZE` — smart_account/mod.rs:522-530 (bytes). */
export const MAX_NAME_BYTES = 20;
/** `MAX_SIGNERS` — storage.rs:377-391 (`validate_signers_and_policies`). */
export const MAX_SIGNERS = 15;
/** `MAX_HISTORY_ENTRIES` in the generated crate (install-time bound on max_calls). */
export const FREQUENCY_MAX_HISTORY_ENTRIES = 1000;

const G_ADDRESS_SHAPE = /^G[A-Z2-7]{55}$/;

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
  /** Relative lifetime in ledgers (schema v2); null in v1 documents. */
  readonly lifetimeLedgers: number | null;
  readonly validUntilLedger: number | null;
  readonly signers: readonly OzSigner[];
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

function parseSigner(value: unknown, path: string): OzSigner {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    throw new Error(`${path} must be a signer object with a type`);
  }
  if (value['type'] === 'Delegated') {
    return { type: 'Delegated', address: String(value['address']) };
  }
  if (value['type'] === 'External') {
    return {
      type: 'External',
      verifier: String(value['verifier']),
      keyData: String(value['keyData']),
    };
  }
  throw new Error(`${path}.type must be "Delegated" or "External", got "${value['type']}"`);
}

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
      const signers = Array.isArray(r['signers']) ? r['signers'] : [];
      return {
        contextType: {
          type: String(r['contextType']['type']),
          contract: String(r['contextType']['contract']),
        },
        name: String(r['name']),
        lifetimeLedgers: typeof r['lifetimeLedgers'] === 'number' ? r['lifetimeLedgers'] : null,
        validUntilLedger: typeof r['validUntilLedger'] === 'number' ? r['validUntilLedger'] : null,
        signers: signers.map((sg, j) => parseSigner(sg, `contextRules[${i}].signers[${j}]`)),
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

const violation = (
  path: string,
  ozError: string,
  message: string,
  source: string,
): InstallShapeViolation => ({ path, ozError, message, source });

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
        out.push(
          violation(
            `${path}.installParams`,
            'FromVal(ConversionError)',
            `SpendingLimitAccountParams has exactly {spending_limit, period_ledgers}; got {${keys.join(', ')}}`,
            'spending_limit.rs:88-94',
          ),
        );
        break;
      }
      const limit = asBigInt(binding.installParams['spending_limit']);
      const period = binding.installParams['period_ledgers'];
      if (limit === null || limit > I128_MAX || limit < -(I128_MAX + 1n)) {
        out.push(
          violation(
            `${path}.installParams.spending_limit`,
            'FromVal(ConversionError)',
            'spending_limit must be an i128 (decimal string)',
            'spending_limit.rs:88-94',
          ),
        );
      } else if (limit <= 0n) {
        // spending_limit.rs:380-382 — InvalidLimitOrPeriod
        out.push(
          violation(
            `${path}.installParams.spending_limit`,
            'InvalidLimitOrPeriod (3228)',
            'spending_limit must be > 0',
            'spending_limit.rs:380-382',
          ),
        );
      }
      if (
        typeof period !== 'number' ||
        !Number.isInteger(period) ||
        period < 0 ||
        period > U32_MAX
      ) {
        out.push(
          violation(
            `${path}.installParams.period_ledgers`,
            'FromVal(ConversionError)',
            'period_ledgers must be a u32',
            'spending_limit.rs:88-94',
          ),
        );
      } else if (period === 0) {
        out.push(
          violation(
            `${path}.installParams.period_ledgers`,
            'InvalidLimitOrPeriod (3228)',
            'period_ledgers must be > 0',
            'spending_limit.rs:380-382',
          ),
        );
      }
      break;
    }
    case 'custom:FrequencyLimitPolicy': {
      // contracts/frequency-limit-policy/src/lib.rs — FrequencyLimitParams { window_secs: u64, max_calls: u32 }
      if (keys.join(',') !== 'max_calls,window_secs') {
        out.push(
          violation(
            `${path}.installParams`,
            'FromVal(ConversionError)',
            `FrequencyLimitParams has exactly {window_secs, max_calls}; got {${keys.join(', ')}}`,
            'contracts/frequency-limit-policy/src/lib.rs FrequencyLimitParams',
          ),
        );
        break;
      }
      const window = asBigInt(binding.installParams['window_secs']);
      const maxCalls = binding.installParams['max_calls'];
      if (window === null || window < 0n || window > U64_MAX) {
        out.push(
          violation(
            `${path}.installParams.window_secs`,
            'FromVal(ConversionError)',
            'window_secs must be a u64',
            'lib.rs FrequencyLimitParams',
          ),
        );
      } else if (window === 0n) {
        out.push(
          violation(
            `${path}.installParams.window_secs`,
            'InvalidWindowOrLimit (3232)',
            'window_secs must be > 0',
            'lib.rs install: window_secs == 0',
          ),
        );
      }
      if (
        typeof maxCalls !== 'number' ||
        !Number.isInteger(maxCalls) ||
        maxCalls < 0 ||
        maxCalls > U32_MAX
      ) {
        out.push(
          violation(
            `${path}.installParams.max_calls`,
            'FromVal(ConversionError)',
            'max_calls must be a u32',
            'lib.rs FrequencyLimitParams',
          ),
        );
      } else if (maxCalls === 0 || maxCalls > FREQUENCY_MAX_HISTORY_ENTRIES) {
        out.push(
          violation(
            `${path}.installParams.max_calls`,
            'InvalidWindowOrLimit (3232)',
            `max_calls must be in 1..=${FREQUENCY_MAX_HISTORY_ENTRIES}`,
            'lib.rs install: max_calls == 0 || max_calls > MAX_HISTORY_ENTRIES',
          ),
        );
      }
      break;
    }
    default:
      out.push(
        violation(
          `${path}.policy`,
          'schema',
          `unknown policy binding "${binding.policy}"`,
          'docs/context-rule-schema.md',
        ),
      );
  }
  return out;
}

/** Validate one signer against the real `Signer` shape (storage.rs:96-102). */
export function validateSigner(signer: OzSigner, path: string): InstallShapeViolation[] {
  const out: InstallShapeViolation[] = [];
  if (signer.type === 'Delegated') {
    if (!G_ADDRESS_SHAPE.test(signer.address) && !CONTRACT_ADDRESS_SHAPE.test(signer.address)) {
      out.push(
        violation(
          `${path}.address`,
          'FromVal(ConversionError)',
          'Delegated signer must be a G… or C… address',
          'storage.rs:96-102 Signer::Delegated(Address)',
        ),
      );
    }
  } else {
    if (!CONTRACT_ADDRESS_SHAPE.test(signer.verifier)) {
      out.push(
        violation(
          `${path}.verifier`,
          'FromVal(ConversionError)',
          'External signer verifier must be a C… contract address',
          'storage.rs:96-102 Signer::External(Address, Bytes)',
        ),
      );
    }
    if (!/^([0-9a-f]{2})+$/i.test(signer.keyData)) {
      out.push(
        violation(
          `${path}.keyData`,
          'FromVal(ConversionError)',
          'External signer keyData must be hex bytes',
          'storage.rs:96-102 Signer::External(Address, Bytes)',
        ),
      );
    }
  }
  return out;
}

/** Options for {@link validateContextRuleDocument}. */
export interface ValidateOptions {
  /**
   * When true (the installer's setting), every binding must carry a deployed
   * policy address and `lifetimeLedgers` or `validUntilLedger` must be
   * present — the document must be installable as-is. When false, a design
   * artifact with null addresses is accepted.
   */
  readonly forInstall?: boolean;
}

/**
 * Validate a whole document against the `add_context_rule` signature and the
 * install guards of every bound policy. Empty result = installs as-is.
 */
export function validateContextRuleDocument(
  doc: ContextRuleDocument,
  options: ValidateOptions = {},
): InstallShapeViolation[] {
  const out: InstallShapeViolation[] = [];
  const forInstall = options.forInstall ?? false;
  if (doc.schemaVersion !== CONTEXT_RULE_SCHEMA_VERSION) {
    out.push(
      violation(
        'schemaVersion',
        'schema',
        `expected schemaVersion ${CONTEXT_RULE_SCHEMA_VERSION}, got ${doc.schemaVersion}`,
        'docs/context-rule-schema.md',
      ),
    );
  }
  const encoder = new TextEncoder();
  doc.contextRules.forEach((rule, i) => {
    const path = `contextRules[${i}]`;
    // spending_limit.rs:376-378 OnlyCallContractAllowed; storage.rs:143-150 — one contract per rule.
    if (rule.contextType.type !== 'CallContract') {
      out.push(
        violation(
          `${path}.contextType.type`,
          'OnlyCallContractAllowed (3227)',
          'policywright emits CallContract rules only',
          'spending_limit.rs:376-378',
        ),
      );
    }
    if (!CONTRACT_ADDRESS_SHAPE.test(rule.contextType.contract)) {
      out.push(
        violation(
          `${path}.contextType.contract`,
          'FromVal(ConversionError)',
          'contract must be a C… StrKey address',
          'storage.rs ContextRuleType::CallContract(Address)',
        ),
      );
    }
    // smart_account/mod.rs:522-530 — MAX_NAME_SIZE = 20 bytes.
    if (encoder.encode(rule.name).length > MAX_NAME_BYTES || rule.name.length === 0) {
      out.push(
        violation(
          `${path}.name`,
          'NameTooLong (3xxx)',
          `name must be 1..=${MAX_NAME_BYTES} bytes`,
          'smart_account/mod.rs:522-530',
        ),
      );
    }
    // storage.rs:282, :649-654 — valid_until: Option<u32> ledger sequence; PastValidUntil if past.
    if (
      rule.validUntilLedger !== null &&
      (!Number.isInteger(rule.validUntilLedger) ||
        rule.validUntilLedger <= 0 ||
        rule.validUntilLedger > U32_MAX)
    ) {
      out.push(
        violation(
          `${path}.validUntilLedger`,
          'FromVal(ConversionError)',
          'validUntilLedger must be a positive u32 ledger sequence or null',
          'storage.rs:282',
        ),
      );
    }
    if (
      rule.lifetimeLedgers !== null &&
      (!Number.isInteger(rule.lifetimeLedgers) || rule.lifetimeLedgers <= 0)
    ) {
      out.push(
        violation(
          `${path}.lifetimeLedgers`,
          'schema',
          'lifetimeLedgers must be a positive integer',
          'docs/context-rule-schema.md (E1)',
        ),
      );
    }
    if (forInstall && rule.validUntilLedger === null && rule.lifetimeLedgers === null) {
      out.push(
        violation(
          `${path}.lifetimeLedgers`,
          'schema',
          'an installable rule needs lifetimeLedgers (v2) or an absolute validUntilLedger',
          'docs/context-rule-schema.md (E1)',
        ),
      );
    }
    // smart_account/mod.rs:20-21; storage.rs:377-391 — at least one signer or policy, ≤ 15 signers, ≤ 5 policies.
    if (rule.signers.length + rule.policies.length === 0) {
      out.push(
        violation(
          path,
          'NoSignersAndPolicies (3004)',
          'a rule needs at least one signer or one policy',
          'smart_account/mod.rs:20-21; storage.rs:377-391',
        ),
      );
    }
    if (rule.signers.length > MAX_SIGNERS) {
      out.push(
        violation(
          `${path}.signers`,
          'TooManySigners',
          `at most ${MAX_SIGNERS} signers per rule`,
          'storage.rs:377-391',
        ),
      );
    }
    if (rule.policies.length > MAX_POLICIES) {
      out.push(
        violation(
          `${path}.policies`,
          'TooManyPolicies (3011)',
          `at most ${MAX_POLICIES} policies per rule`,
          'storage.rs:377-391',
        ),
      );
    }
    const signerKeys = new Set<string>();
    rule.signers.forEach((sg, j) => {
      out.push(...validateSigner(sg, `${path}.signers[${j}]`));
      const key = JSON.stringify(sg);
      if (signerKeys.has(key)) {
        out.push(
          violation(
            `${path}.signers[${j}]`,
            'DuplicateSigner',
            'the same signer appears twice on one rule',
            'storage.rs:646-647 validate_no_canonical_duplicates',
          ),
        );
      }
      signerKeys.add(key);
    });
    const addresses = new Set<string>();
    rule.policies.forEach((binding, j) => {
      const bpath = `${path}.policies[${j}]`;
      out.push(...validateBinding(binding, bpath));
      if (binding.address !== null) {
        if (!CONTRACT_ADDRESS_SHAPE.test(binding.address)) {
          out.push(
            violation(
              `${bpath}.address`,
              'FromVal(ConversionError)',
              'policy address must be a C… contract address',
              'mod.rs:238-248 policies: Map<Address, Val>',
            ),
          );
        } else if (addresses.has(binding.address)) {
          // E4 — the same map key twice collapses.
          out.push(
            violation(
              `${bpath}.address`,
              'DuplicatePolicy (3009)',
              'the same policy address appears twice on one rule (map key collision)',
              'storage.rs:1110-1144; RECONCILIATION-T2 E4',
            ),
          );
        }
        addresses.add(binding.address);
      } else if (forInstall) {
        out.push(
          violation(
            `${bpath}.address`,
            'schema',
            `policy address is null — synthesize with --policy-address ${binding.policy}=<C…>`,
            'RECONCILIATION-T2 E3',
          ),
        );
      }
      // spending_limit.rs:222-294 — enforce meters fn_name == "transfer" only.
      if (binding.policy === 'stock:spending_limit' && !rule.observedFns.includes('transfer')) {
        out.push(
          violation(
            bpath,
            'NotAllowed (at enforce)',
            'spending_limit only meters transfer calls; binding it to a non-transfer rule can never authorize',
            'spending_limit.rs:222-294',
          ),
        );
      }
      // spending_limit.rs:232-234 — enforce rejects with zero authenticated signers (E2).
      if (binding.policy === 'stock:spending_limit' && rule.signers.length === 0) {
        out.push(
          violation(
            bpath,
            'NotAllowed (at enforce)',
            'spending_limit needs at least one authenticated signer; a signer-less rule can never authorize a transfer — synthesize with --signer',
            'spending_limit.rs:232-234; RECONCILIATION-T2 E2',
          ),
        );
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
