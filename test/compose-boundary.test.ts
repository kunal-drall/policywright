/**
 * D2.4 — the compose-first decision boundary, asserted.
 *
 * Criterion: "Generates both a composed-policy configuration and a net-new
 * stateful policy contract; both compile and pass simulation."
 *
 * Covered here, all network-free:
 * - the realisation partition on the REAL recorded claim→swap sequence, the
 *   offline fixture, and synthetic mixed input — stock-expressible → composed
 *   (never generated); frequency → generated; the rest → offline-only;
 * - the compose-first invariant across every spec we can build;
 * - the composed configuration validated field-by-field against the OZ
 *   install signature and encoded to the exact ScVal the contracts decode;
 * - the generated contract byte-identical to the compiled-and-tested crate;
 * - the side-by-side artifacts under examples/live/fresh/ reproducible;
 * - the dry-run report attributing each deny to the artifact that realises it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scValToNative } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { emit } from '../src/emitter.js';
import {
  encodeInstallParams,
  parseContextRuleDocument,
  validateBinding,
  validateContextRuleDocument,
  type ContextRuleDocument,
} from '../src/install-shape.js';
import { renderFrequencyLimitPolicy } from '../src/rust-policy.js';
import { buildScenarios, probeTokenFor, simulateCall, tokenLabelsFor } from '../src/simulate.js';
import { loadFixture } from '../src/sources/fixture.js';
import { loadRecordedTx } from '../src/sources/recorded.js';
import { realisePolicies, synthesize } from '../src/synthesizer.js';
import {
  DEFAULT_SYNTH_CONFIG,
  type FrequencyLimitPolicy,
  type InstallTargets,
  type PolicyRealisation,
  type SmartAccountSpec,
} from '../src/types.js';
import { auth, call, contractId, flow, makeTx, token } from './helpers.js';

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const FRESH = here('../examples/live/recorded-claim-swap-fresh.json');
const FRESH_DIR = here('../examples/live/fresh/');
const CRATE = here('../contracts/frequency-limit-policy/src/lib.rs');

const BLND = 'CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF';

const fresh = loadRecordedTx(FRESH);

/**
 * The deploy-time facts the committed fresh artefacts were emitted with
 * (examples/live/fresh/synth.args, one CLI flag per line — the same file CI
 * passes to `synth`): the .env signer as Delegated(G) and the two deployed
 * testnet policy addresses (D2.5).
 */
