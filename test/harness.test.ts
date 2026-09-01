/**
 * D2.3 — the dry-run harness on the REAL recorded claim → swap sequence.
 *
 * Input: examples/live/recorded-claim-swap-fresh.json, the recorder's output for
 * testnet transactions 9fff676c… (Blend claim) and ae943f99… (Soroswap swap
 * BLND→USDC). test/recorder.test.ts proves that file re-assembles byte-for-byte
 * from the committed raw captures, so everything here runs on real data with
 * no network access.
 *
 * Covered: argument-constraint derivation on the real sequence, the approved
 * criterion case — "BLND→XLM denied when enabled" — in both modes, the probe
 * token, report rendering of deny reasons and flags, and byte-equality of the
 * two committed reports with what the harness produces.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isContractAddressShaped, nativeSacContractId } from '../src/network.js';
import {
  SYNTHETIC_PROBE_TOKEN,
  buildScenarios,
  probeTokenFor,
  renderReport,
  simulateCall,
  tokenLabelsFor,
} from '../src/simulate.js';
import { loadRecordedTx } from '../src/sources/recorded.js';
import { ARGUMENT_DERIVATION_RULES, SWAP_PATH_RULE, synthesize } from '../src/synthesizer.js';
import { DEFAULT_SYNTH_CONFIG, type CandidateCall, type SmartAccountSpec } from '../src/types.js';

const live = (name: string): string =>
  fileURLToPath(new URL(`../examples/live/${name}`, import.meta.url));

// Real testnet addresses from the fresh recording (FACTS.md §4.1, §4.2, §12).
const ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const BLND = 'CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF';
const USDC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const CLAIM_HASH = '9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6';
const SWAP_HASH = 'ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46';

const tx = loadRecordedTx(live('recorded-claim-swap-fresh.json'));
const NOW = tx.timestamp ?? 0;

function specWith(constrainArguments: boolean): SmartAccountSpec {
  return synthesize(tx, { ...DEFAULT_SYNTH_CONFIG, constrainArguments }, NOW);
}

/** The real observed swap with its route redirected: BLND→XLM instead of BLND→USDC. */
function blndToXlmSwap(): CandidateCall {
  const observed = tx.calls.find((c) => c.fnName === 'swap_exact_tokens_for_tokens');
  if (observed === undefined) {
    throw new Error('fresh recording has no swap call');
  }
  return {
    label: 'BLND→XLM',
    contract: ROUTER,
    fnName: 'swap_exact_tokens_for_tokens',
    args: observed.args.map((arg, i) => (i === 2 ? [BLND, XLM_SAC] : arg)),
    outflows: tx.flows.filter((f) => f.direction === 'out'),
    timestamp: NOW + 60,
    priorCallTimestamps: [],
  };
}

describe('native XLM Stellar Asset Contract', () => {
  it('derives the testnet address the recorder resolved live as `native`', () => {
    expect(nativeSacContractId('testnet')).toBe(XLM_SAC);
    const older = loadRecordedTx(live('recorded-claim-swap.json'));
    const native = older.flows.find((f) => f.asset.symbol === 'native');
    expect(native?.asset.contractId).toBe(XLM_SAC);
    expect(native?.asset.resolved).toBe(true);
  });

  it('derives a distinct, contract-shaped address per network', () => {
    const ids = (['testnet', 'mainnet', 'futurenet'] as const).map(nativeSacContractId);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(isContractAddressShaped(id)).toBe(true);
    }
  });

  it('the fresh recording never touched XLM, so XLM is a genuinely unobserved token', () => {
    expect(readFileSync(live('recorded-claim-swap-fresh.json'), 'utf8')).not.toContain(XLM_SAC);
  });
});

describe('argument-constraint derivation on the real sequence', () => {
  it('the rule table is exactly the documented swap-path rule', () => {
    expect(ARGUMENT_DERIVATION_RULES).toEqual([SWAP_PATH_RULE]);
    expect(SWAP_PATH_RULE.id).toBe('swap-path');
    expect(SWAP_PATH_RULE.argName).toBe('path');
  });

  it('derives one constraint: the swap path token set {BLND, USDC} at arg[2]', () => {
    const spec = specWith(false);
    expect(spec.argumentScopes).toEqual([
      {
        kind: 'argument-constraint',
        rule: 'swap-path',
        contract: ROUTER,
        fnName: 'swap_exact_tokens_for_tokens',
        argIndex: 2,
        argName: 'path',
        allowedTokens: [BLND, USDC],
      },
    ]);
  });

  it('does not treat the claim call (Vec<u32> reserve ids) as a route', () => {
    const claim = tx.calls.find((c) => c.fnName === 'claim');
    expect(claim).toBeDefined();
    expect(SWAP_PATH_RULE.select(claim!)).toBeNull();
  });

  it('is derived in both modes but enforced as a policy only when enabled', () => {
    expect(specWith(false).argumentScopes).toHaveLength(1);
    expect(specWith(false).policies.some((p) => p.kind === 'argument-constraint')).toBe(false);
    expect(specWith(true).policies.some((p) => p.kind === 'argument-constraint')).toBe(true);
  });

  it('records the composition delta honestly in the notes', () => {
    const note = specWith(true).notes.find((n) => n.includes('argument constraints'));
    expect(note).toContain('swap-path');
    expect(note).toContain('ENFORCED (deny)');
    expect(note).toContain('offline dry-run harness only');
    expect(specWith(false).notes.find((n) => n.includes('argument constraints'))).toContain(
      'advisory (flag)',
    );
  });
});

