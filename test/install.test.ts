/**
 * D2.5 — artifact → install-call mapping, the OZ authorization payload, the
 * emitter fixes E1–E5 (schema v2), and the verify diff. All network-free: the
 * shapes are the ones verified in docs/FACTS.md §8 and §13 and recorded in
 * docs/RECONCILIATION-T2.md (Gate 3).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Address, Keypair, Networks, hash, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { contextRuleJson } from '../src/emitter.js';
import {
  InstallError,
  authDigest,
  buildAddContextRuleArgs,
  buildAuthPayload,
  buildDelegatedCheckAuthEntry,
  encodeContextType,
  encodeOptionU32,
  encodePoliciesMap,
  encodeSigner,
  localFallbackSigner,
  planInstall,
  signaturePayload,
  signerKey,
} from '../src/install.js';
import {
  parseContextRuleDocument,
  validateContextRuleDocument,
  type ContextRuleDocument,
} from '../src/install-shape.js';
import { loadRecordedTx } from '../src/sources/recorded.js';
import { SynthError, synthesize } from '../src/synthesizer.js';
import {
  CONTEXT_RULE_SCHEMA_VERSION,
  DEFAULT_SYNTH_CONFIG,
  NO_INSTALL_TARGETS,
  type InstallTargets,
} from '../src/types.js';
import { decodeContextRule, diffRules, type InstalledRule } from '../src/verify.js';
import { auth, call, contractId, flow, makeTx, token } from './helpers.js';

const FRESH = fileURLToPath(
  new URL('../examples/live/recorded-claim-swap-fresh.json', import.meta.url),
);
const G = 'GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W';
const FREQ = 'CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP';
const SPEND = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU'; // any C… works for shape tests
const BLND = 'CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF';
const HEAD = 4_464_380;

const targets: InstallTargets = {
  signers: [{ type: 'Delegated', address: G }],
  policyAddresses: { 'custom:FrequencyLimitPolicy': FREQ, 'stock:spending_limit': SPEND },
  ledgerHead: null,
};

const fresh = loadRecordedTx(FRESH);

/** The fresh recording emitted as an installable v2 document. */
function freshDoc(t: InstallTargets = targets): ContextRuleDocument {
  const spec = synthesize(fresh, DEFAULT_SYNTH_CONFIG, fresh.timestamp ?? 0, t);
  return parseContextRuleDocument(JSON.parse(contextRuleJson(fresh, spec)));
}

const symOf = (v: xdr.ScVal): string => v.vec()?.[0]?.sym().toString() ?? '';