function freshTargets(): InstallTargets {
  const lines = readFileSync(`${FRESH_DIR}synth.args`, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const signers = lines
    .filter((l) => l.startsWith('--signer='))
    .map((l) => l.slice('--signer=delegated:'.length))
    .map((address) => ({ type: 'Delegated' as const, address }));
  const policyAddresses: Record<string, string> = {};
  for (const l of lines.filter((x) => x.startsWith('--policy-address='))) {
    const kv = l.slice('--policy-address='.length);
    const eq = kv.indexOf('=');
    policyAddresses[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return { signers, policyAddresses, ledgerHead: null };
}
const freshSpec = synthesize(fresh, DEFAULT_SYNTH_CONFIG, fresh.timestamp ?? 0, freshTargets());

const byKind = (rs: readonly PolicyRealisation[]) => ({
  composed: rs.filter((r) => r.kind === 'composed'),
  generated: rs.filter((r) => r.kind === 'generated'),
  offlineOnly: rs.filter((r) => r.kind === 'offline-only'),
});

/** The compose-first invariant, checkable on any spec. */
function assertComposeFirst(spec: SmartAccountSpec): void {
  const realisations = realisePolicies(spec);
  expect(realisations).toHaveLength(spec.policies.length);
  for (const r of realisations) {
    switch (r.policy.kind) {
      case 'spending-limit':
        // A stock policy expresses spend caps: composed or (when the stock
        // policy cannot fire) offline-only — NEVER generated.
        expect(r.kind).not.toBe('generated');
        if (r.kind === 'composed') {
          expect(r.via).toBe('stock:spending_limit');
          expect(r.rules.length).toBeGreaterThan(0);
        }
        break;
      case 'frequency-limit':
        // No stock frequency policy exists: always generated, never composed.
        expect(r.kind).toBe('generated');
        expect(r.via).toBe('custom:FrequencyLimitPolicy');
        break;
      case 'argument-constraint':
        expect(r.kind).toBe('offline-only');
        break;
    }
  }
  // Bindings mirror the partition: every stock binding is a composed policy,
  // every custom binding is the generated one, and nothing else exists.
  for (const binding of spec.ozContextRules.flatMap((rule) => rule.policies)) {
    expect(['stock:spending_limit', 'custom:FrequencyLimitPolicy']).toContain(binding.policy);
  }
  // The generated Rust never carries a spend cap — stock territory.
  const frequency = spec.policies.find(
    (p): p is FrequencyLimitPolicy => p.kind === 'frequency-limit',
  );
  if (frequency !== undefined) {
    const rust = renderFrequencyLimitPolicy(frequency);
    // The stock struct and its fields never appear as code (docs may mention
    // the stock policy by name to contrast with it).
    expect(rust).not.toContain('SpendingLimitAccountParams');
    expect(rust).not.toMatch(/spending_limit\s*:/);
    expect(rust).not.toMatch(/period_ledgers/);
    expect(rust).toContain('impl Policy for FrequencyLimitPolicy');
  }
}

describe('decision boundary — realisePolicies on the real recorded sequence', () => {
  const parts = byKind(realisePolicies(freshSpec));

  it('composes the BLND spend cap onto the token rule as stock spending_limit', () => {
    expect(parts.composed).toHaveLength(1);
    const [r] = parts.composed;
    expect(r?.policy.kind).toBe('spending-limit');
    expect(r?.via).toBe('stock:spending_limit');
    expect(r?.rules).toEqual(['pw:xfer:BLND']);
    expect(r?.because).toContain('subject authorized a direct transfer');
  });

  it('generates the frequency limit, bound to every called-contract rule', () => {
    expect(parts.generated).toHaveLength(1);
    const [r] = parts.generated;
    expect(r?.policy.kind).toBe('frequency-limit');
    expect(r?.via).toBe('custom:FrequencyLimitPolicy');
    expect(r?.rules).toEqual(['pw:claim', 'pw:swap']);
    expect(r?.because).toContain('no call-frequency policy');
  });

  it('leaves nothing offline-only by default, and the argument constraint offline-only when enabled', () => {
    expect(parts.offlineOnly).toHaveLength(0);
    const enabled = synthesize(
      fresh,
      { ...DEFAULT_SYNTH_CONFIG, constrainArguments: true },
      fresh.timestamp ?? 0,
    );
    const offline = byKind(realisePolicies(enabled)).offlineOnly;
    expect(offline.map((r) => r.policy.kind)).toEqual(['argument-constraint']);
    expect(offline[0]?.via).toBe('dry-run harness');
  });

  it('holds the compose-first invariant', () => {
    assertComposeFirst(freshSpec);
  });
});

describe('decision boundary — fixture and mixed input', () => {
  it('fixture (no authorization trees): the BLND cap is offline-only, frequency still generated', () => {
    const tx = loadFixture();
    const spec = synthesize(tx, DEFAULT_SYNTH_CONFIG, tx.timestamp ?? 0);
    const parts = byKind(realisePolicies(spec));
    expect(parts.composed).toHaveLength(0);
    expect(parts.offlineOnly.map((r) => r.policy.kind)).toEqual(['spending-limit']);
    expect(parts.offlineOnly[0]?.because).toContain('no subject-authorized transfer');
    expect(parts.generated.map((r) => r.policy.kind)).toEqual(['frequency-limit']);
    assertComposeFirst(spec);
  });

  it('mixed input partitions correctly: composed + offline-only caps and a generated frequency limit', () => {
    const subject = contractId('wallet');
    const router = contractId('router');
    const usdc = token(contractId('usdc'), 'USDC');
    const blnd = token(contractId('blnd'), 'BLND');
    const tx = makeTx({
      subject,
      calls: [
        call(
          router,
          'swap_exact_tokens_for_tokens',
          [1000n, 900n, [usdc.contractId, blnd.contractId], subject, 9_999n],
          [
            auth(
              router,
              'swap_exact_tokens_for_tokens',
              [],
              [
                // Direct USDC transfer authorized by the subject → composable.
                auth(usdc.contractId, 'transfer', [subject, contractId('pair'), 1000n]),
              ],
            ),
          ],
        ),
      ],
      flows: [flow(usdc, 'out', 1000n), flow(blnd, 'out', 5n)], // BLND left without a direct transfer
    });
    const spec = synthesize(tx, { ...DEFAULT_SYNTH_CONFIG, constrainArguments: true }, 1_000_000);
    const parts = byKind(realisePolicies(spec));
    expect(
      parts.composed.map((r) => (r.policy.kind === 'spending-limit' ? r.policy.asset.symbol : '')),
    ).toEqual(['USDC']);
    expect(parts.generated.map((r) => r.policy.kind)).toEqual(['frequency-limit']);
    expect(parts.offlineOnly.map((r) => r.policy.kind).sort()).toEqual([
      'argument-constraint',
      'spending-limit',
    ]);
    assertComposeFirst(spec);
  });

  it('never generates a stock-expressible constraint across synthetic single-asset specs', () => {
    const router = contractId('router');
    for (const withTransfer of [true, false]) {
      const subject = contractId('wallet');
      const asset = token(contractId('xlm'), 'XLM');
      const tx = makeTx({
        subject,
        calls: [
          call(
            router,
            'swap',
            [],
            withTransfer
              ? [
                  auth(
                    router,
                    'swap',
                    [],
                    [auth(asset.contractId, 'transfer', [subject, router, 1n])],
                  ),
                ]
              : [],
          ),
        ],
        flows: [flow(asset, 'out', 1n)],
      });
      const spec = synthesize(tx, DEFAULT_SYNTH_CONFIG, 1_000_000);
      const spend = realisePolicies(spec).find((r) => r.policy.kind === 'spending-limit');
      expect(spend?.kind).toBe(withTransfer ? 'composed' : 'offline-only');
      assertComposeFirst(spec);
    }
  });
});

describe('composed configuration — validates field-by-field against the OZ install signature', () => {
  const doc = parseContextRuleDocument(
    JSON.parse(readFileSync(`${FRESH_DIR}context-rule.json`, 'utf8')),
  );

  it('the committed examples/live/fresh/context-rule.json would install as-is', () => {
    expect(validateContextRuleDocument(doc)).toEqual([]);
  });

  it('carries the composed stock spending_limit params on the BLND token rule', () => {
    const rule = doc.contextRules.find((r) => r.name === 'pw:xfer:BLND');
    expect(rule?.contextType).toEqual({ type: 'CallContract', contract: BLND });
    expect(rule?.observedFns).toEqual(['transfer']);
    expect(rule?.policies).toEqual([
      expect.objectContaining({
        policy: 'stock:spending_limit',
        address: freshTargets().policyAddresses['stock:spending_limit'],
        installParams: { spending_limit: '23533505', period_ledgers: 17280 },
      }),
    ]);
  });

  it('carries the generated FrequencyLimitPolicy params on the called-contract rules', () => {
    for (const name of ['pw:claim', 'pw:swap']) {
      const rule = doc.contextRules.find((r) => r.name === name);
      expect(rule?.policies).toEqual([
        expect.objectContaining({
          policy: 'custom:FrequencyLimitPolicy',
          installParams: { window_secs: 86400, max_calls: 5 },
        }),
      ]);
    }
  });

  /** A mutable, structurally-typed copy of the document for the negative cases. */
  interface MutableDoc {
    schemaVersion: number;
    contextRules: {
      contextType: { type: string; contract: string };
      name: string;
      signers: unknown[];
      policies: { policy: string; installParams: Record<string, unknown> }[];
    }[];
  }
  function mutate(edit: (d: MutableDoc) => void): ContextRuleDocument {
    const copy = JSON.parse(JSON.stringify(doc)) as MutableDoc;
    edit(copy);
    return copy as unknown as ContextRuleDocument;
  }
  const blndRule = doc.contextRules.findIndex((r) => r.name === 'pw:xfer:BLND');
  const claimRule = doc.contextRules.findIndex((r) => r.name === 'pw:claim');

  it.each<[string, (d: MutableDoc) => void, string]>([
    [
      'spending_limit <= 0',
      (d) => {
        d.contextRules[blndRule]!.policies[0]!.installParams.spending_limit = '0';
      },
      'InvalidLimitOrPeriod (3228)',
    ],
    [
      'period_ledgers == 0',
      (d) => {
        d.contextRules[blndRule]!.policies[0]!.installParams.period_ledgers = 0;
      },
      'InvalidLimitOrPeriod (3228)',
    ],
    [
      'an extra param field',
      (d) => {
        d.contextRules[blndRule]!.policies[0]!.installParams.extra = 1;
      },
      'FromVal(ConversionError)',
    ],
    [
      'a non-CallContract rule',
      (d) => {
        d.contextRules[blndRule]!.contextType.type = 'Default';
      },
      'OnlyCallContractAllowed (3227)',
    ],
    [
      'a 21-byte name',
      (d) => {
        d.contextRules[blndRule]!.name = 'x'.repeat(21);
      },
      'NameTooLong (3xxx)',
    ],
    [
      'a rule with neither signers nor policies',
      (d) => {
        d.contextRules[claimRule]!.policies = [];
        d.contextRules[claimRule]!.signers = [];
      },
      'NoSignersAndPolicies (3004)',
    ],
    [
      'spending_limit on a non-transfer rule',
      (d) => {
        d.contextRules[claimRule]!.policies = d.contextRules[blndRule]!.policies;
      },
      'NotAllowed (at enforce)',
    ],
    [
      'window_secs == 0',
      (d) => {
        d.contextRules[claimRule]!.policies[0]!.installParams.window_secs = 0;
      },
      'InvalidWindowOrLimit (3232)',
    ],
    [
      'max_calls > MAX_HISTORY_ENTRIES',
      (d) => {
        d.contextRules[claimRule]!.policies[0]!.installParams.max_calls = 1001;
      },
      'InvalidWindowOrLimit (3232)',
    ],
    [
      'an unknown schema version',
      (d) => {
        (d as { schemaVersion: number }).schemaVersion = 99;
      },
      'schema',
    ],
  ])('rejects %s with the error the real install would raise', (_label, edit, ozError) => {
    const violations = validateContextRuleDocument(mutate(edit));
    expect(violations.map((v) => v.ozError)).toContain(ozError);
  });

  it('encodes the spending_limit params as the sorted ScMap SpendingLimitAccountParams decodes', () => {
    const binding = doc.contextRules[blndRule]!.policies[0]!;
    const val = encodeInstallParams(binding);
    expect(val.switch().name).toBe('scvMap');
    expect(val.map()?.map((e) => `${e.key().sym().toString()}:${e.val().switch().name}`)).toEqual([
      'period_ledgers:scvU32',
      'spending_limit:scvI128',
    ]);
    expect(scValToNative(val)).toEqual({ period_ledgers: 17280, spending_limit: 23533505n });
    // Pinned against the SDK 15.1.0 encoding recorded in FACTS §13.1.
    expect(val.toXDR('base64')).toBe(
      'AAAAEQAAAAEAAAACAAAADwAAAA5wZXJpb2RfbGVkZ2VycwAAAAAAAwAAQ4AAAAAPAAAADnNwZW5kaW5nX2xpbWl0AAAAAAAKAAAAAAAAAAAAAAAAAWcXwQ==',
    );
  });

  it('encodes the FrequencyLimitParams as the sorted ScMap the generated crate decodes', () => {
    const binding = doc.contextRules[claimRule]!.policies[0]!;
    const val = encodeInstallParams(binding);
    expect(val.map()?.map((e) => `${e.key().sym().toString()}:${e.val().switch().name}`)).toEqual([
      'max_calls:scvU32',
      'window_secs:scvU64',
    ]);
    expect(scValToNative(val)).toEqual({ max_calls: 5, window_secs: 86400n });
  });

  it('refuses to encode params that would fail the install guards', () => {
    expect(() =>
      encodeInstallParams({
        policy: 'stock:spending_limit',
        address: null,
        installParams: { spending_limit: '0', period_ledgers: 17280 },
      }),
    ).toThrow(/spending_limit must be > 0/);
    expect(
      validateBinding({ policy: 'stock:nope', address: null, installParams: {} }, 'x')[0]?.ozError,
    ).toBe('schema');
  });
});

describe('generated contract — side by side with the composed configuration', () => {
  it('examples/live/fresh/FrequencyLimitPolicy.rs is byte-identical to the compiled-and-tested crate', () => {
    expect(readFileSync(`${FRESH_DIR}FrequencyLimitPolicy.rs`, 'utf8')).toBe(
      readFileSync(CRATE, 'utf8'),
    );
  });

  it('the side-by-side artifacts are exactly what synth --out emits for the fresh recording', () => {
    const artifacts = emit(fresh, freshSpec);
    expect(readFileSync(`${FRESH_DIR}spec.json`, 'utf8')).toBe(`${artifacts.specJson}\n`);
    expect(readFileSync(`${FRESH_DIR}context-rule.json`, 'utf8')).toBe(
      `${artifacts.contextRuleJson}\n`,
    );
    expect(readFileSync(`${FRESH_DIR}summary.txt`, 'utf8')).toBe(artifacts.summary);
    expect(readFileSync(`${FRESH_DIR}FrequencyLimitPolicy.rs`, 'utf8')).toBe(artifacts.rustPolicy);
  });

  it('the generated source carries the unaudited banner verbatim', () => {
    expect(readFileSync(`${FRESH_DIR}FrequencyLimitPolicy.rs`, 'utf8')).toContain(
      'Generated contracts are illustrative and unaudited — not for production\n//  deployment until the Audit Bank audit.',
    );
  });
});

describe('both artifacts pass simulation on the same context rule', () => {
  const probe = probeTokenFor(freshSpec, fresh);
  const labels = tokenLabelsFor(fresh, probe);
  const results = buildScenarios(freshSpec, fresh).map((s) =>
    simulateCall(freshSpec, s.candidate, labels),
  );
  const row = (label: string) => results.find((r) => r.label === label);

  it('permits the original recorded flow', () => {
    expect(row('replay recorded flow')?.decision).toBe('permit');
    expect(row('replay recorded flow')?.enforcedBy).toBe('—');
  });

  it("denies over-cap, attributed to the composed policy's constraint", () => {
    const r = row('over the spend cap');
    expect(r?.decision).toBe('deny');
    expect(r?.reasonCode).toBe('spending-limit');
    expect(r?.enforcedBy).toBe('composed stock:spending_limit on rule pw:xfer:BLND');
  });

  it("denies repeat-within-window, attributed to the generated policy's constraint", () => {
    const r = row('over the frequency limit');
    expect(r?.decision).toBe('deny');
    expect(r?.reasonCode).toBe('frequency-limit');
    expect(r?.enforcedBy).toBe(
      'generated custom:FrequencyLimitPolicy (FrequencyLimitPolicy.rs) on rules pw:claim, pw:swap',
    );
  });

  it('the committed report carries both attributions', () => {
    const report = readFileSync(here('../examples/live/simulation-report.md'), 'utf8');
    expect(report).toContain(
      '— composed: stock:spending_limit { spending_limit: 23533505, period_ledgers: 17280 } (caps BLND transfers) on rule pw:xfer:BLND',
    );
    expect(report).toContain(
      '— generated: custom:FrequencyLimitPolicy { window_secs: 86400, max_calls: 5 } on rules pw:claim, pw:swap',
    );
    expect(report).toContain(
      '| over the spend cap | ⛔ deny (spending-limit) | composed stock:spending_limit on rule pw:xfer:BLND |',
    );
    expect(report).toContain(
      '| over the frequency limit | ⛔ deny (frequency-limit) | generated custom:FrequencyLimitPolicy (FrequencyLimitPolicy.rs) on rules pw:claim, pw:swap |',
    );
  });
});