describe('criterion: BLND→XLM denied when enabled, flagged (permitted) when disabled', () => {
  const labels = tokenLabelsFor(tx, probeTokenFor(specWith(false), tx));

  it('disabled (default): the swap is permitted with a scope-gap flag', () => {
    const result = simulateCall(specWith(false), blndToXlmSwap(), labels);
    expect(result.decision).toBe('flag');
    expect(result.reasonCode).toBe('argument-constraint');
    expect(result.reason).toContain('permitted with a scope gap');
    expect(result.reason).toContain('constrainArguments is off');
    expect(result.reason).toContain(`unobserved XLM ${XLM_SAC}`);
    expect(result.reason).toContain('enable --constrain-arguments to deny it');
  });

  it('enabled: the swap is denied and the reason names the violated constraint', () => {
    const result = simulateCall(specWith(true), blndToXlmSwap(), labels);
    expect(result.decision).toBe('deny');
    expect(result.reasonCode).toBe('argument-constraint');
    expect(result.reason).toMatch(/^argument constraint violated: /);
    expect(result.reason).toContain('swap_exact_tokens_for_tokens arg[2] path (rule swap-path)');
    expect(result.reason).toContain(`{BLND ${BLND}, USDC ${USDC}}`);
    expect(result.reason).toContain(`routes through unobserved XLM ${XLM_SAC}`);
  });

  it('the observed BLND→USDC route is permitted in both modes', () => {
    for (const enabled of [false, true]) {
      const observed: CandidateCall = {
        ...blndToXlmSwap(),
        args: blndToXlmSwap().args.map((arg, i) => (i === 2 ? [BLND, USDC] : arg)),
      };
      expect(simulateCall(specWith(enabled), observed, labels).decision).toBe('permit');
    }
  });

  it('a candidate with no route argument is neither flagged nor denied by the constraint', () => {
    const noArgs: CandidateCall = { ...blndToXlmSwap(), args: [] };
    expect(simulateCall(specWith(true), noArgs, labels).decision).toBe('permit');
  });
});

describe('probe token for the unobserved-route scenario', () => {
  it('defaults to the network native XLM SAC when XLM was not observed', () => {
    const probe = probeTokenFor(specWith(false), tx);
    expect(probe.contractId).toBe(XLM_SAC);
    expect(probe.label).toBe('XLM');
    expect(probe.provenance).toContain('derived from the network passphrase');
  });

  it('falls back to the synthetic placeholder when XLM is itself in the observed set', () => {
    const older = loadRecordedTx(live('recorded-claim-swap.json')); // path [XLM, USDC]
    const spec = synthesize(older, DEFAULT_SYNTH_CONFIG, older.timestamp ?? 0);
    expect(spec.argumentScopes[0]?.allowedTokens).toContain(XLM_SAC);
    const probe = probeTokenFor(spec, older);
    expect(probe.contractId).toBe(SYNTHETIC_PROBE_TOKEN);
    expect(isContractAddressShaped(probe.contractId)).toBe(true);
    expect(probe.provenance).toContain('synthetic placeholder');
  });

  it('honours a contract-shaped override and rejects anything else', () => {
    const probe = probeTokenFor(specWith(false), tx, USDC);
    expect(probe.contractId).toBe(USDC);
    expect(probe.provenance).toContain('--probe-token');
    expect(() =>
      probeTokenFor(
        specWith(false),
        tx,
        'GBMWJIADBWN6FJUQPSVKWZE7ZFEPHEN2YBINQ7UVPHJ2WJW2SWI6WD4Q',
      ),
    ).toThrow(/probe token must be a contract address/);
    expect(() => probeTokenFor(specWith(false), tx, 'not-an-address')).toThrow();
  });
});