describe('emitter fixes E1–E5 (schema v2)', () => {
  it('bumps the schema version to 2 and echoes the install targets', () => {
    const spec = synthesize(fresh, DEFAULT_SYNTH_CONFIG, fresh.timestamp ?? 0, targets);
    const doc = JSON.parse(contextRuleJson(fresh, spec)) as {
      schemaVersion: number;
      installTargets: InstallTargets;
    };
    expect(CONTEXT_RULE_SCHEMA_VERSION).toBe(2);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.installTargets).toEqual(targets);
  });

  it('E1: emits lifetimeLedgers on every rule and no validUntilLedger without a head', () => {
    for (const rule of freshDoc().contextRules) {
      expect(rule.lifetimeLedgers).toBe(518_400); // 30 days at 5 s/ledger
      expect(rule.validUntilLedger).toBeNull();
    }
    const withHead = freshDoc({ ...targets, ledgerHead: HEAD });
    for (const rule of withHead.contextRules) {
      expect(rule.validUntilLedger).toBe(HEAD + 518_400);
    }
  });

  it('E2: emits the supplied signers in the real Signer shape on every rule', () => {
    for (const rule of freshDoc().contextRules) {
      expect(rule.signers).toEqual([{ type: 'Delegated', address: G }]);
    }
    const none = freshDoc(NO_INSTALL_TARGETS);
    expect(none.contextRules.every((r) => r.signers.length === 0)).toBe(true);
    const spec = synthesize(fresh, DEFAULT_SYNTH_CONFIG, fresh.timestamp ?? 0);
    expect(spec.notes.some((n) => n.includes('not installable as-is'))).toBe(true);
  });

  it('E3: emits the deployed policy addresses, null (with a note) when none are supplied', () => {
    const doc = freshDoc();
    const bindings = doc.contextRules.flatMap((r) => r.policies);
    expect(bindings.find((b) => b.policy === 'stock:spending_limit')?.address).toBe(SPEND);
    expect(bindings.find((b) => b.policy === 'custom:FrequencyLimitPolicy')?.address).toBe(FREQ);
    const spec = synthesize(fresh, DEFAULT_SYNTH_CONFIG, fresh.timestamp ?? 0);
    expect(spec.ozContextRules.flatMap((r) => r.policies).every((b) => b.address === null)).toBe(
      true,
    );
    expect(spec.notes.some((n) => n.includes('policy address is null'))).toBe(true);
  });

  it('E4: refuses two bindings with the same address on one rule', () => {
    // A token rule with a cap AND (forced) frequency binding would need two
    // addresses; here we give both binding kinds the same address on a
    // recording whose token rule carries no cap (so it gets the frequency
    // binding) — still one binding per rule, so no collision …
    const same: InstallTargets = {
      ...targets,
      policyAddresses: { 'custom:FrequencyLimitPolicy': FREQ, 'stock:spending_limit': FREQ },
    };
    expect(() => synthesize(fresh, DEFAULT_SYNTH_CONFIG, fresh.timestamp ?? 0, same)).not.toThrow();
    // … but the install-shape validator catches a duplicated address on a rule.
    const doc = freshDoc();
    const dup = JSON.parse(JSON.stringify(doc)) as {
      contextRules: { policies: { address: string | null }[] }[];
    };
    const rule = dup.contextRules.find((r) => r.policies.length > 0);
    rule?.policies.push({ ...(rule.policies[0] as { address: string | null }) });
    const violations = validateContextRuleDocument(dup as unknown as ContextRuleDocument);
    expect(violations.map((v) => v.ozError)).toContain('DuplicatePolicy (3009)');
  });

  it('E5: the notes no longer claim one policy instance per token rule', () => {
    const spec = synthesize(fresh, DEFAULT_SYNTH_CONFIG, fresh.timestamp ?? 0, targets);
    expect(spec.notes.join('\n')).not.toContain('one instance per token rule');
    expect(spec.notes.join('\n')).toContain('one RULE per token');
    expect(spec.notes.join('\n')).toContain(
      'same deployed spending_limit instance serves every rule',
    );
  });

  it('rejects malformed install targets with SynthError', () => {
    const bad = (t: Partial<InstallTargets>) =>
      synthesize(fresh, DEFAULT_SYNTH_CONFIG, fresh.timestamp ?? 0, { ...targets, ...t });
    expect(() => bad({ signers: [{ type: 'Delegated', address: 'not-an-address' }] })).toThrow(
      SynthError,
    );
    expect(() => bad({ signers: [{ type: 'External', verifier: G, keyData: 'aa' }] })).toThrow(
      /verifier must be a C/,
    );
    expect(() => bad({ signers: [{ type: 'External', verifier: FREQ, keyData: 'zz' }] })).toThrow(
      /hex/,
    );
    expect(() =>
      bad({
        signers: Array.from({ length: 16 }, (_, i) => ({
          type: 'Delegated' as const,
          address: contractId(`s${i}`),
        })),
      }),
    ).toThrow(/at most 15 signers/);
    expect(() => bad({ policyAddresses: { 'stock:spending_limit': 'nope' } })).toThrow(SynthError);
    expect(() => bad({ ledgerHead: -1 })).toThrow(SynthError);
  });
});

describe('install-shape v2 — the installable-as-is gate', () => {
  it('accepts the fresh recording emitted with signers and addresses', () => {
    expect(validateContextRuleDocument(freshDoc(), { forInstall: true })).toEqual([]);
  });

  it('refuses a design artifact (no signers, null addresses) for install, naming each gap', () => {
    const v = validateContextRuleDocument(freshDoc(NO_INSTALL_TARGETS), { forInstall: true });
    const errors = v.map((x) => x.ozError);
    expect(errors).toContain('schema'); // null policy address
    expect(errors).toContain('NotAllowed (at enforce)'); // spending_limit with no signers (E2)
    expect(v.some((x) => x.message.includes('--policy-address'))).toBe(true);
    expect(v.some((x) => x.message.includes('--signer'))).toBe(true);
  });

  it('accepts the same design artifact when not validating for install', () => {
    const v = validateContextRuleDocument(freshDoc(NO_INSTALL_TARGETS));
    // Only the E2 enforce-time warning remains: a signer-less spending_limit rule.
    expect(v.map((x) => x.ozError)).toEqual(['NotAllowed (at enforce)']);
  });

  it('bounds signers at MAX_SIGNERS and validates their shape', () => {
    const doc = JSON.parse(JSON.stringify(freshDoc())) as {
      contextRules: { signers: unknown[] }[];
    };
    doc.contextRules[0]!.signers = Array.from({ length: 16 }, (_, i) => ({
      type: 'Delegated',
      address: contractId(`s${i}`),
    }));
    doc.contextRules[1]!.signers = [{ type: 'Delegated', address: 'bogus' }];
    const v = validateContextRuleDocument(
      parseContextRuleDocument({ ...(doc as object), schemaVersion: 2 }),
    );
    expect(v.map((x) => x.ozError)).toContain('TooManySigners');
    expect(v.map((x) => x.ozError)).toContain('FromVal(ConversionError)');
  });
});

describe('artifact → add_context_rule arguments', () => {
  const doc = freshDoc();
  const blndRule = doc.contextRules.find((r) => r.name === 'pw:xfer:BLND')!;
  const claimRule = doc.contextRules.find((r) => r.name === 'pw:claim')!;

  it('encodes Signer as the tuple-variant enum Vec[Symbol, …]', () => {
    const d = encodeSigner({ type: 'Delegated', address: G });
    expect(d.switch().name).toBe('scvVec');
    expect(symOf(d)).toBe('Delegated');
    expect(Address.fromScVal(d.vec()![1]!).toString()).toBe(G);
    const e = encodeSigner({ type: 'External', verifier: FREQ, keyData: 'ab'.repeat(32) });
    expect(symOf(e)).toBe('External');
    expect(e.vec()!).toHaveLength(3);
    expect(e.vec()![2]!.bytes()).toEqual(Buffer.from('ab'.repeat(32), 'hex'));
  });

  it('encodes ContextRuleType::CallContract and Option<u32>', () => {
    const ct = encodeContextType(blndRule);
    expect(symOf(ct)).toBe('CallContract');
    expect(Address.fromScVal(ct.vec()![1]!).toString()).toBe(BLND);
    expect(encodeOptionU32(null).switch().name).toBe('scvVoid');
    expect(encodeOptionU32(7).u32()).toBe(7);
  });

  it('encodes policies as Map<Address, Val> with the exact install params', () => {
    const m = encodePoliciesMap(blndRule);
    expect(m.switch().name).toBe('scvMap');
    const [entry] = m.map()!;
    expect(Address.fromScVal(entry!.key()).toString()).toBe(SPEND);
    expect(scValToNative(entry!.val())).toEqual({
      period_ledgers: 17280,
      spending_limit: 23533505n,
    });
    const f = encodePoliciesMap(claimRule).map()![0]!;
    expect(Address.fromScVal(f.key()).toString()).toBe(FREQ);
    expect(scValToNative(f.val())).toEqual({ max_calls: 5, window_secs: 86400n });
  });

  it('sorts map keys by address so install order is deterministic (row 31)', () => {
    const two = {
      ...blndRule,
      policies: [
        { ...blndRule.policies[0]!, address: BLND },
        { ...claimRule.policies[0]!, address: FREQ },
      ],
    };
    const keys = encodePoliciesMap(two)
      .map()!
      .map((e) => Address.fromScVal(e.key()).toString());
    expect(keys).toEqual(
      [...keys].sort((a, b) =>
        Buffer.compare(
          Address.fromString(a).toScVal().toXDR(),
          Address.fromString(b).toScVal().toXDR(),
        ),
      ),
    );
  });

  it('produces the five arguments in signature order (mod.rs:238-248)', () => {
    const args = buildAddContextRuleArgs(blndRule, HEAD + 518_400);
    expect(args).toHaveLength(5);
    expect(symOf(args[0]!)).toBe('CallContract');
    expect(args[1]!.str().toString()).toBe('pw:xfer:BLND');
    expect(args[2]!.u32()).toBe(HEAD + 518_400);
    expect(args[3]!.vec()!.map(symOf)).toEqual(['Delegated']);
    expect(args[4]!.switch().name).toBe('scvMap');
  });

  it('planInstall takes every value from the artifact and adds only head + lifetime', () => {
    const plan = planInstall(doc, HEAD);
    expect(plan.map((p) => p.name)).toEqual(['pw:claim', 'pw:swap', 'pw:xfer:BLND']);
    for (const p of plan) {
      expect(p.validUntil).toBe(HEAD + 518_400);
      expect(p.validUntilSource).toBe('head+lifetime');
      expect(p.signers).toEqual([{ type: 'Delegated', address: G }]);
    }
    const absolute = planInstall(freshDoc({ ...targets, ledgerHead: HEAD }), HEAD + 10);
    expect(absolute[0]?.validUntil).toBe(HEAD + 518_400);
    expect(absolute[0]?.validUntilSource).toBe('artifact');
  });

  it('planInstall refuses a design artifact and a stale absolute valid_until', () => {
    expect(() => planInstall(freshDoc(NO_INSTALL_TARGETS), HEAD)).toThrow(InstallError);
    try {
      planInstall(freshDoc(NO_INSTALL_TARGETS), HEAD);
    } catch (e) {
      expect((e as InstallError).code).toBe('SHAPE_INVALID');
    }
    const stale = freshDoc({ ...targets, ledgerHead: 1000 });
    expect(() => planInstall(stale, HEAD)).toThrow(/PastValidUntil/);
  });
});