describe('buildScenarios on the real sequence', () => {
  it.each([false, true])('constrainArguments=%s: every scenario behaves as expected', (enabled) => {
    const spec = specWith(enabled);
    const labels = tokenLabelsFor(tx, probeTokenFor(spec, tx));
    const scenarios = buildScenarios(spec, tx);
    expect(scenarios).toHaveLength(6);
    for (const scenario of scenarios) {
      const result = simulateCall(spec, scenario.candidate, labels);
      expect(result.decision, scenario.candidate.label).toBe(scenario.expectedDecision);
      expect(result.reasonCode, scenario.candidate.label).toBe(scenario.expectedReasonCode);
    }
  });

  it('builds the criterion scenario from the REAL observed call with the route redirected', () => {
    const spec = specWith(true);
    const scenario = buildScenarios(spec, tx).find((s) => s.candidate.label.startsWith('BLND→XLM'));
    expect(scenario).toBeDefined();
    expect(scenario?.candidate.label).toBe('BLND→XLM swap (route through unobserved XLM)');
    expect(scenario?.expectedDecision).toBe('deny');
    const observed = tx.calls.find((c) => c.fnName === 'swap_exact_tokens_for_tokens');
    // amount_in, amount_out_min, to, deadline are the recorded values; only the path changes.
    expect(scenario?.candidate.args[0]).toBe(observed?.args[0]);
    expect(scenario?.candidate.args[1]).toBe(observed?.args[1]);
    expect(scenario?.candidate.args[2]).toEqual([BLND, XLM_SAC]);
    expect(scenario?.candidate.args[3]).toBe(observed?.args[3]);
    expect(scenario?.candidate.args[4]).toBe(observed?.args[4]);
    // Same BLND outflow as recorded, so only the route differs from the permitted replay.
    expect(scenario?.candidate.outflows.map((f) => f.amount)).toEqual([21394095n]);
    expect(
      buildScenarios(specWith(false), tx).find((s) => s.candidate.label.startsWith('BLND→XLM'))
        ?.expectedDecision,
    ).toBe('flag');
  });

  it('uses the --probe-token override in the scenario label and route', () => {
    const spec = specWith(true);
    const scenario = buildScenarios(spec, tx, { probeToken: SYNTHETIC_PROBE_TOKEN }).find((s) =>
      s.candidate.label.includes('probe'),
    );
    expect(scenario?.candidate.args[2]).toEqual([BLND, SYNTHETIC_PROBE_TOKEN]);
  });
});

/** Exactly what `npm run cli -- simulate --input <fresh> [--constrain-arguments]` prints. */
function cliReport(enabled: boolean): string {
  const spec = specWith(enabled);
  const probe = probeTokenFor(spec, tx);
  const labels = tokenLabelsFor(tx, probe);
  const results = buildScenarios(spec, tx).map((s) => simulateCall(spec, s.candidate, labels));
  return `${renderReport(results, { tx, spec, probe })}\n`;
}

describe('report rendering', () => {
  it('states the recording, the generated policy set, and the mode (enforced)', () => {
    const report = cliReport(true);
    expect(report).toContain('# policywright dry-run report');
    expect(report).toContain(
      `Recording: testnet, from rpc, tx ${CLAIM_HASH}, ${SWAP_HASH}; subject ${tx.subject}.`,
    );
    expect(report).toContain(
      'Generated policy set (context rule `pw:claim+swap`, 3 enforced policies):',
    );
    expect(report).toContain(
      '- spending-limit: BLND <= 2.3533505 per 86400s (observed gross out 2.1394095)',
    );
    expect(report).toContain('- frequency-limit: <= 5 call(s) per 86400s');
    expect(report).toContain(
      '- argument-constraint (swap-path): swap_exact_tokens_for_tokens arg[2] (path) restricted to 2 observed token(s)',
    );
    expect(report).toContain(
      'Argument constraints (`constrainArguments: true`): ENFORCED — a violation is denied.',
    );
    expect(report).toContain(
      '| BLND→XLM swap (route through unobserved XLM) | ⛔ deny (argument-constraint) | argument constraint violated: ',
    );
    expect(report).toContain(`- XLM = ${XLM_SAC} — native XLM Stellar Asset Contract on testnet`);
  });

  it('renders the flag row and the advisory legend when disabled', () => {
    const report = cliReport(false);
    expect(report).toContain(
      'Argument constraints (`constrainArguments: false`): advisory (default)',
    );
    expect(report).toContain('2 enforced policies');
    expect(report).toContain(
      '| BLND→XLM swap (route through unobserved XLM) | ⚠️ flag (argument-constraint) | permitted with a scope gap',
    );
    expect(report).toContain('⚠️ flag — every enforced check passed (the call would be permitted)');
    expect(report).toContain(`- BLND = ${BLND}`);
    expect(report).toContain(`- USDC = ${USDC}`);
  });

  it('still renders a bare table without a context', () => {
    const spec = specWith(false);
    const results = buildScenarios(spec, tx).map((s) => simulateCall(spec, s.candidate));
    const report = renderReport(results);
    expect(report).not.toContain('Recording:');
    expect(report).toContain('| Scenario | Decision | Reason |');
    // Without labels the reason still names the constraint and the raw address.
    expect(report).toContain(`routes through unobserved ${XLM_SAC}`);
  });
});

describe('committed reports for the real sequence are reproducible', () => {
  it('examples/live/simulation-report.md == simulate --input <fresh>', () => {
    expect(readFileSync(live('simulation-report.md'), 'utf8')).toBe(cliReport(false));
  });

  it('examples/live/simulation-report.constrained.md == simulate --input <fresh> --constrain-arguments', () => {
    expect(readFileSync(live('simulation-report.constrained.md'), 'utf8')).toBe(cliReport(true));
  });
});