describe('OZ authorization payload', () => {
  const account = 'CCW6R5ZKEIJJ75YT54TEHMRUYTP4XQGUI6H63EE3W65H4P4FAUICXP3Q';
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(account).toScAddress(),
        functionName: 'add_context_rule',
        args: [],
      }),
    ),
    subInvocations: [],
  });

  it('reproduces the FACTS §8.3 vector: signature_payload and the rule-bound auth_digest', () => {
    const payload = signaturePayload(
      Networks.TESTNET,
      xdr.Int64.fromString('123456789'),
      4_460_000,
      invocation,
    );
    expect(payload.toString('hex').startsWith('a5b01cb5')).toBe(true);
    expect(payload.toString('hex').endsWith('9ed0')).toBe(true);
    const digest = authDigest(payload, [0, 2]);
    expect(digest.toString('hex').startsWith('ad363bc7')).toBe(true);
    expect(digest.toString('hex').endsWith('c6f5')).toBe(true);
    // The appended bytes are the ScVal::Vec([U32 0, U32 2]) XDR.
    const ids = xdr.ScVal.scvVec([xdr.ScVal.scvU32(0), xdr.ScVal.scvU32(2)]).toXDR();
    expect(ids.toString('hex')).toBe('00000010000000010000000200000003000000000000000300000002');
    expect(digest).toEqual(hash(Buffer.concat([payload, ids])));
  });

  it('builds AuthPayload as the sorted ScMap __check_auth decodes (FACTS §8.3 prefix)', () => {
    const payload = buildAuthPayload([{ type: 'Delegated', address: G }], [0], new Map());
    expect(
      payload.toXDR('base64').startsWith('AAAAEQAAAAEAAAACAAAADwAAABBjb250ZXh0X3J1bGVfaWRz'),
    ).toBe(true);
    const keys = payload.map()!.map((e) => e.key().sym().toString());
    expect(keys).toEqual(['context_rule_ids', 'signers']);
    const native = scValToNative(payload) as {
      context_rule_ids: number[];
      signers: Map<unknown, unknown> | Record<string, unknown>;
    };
    expect(native.context_rule_ids).toEqual([0]);
    // A Delegated signer carries empty bytes — its proof is the nested entry.
    const signersMap = payload.map()![1]!.val().map()!;
    expect(signersMap).toHaveLength(1);
    expect(symOf(signersMap[0]!.key())).toBe('Delegated');
    expect(signersMap[0]!.val().bytes()).toHaveLength(0);
  });

  it('carries an External signature as the 64-byte map value', () => {
    const kp = Keypair.random();
    const signer = {
      type: 'External' as const,
      verifier: FREQ,
      keyData: kp.rawPublicKey().toString('hex'),
    };
    const sig = kp.sign(Buffer.alloc(32, 7));
    const payload = buildAuthPayload([signer], [0], new Map([[signerKey(signer), sig]]));
    const value = payload.map()![1]!.val().map()![0]!.val().bytes();
    expect(value).toHaveLength(64);
    expect(Buffer.from(value)).toEqual(sig);
  });

  it('builds the Delegated signer nested entry: SourceAccount credentials over __check_auth(digest)', () => {
    const digest = Buffer.alloc(32, 1);
    const entry = buildDelegatedCheckAuthEntry(account, digest);
    expect(entry.credentials().switch().name).toBe('sorobanCredentialsSourceAccount');
    const fn = entry.rootInvocation().function().contractFn();
    expect(Address.fromScAddress(fn.contractAddress()).toString()).toBe(account);
    expect(fn.functionName().toString()).toBe('__check_auth');
    expect(fn.args()).toHaveLength(1);
    expect(Buffer.from(fn.args()[0]!.bytes())).toEqual(digest);
    expect(entry.rootInvocation().subInvocations()).toHaveLength(0);
  });

  it('the local fallback signer is labelled, derives its public key, and exposes no secret', () => {
    const kp = Keypair.random();
    const signer = localFallbackSigner(kp.secret());
    expect(signer.mode).toBe('local-fallback');
    expect(signer.reason).toContain('fallback');
    expect(signer.reason).toContain('FACTS §8.4');
    expect(signer.publicKey).toBe(kp.publicKey());
    expect(JSON.stringify(signer)).not.toContain(kp.secret());
    expect(Object.keys(signer)).not.toContain('secret');
  });
});

describe('verify — decoding and the diff', () => {
  const doc = freshDoc();

  it('decodes the native ContextRule shape the SDK produces', () => {
    const rule = decodeContextRule({
      id: 1,
      context_type: ['CallContract', BLND],
      name: 'pw:xfer:BLND',
      signers: [['Delegated', G]],
      signer_ids: [0],
      policies: [SPEND],
      policy_ids: [1],
      valid_until: 4_982_780,
    });
    expect(rule).toEqual({
      id: 1,
      contextType: { type: 'CallContract', contract: BLND },
      name: 'pw:xfer:BLND',
      signers: [{ type: 'Delegated', address: G }],
      policies: [SPEND],
      validUntil: 4_982_780,
    });
    const admin = decodeContextRule({
      id: 0,
      context_type: 'Default',
      name: 'multisig',
      signers: [['Delegated', G]],
      policies: [],
      valid_until: null,
    });
    expect(admin.contextType).toEqual({ type: 'Default', contract: null });
    expect(admin.validUntil).toBeNull();
  });

  const installed: InstalledRule[] = [
    {
      id: 0,
      contextType: { type: 'Default', contract: null },
      name: 'multisig',
      signers: [{ type: 'Delegated', address: G }],
      policies: [],
      validUntil: null,
    },
    ...doc.contextRules.map((r, i) => ({
      id: i + 1,
      contextType: { type: 'CallContract', contract: r.contextType.contract },
      name: r.name,
      signers: [{ type: 'Delegated' as const, address: G }],
      policies: r.policies.map((p) => p.address as string),
      validUntil: HEAD + 518_400,
    })),
  ];
  const params = new Map<string, Record<string, string | number>>([
    [`1:${FREQ}`, { window_secs: '86400', max_calls: 5, call_history: '' }],
    [`2:${FREQ}`, { window_secs: '86400', max_calls: 5 }],
    [`3:${SPEND}`, { spending_limit: '23533505', period_ledgers: 17280, spent: '0' }],
  ]);
  const base = { account: 'CACCOUNT', network: 'testnet' as const, latestLedger: HEAD + 5, params };

  it('passes when every rule, signer set, policy set, param, and valid_until matches', () => {
    const report = diffRules(doc, installed, base);
    expect(report.pass).toBe(true);
    expect(report.rows.every((r) => r.ok)).toBe(true);
    expect(report.extraRules.map((r) => r.id)).toEqual([0]); // the admin rule, informational
  });

  it('matches valid_until against the install log when supplied', () => {
    const ok = diffRules(doc, installed, {
      ...base,
      expectedValidUntil: new Map([['pw:claim', HEAD + 518_400]]),
    });
    expect(ok.rows.find((r) => r.rule === 'pw:claim' && r.field === 'valid_until')?.ok).toBe(true);
    const bad = diffRules(doc, installed, {
      ...base,
      expectedValidUntil: new Map([['pw:claim', 1]]),
    });
    expect(bad.pass).toBe(false);
  });

  it('matches a re-installed artifact through the install log, not the first name hit', () => {
    // Installing the same artifact again appends ids 4-6 with the same names
    // and a later valid_until; the log of that install must find THAT set.
    const later = HEAD + 600_000;
    const reinstalled: InstalledRule[] = [
      ...installed,
      ...doc.contextRules.map((r, i) => ({
        id: i + 4,
        contextType: { type: 'CallContract', contract: r.contextType.contract },
        name: r.name,
        signers: [{ type: 'Delegated' as const, address: G }],
        policies: r.policies.map((p) => p.address as string),
        validUntil: later,
      })),
    ];
    const bothParams = new Map(params);
    bothParams.set(`4:${FREQ}`, { window_secs: '86400', max_calls: 5 });
    bothParams.set(`5:${FREQ}`, { window_secs: '86400', max_calls: 5 });
    bothParams.set(`6:${SPEND}`, { spending_limit: '23533505', period_ledgers: 17280 });
    const ruleIds = (report: ReturnType<typeof diffRules>): string[] =>
      report.rows.filter((r) => r.field === 'rule').map((r) => r.actual);

    const newLog = new Map(doc.contextRules.map((r) => [r.name, later]));
    const viaNewLog = diffRules(doc, reinstalled, {
      ...base,
      params: bothParams,
      expectedValidUntil: newLog,
    });
    expect(viaNewLog.pass).toBe(true);
    expect(ruleIds(viaNewLog)).toEqual([
      'installed as rule id 4',
      'installed as rule id 5',
      'installed as rule id 6',
    ]);
    expect(viaNewLog.extraRules.map((r) => r.id)).toEqual([0, 1, 2, 3]);

    const oldLog = new Map(doc.contextRules.map((r) => [r.name, HEAD + 518_400]));
    const viaOldLog = diffRules(doc, reinstalled, {
      ...base,
      params: bothParams,
      expectedValidUntil: oldLog,
    });
    expect(viaOldLog.pass).toBe(true);
    expect(ruleIds(viaOldLog)).toEqual([
      'installed as rule id 1',
      'installed as rule id 2',
      'installed as rule id 3',
    ]);

    // Without a log the lowest unmatched ids are taken and the newer set is extra.
    const noLog = diffRules(doc, reinstalled, { ...base, params: bothParams });
    expect(noLog.pass).toBe(true);
    expect(ruleIds(noLog)).toEqual([
      'installed as rule id 1',
      'installed as rule id 2',
      'installed as rule id 3',
    ]);
    expect(noLog.extraRules.map((r) => r.id)).toEqual([0, 4, 5, 6]);

    // A log that names a valid_until no installed rule carries still fails honestly.
    const wrongLog = new Map(doc.contextRules.map((r) => [r.name, 1]));
    expect(
      diffRules(doc, reinstalled, { ...base, params: bothParams, expectedValidUntil: wrongLog })
        .pass,
    ).toBe(false);
  });

  it('fails on a missing rule, a wrong param, a wrong signer, or an expired rule', () => {
    const missing = diffRules(doc, installed.slice(0, 3), base);
    expect(missing.rows.some((r) => r.field === 'rule' && r.actual === 'not installed')).toBe(true);
    expect(missing.pass).toBe(false);

    const wrongParams = new Map(params);
    wrongParams.set(`3:${SPEND}`, { spending_limit: '1', period_ledgers: 17280 });
    expect(diffRules(doc, installed, { ...base, params: wrongParams }).pass).toBe(false);

    const wrongSigner = installed.map((r) => (r.id === 2 ? { ...r, signers: [] } : r));
    const ws = diffRules(doc, wrongSigner, base);
    expect(ws.rows.find((r) => r.rule === 'pw:swap' && r.field === 'signers')?.ok).toBe(false);

    const expired = installed.map((r) => (r.id === 1 ? { ...r, validUntil: HEAD - 1 } : r));
    expect(
      diffRules(doc, expired, base).rows.find(
        (r) => r.rule === 'pw:claim' && r.field === 'valid_until',
      )?.ok,
    ).toBe(false);
  });
});

describe('synthetic recordings keep working with install targets', () => {
  it('a token rule with a cap carries the spending_limit address; signers everywhere', () => {
    const subject = contractId('wallet');
    const router = contractId('router');
    const usdc = token(contractId('usdc'), 'USDC');
    const tx = makeTx({
      subject,
      calls: [
        call(
          router,
          'swap',
          [],
          [auth(router, 'swap', [], [auth(usdc.contractId, 'transfer', [subject, router, 5n])])],
        ),
      ],
      flows: [flow(usdc, 'out', 5n)],
    });
    const spec = synthesize(tx, DEFAULT_SYNTH_CONFIG, 1_000_000, targets);
    for (const rule of spec.ozContextRules) {
      expect(rule.signers).toEqual(targets.signers);
      for (const b of rule.policies) {
        expect(b.address).toBe(b.policy === 'stock:spending_limit' ? SPEND : FREQ);
      }
    }
    expect(readFileSync(FRESH, 'utf8')).toContain(BLND); // sanity: the fixture path resolved
  });
});
