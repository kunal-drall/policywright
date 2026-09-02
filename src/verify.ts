/**
 * Verify: read a smart account's installed context rules and attached policy
 * parameters from chain and diff them against an emitted `context-rule.json`.
 * Read-only (simulated getters; nothing is signed or submitted), so this is
 * also the shape of the MCP `verify` tool. The diff logic is pure and
 * network-free ({@link diffRules}); {@link readInstalledRules} is the thin
 * RPC layer around it.
 */

import {
  Account,
  BASE_FEE,
  Contract,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { InstallError, serverFor } from './install.js';
import { signerKey } from './install.js';
import { NETWORK_PASSPHRASES } from './network.js';
import type { ContextRuleDocument } from './install-shape.js';
import type { Network, OzSigner } from './types.js';

/** A context rule as read from the account (decoded `ContextRule`, storage.rs:150-175). */
export interface InstalledRule {
  readonly id: number;
  readonly contextType: { readonly type: string; readonly contract: string | null };
  readonly name: string;
  readonly signers: readonly OzSigner[];
  /** Policy contract addresses, in the account's `policies` vector order. */
  readonly policies: readonly string[];
  readonly validUntil: number | null;
}

/** Install params read back from a policy contract for one (rule, account). */
export type InstalledParams = Record<string, string | number>;

/** One line of the verification diff. */
export interface DiffRow {
  readonly rule: string;
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
  readonly ok: boolean;
}

/** The verification outcome. */
export interface VerifyReport {
  readonly account: string;
  readonly network: Network;
  readonly latestLedger: number;
  readonly pass: boolean;
  readonly rows: readonly DiffRow[];
  /** Installed rules the artifact does not describe (e.g. the constructor's admin rule) — informational. */
  readonly extraRules: readonly InstalledRule[];
}

// A funded account is not needed: simulation of a read-only call only needs a
// syntactically valid source. The same all-zero throwaway the recorder uses.
const SIMULATION_SOURCE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32));

async function simulateCall(
  server: rpc.Server,
  network: Network,
  contract: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<{ value: unknown; latestLedger: number }> {
  const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, '0'), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASES[network],
  })
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(30)
    .build();
  let sim: rpc.Api.SimulateTransactionResponse;
  try {
    sim = await server.simulateTransaction(tx);
  } catch (cause) {
    throw new InstallError(
      'NETWORK',
      `RPC request for ${method} on ${contract} failed: ${(cause as Error).message}. Check the RPC endpoint and network.`,
    );
  }
  if (rpc.Api.isSimulationError(sim)) {
    throw new InstallError('NETWORK', `simulating ${method} on ${contract} failed: ${sim.error}`);
  }
  if (sim.result === undefined) {
    throw new InstallError('NETWORK', `simulating ${method} on ${contract} returned no value`);
  }
  return { value: scValToNative(sim.result.retval), latestLedger: sim.latestLedger };
}

/** Decode the native form of `Signer` (`["Delegated", addr]` / `["External", verifier, bytes]`). */
export function decodeSigner(native: unknown): OzSigner {
  if (!Array.isArray(native) || typeof native[0] !== 'string') {
    throw new InstallError('NETWORK', `unexpected Signer shape: ${JSON.stringify(native)}`);
  }
  const parts: readonly unknown[] = native;
  if (parts[0] === 'Delegated') {
    return { type: 'Delegated', address: String(parts[1]) };
  }
  const key: unknown = parts[2];
  const hex = key instanceof Uint8Array ? Buffer.from(key).toString('hex') : String(key);
  return { type: 'External', verifier: String(parts[1]), keyData: hex };
}

/** Decode the native form of `ContextRule`. */
export function decodeContextRule(native: unknown): InstalledRule {
  const r = native as {
    id: number;
    context_type: unknown;
    name: string;
    signers: unknown[];
    policies: string[];
    valid_until: number | null | undefined;
  };
  const ct = r.context_type;
  const contextType =
    Array.isArray(ct) && typeof ct[0] === 'string'
      ? { type: ct[0], contract: ct.length > 1 ? String(ct[1]) : null }
      : { type: String(ct), contract: null };
  return {
    id: r.id,
    contextType,
    name: r.name,
    signers: (r.signers ?? []).map(decodeSigner),
    policies: (r.policies ?? []).map(String),
    validUntil: typeof r.valid_until === 'number' ? r.valid_until : null,
  };
}

/** Read every context rule of the account (ids 0..count-1) via simulated getters. */
export async function readInstalledRules(
  network: Network,
  account: string,
  rpcUrl?: string,
): Promise<{ rules: InstalledRule[]; latestLedger: number }> {
  const server = serverFor(network, rpcUrl);
  const count = await simulateCall(server, network, account, 'get_context_rules_count');
  const n = Number(count.value);
  const rules: InstalledRule[] = [];
  let latestLedger = count.latestLedger;
  for (let id = 0; id < n; id += 1) {
    const r = await simulateCall(
      server,
      network,
      account,
      'get_context_rule',
      xdr.ScVal.scvU32(id),
    );
    latestLedger = r.latestLedger;
    rules.push(decodeContextRule(r.value));
  }
  return { rules, latestLedger };
}

/** Read the params a policy stored for (rule, account), by binding kind. */
export async function readInstalledParams(
  network: Network,
  policyKind: string,
  policyAddress: string,
  ruleId: number,
  account: string,
  rpcUrl?: string,
): Promise<InstalledParams> {
  const server = serverFor(network, rpcUrl);
  const getter =
    policyKind === 'stock:spending_limit'
      ? 'get_spending_limit_data'
      : policyKind === 'custom:FrequencyLimitPolicy'
        ? 'get_frequency_limit_data'
        : null;
  if (getter === null) {
    throw new InstallError('BAD_INPUT', `no getter known for policy kind ${policyKind}`);
  }
  const r = await simulateCall(
    server,
    network,
    policyAddress,
    getter,
    xdr.ScVal.scvU32(ruleId),
    new Contract(account).address().toScVal(),
  );
  const data = r.value as Record<string, unknown>;
  const out: InstalledParams = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'bigint') {
      out[k] = v.toString();
    } else if (typeof v === 'number' || typeof v === 'string') {
      out[k] = v;
    }
  }
  return out;
}

/** Params the artifact expects, normalised to the same string/number form as {@link readInstalledParams}. */
function expectedParams(installParams: Record<string, unknown>): InstalledParams {
  const out: InstalledParams = {};
  for (const [k, v] of Object.entries(installParams)) {
    if (typeof v === 'bigint') {
      out[k] = v.toString();
    } else if (typeof v === 'number' || typeof v === 'string') {
      out[k] = v;
    }
  }
  return out;
}

/** Options for {@link diffRules}. */
export interface DiffOptions {
  readonly account: string;
  readonly network: Network;
  readonly latestLedger: number;
  /** Params read from each policy, keyed `<ruleId>:<policyAddress>`. */
  readonly params: ReadonlyMap<string, InstalledParams>;
  /** Expected absolute valid_until per artifact rule name (from the install log), when known. */
  readonly expectedValidUntil?: ReadonlyMap<string, number>;
}

/**
 * Find the installed rule an artifact rule describes. A rule matches by
 * (context type, CallContract contract, name). The same artifact can be
 * installed more than once into one account (every install appends new rule
 * ids with the same names), so when the install log says which `valid_until`
 * this install produced, the installed rule carrying exactly that value is
 * preferred; otherwise the lowest-id unmatched match is taken. Each installed
 * rule is matched at most once (`matched`).
 */
export function findInstalledRule(
  installed: readonly InstalledRule[],
  rule: ContextRuleDocument['contextRules'][number],
  expectedValidUntil: number | undefined,
  matched: Set<number>,
): InstalledRule | undefined {
  const candidates = installed.filter(
    (r) =>
      r.contextType.type === rule.contextType.type &&
      r.contextType.contract === rule.contextType.contract &&
      r.name === rule.name &&
      !matched.has(r.id),
  );
  const found =
    (expectedValidUntil === undefined
      ? undefined
      : candidates.find((r) => r.validUntil === expectedValidUntil)) ?? candidates[0];
  if (found !== undefined) {
    matched.add(found.id);
  }
  return found;
}

/**
 * Diff the artifact against what is installed. A rule matches by
 * (CallContract contract, name) — see {@link findInstalledRule} for how a
 * re-installed artifact is matched. Pure and network-free.
 */
export function diffRules(
  doc: ContextRuleDocument,
  installed: readonly InstalledRule[],
  options: DiffOptions,
): VerifyReport {
  const rows: DiffRow[] = [];
  const matched = new Set<number>();
  for (const rule of doc.contextRules) {
    const found = findInstalledRule(
      installed,
      rule,
      options.expectedValidUntil?.get(rule.name),
      matched,
    );
    if (found === undefined) {
      rows.push({
        rule: rule.name,
        field: 'rule',
        expected: `CallContract(${rule.contextType.contract}) "${rule.name}"`,
        actual: 'not installed',
        ok: false,
      });
      continue;
    }
    rows.push({
      rule: rule.name,
      field: 'rule',
      expected: `CallContract(${rule.contextType.contract}) "${rule.name}"`,
      actual: `installed as rule id ${found.id}`,
      ok: true,
    });

    // signers — set equality
    const expSigners = [...rule.signers].map(signerKey).sort();
    const actSigners = [...found.signers].map(signerKey).sort();
    rows.push({
      rule: rule.name,
      field: 'signers',
      expected: expSigners.join(', ') || '(none)',
      actual: actSigners.join(', ') || '(none)',
      ok: JSON.stringify(expSigners) === JSON.stringify(actSigners),
    });

    // policies — set equality on addresses
    const expPolicies = rule.policies.map((p) => p.address ?? '(null)').sort();
    const actPolicies = [...found.policies].sort();
    rows.push({
      rule: rule.name,
      field: 'policies',
      expected: expPolicies.join(', '),
      actual: actPolicies.join(', ') || '(none)',
      ok: JSON.stringify(expPolicies) === JSON.stringify(actPolicies),
    });

    // params — per binding, read back from the policy contract
    for (const binding of rule.policies) {
      if (binding.address === null) {
        continue;
      }
      const actual = options.params.get(`${found.id}:${binding.address}`);
      const expected = expectedParams(binding.installParams);
      const ok =
        actual !== undefined &&
        Object.entries(expected).every(([k, v]) => String(actual[k]) === String(v));
      rows.push({
        rule: rule.name,
        field: `${binding.policy} params`,
        expected: JSON.stringify(expected),
        actual:
          actual === undefined
            ? 'unreadable'
            : JSON.stringify(Object.fromEntries(Object.keys(expected).map((k) => [k, actual[k]]))),
        ok,
      });
    }

    // valid_until — a ledger sequence not yet passed; equal to the install log when supplied
    const exp = options.expectedValidUntil?.get(rule.name);
    const notExpired = found.validUntil === null || found.validUntil >= options.latestLedger;
    rows.push({
      rule: rule.name,
      field: 'valid_until',
      expected:
        exp !== undefined
          ? `${exp} (install log)`
          : rule.validUntilLedger !== null
            ? `${rule.validUntilLedger}`
            : `head at install + ${rule.lifetimeLedgers ?? '?'} ledgers, ≥ current ${options.latestLedger}`,
      actual: found.validUntil === null ? 'None' : `${found.validUntil}`,
      ok:
        exp !== undefined
          ? found.validUntil === exp
          : rule.validUntilLedger !== null
            ? found.validUntil === rule.validUntilLedger
            : notExpired && found.validUntil !== null,
    });
  }
  const extraRules = installed.filter((r) => !matched.has(r.id));
  return {
    account: options.account,
    network: options.network,
    latestLedger: options.latestLedger,
    pass: rows.every((r) => r.ok),
    rows,
    extraRules,
  };
}

/**
 * The per-rule `valid_until` an install log recorded, keyed by rule name —
 * the `--install-log` input of `verify`. Throws BAD_INPUT on any other shape.
 */
export function expectedValidUntilFromInstallLog(log: unknown): Map<string, number> {
  const results =
    typeof log === 'object' && log !== null
      ? (log as Record<string, unknown>)['results']
      : undefined;
  if (!Array.isArray(results)) {
    throw new InstallError(
      'BAD_INPUT',
      'install log must be a policywright install log with a results array',
    );
  }
  const out = new Map<string, number>();
  results.forEach((r: unknown, i) => {
    const row = r as { rule?: unknown; validUntil?: unknown };
    if (typeof row.rule !== 'string' || typeof row.validUntil !== 'number') {
      throw new InstallError(
        'BAD_INPUT',
        `install log results[${i}] must carry a rule name and a numeric validUntil`,
      );
    }
    out.set(row.rule, row.validUntil);
  });
  return out;
}

/** Options for {@link verifyArtifact}. */
export interface VerifyOptions {
  readonly network: Network;
  readonly account: string;
  readonly rpcUrl?: string;
  /** From {@link expectedValidUntilFromInstallLog}, when an install log is supplied. */
  readonly expectedValidUntil?: ReadonlyMap<string, number>;
}

/** The outcome of {@link verifyArtifact}: the report plus non-fatal read warnings. */
export interface VerifyOutcome {
  readonly report: VerifyReport;
  /** Policy params that could not be read back (the row then shows `unreadable`). */
  readonly warnings: readonly string[];
}

/**
 * Verify an emitted artifact against what a smart account has installed:
 * read every rule, read the params of each bound policy the account actually
 * carries, and diff. Read-only. This is the composition the CLI `verify`
 * command and the MCP `verify` tool share; {@link diffRules} is its pure core.
 */
export async function verifyArtifact(
  doc: ContextRuleDocument,
  options: VerifyOptions,
): Promise<VerifyOutcome> {
  const { network, account, rpcUrl } = options;
  const { rules, latestLedger } = await readInstalledRules(network, account, rpcUrl);
  const params = new Map<string, InstalledParams>();
  const warnings: string[] = [];
  const matched = new Set<number>();
  for (const rule of doc.contextRules) {
    const found = findInstalledRule(
      rules,
      rule,
      options.expectedValidUntil?.get(rule.name),
      matched,
    );
    if (found === undefined) {
      continue;
    }
    for (const binding of rule.policies) {
      if (binding.address !== null && found.policies.includes(binding.address)) {
        try {
          params.set(
            `${found.id}:${binding.address}`,
            await readInstalledParams(
              network,
              binding.policy,
              binding.address,
              found.id,
              account,
              rpcUrl,
            ),
          );
        } catch (cause) {
          warnings.push(
            `could not read ${binding.policy} params for rule ${found.id}: ${(cause as Error).message}`,
          );
        }
      }
    }
  }
  const report = diffRules(doc, rules, {
    account,
    network,
    latestLedger,
    params,
    ...(options.expectedValidUntil === undefined
      ? {}
      : { expectedValidUntil: options.expectedValidUntil }),
  });
  return { report, warnings };
}

/** Render a verification report as Markdown. */
export function renderVerifyReport(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(`# policywright verify — ${report.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(
    `Account: ${report.account} (${report.network}); read at ledger ${report.latestLedger}.`,
  );
  lines.push('');
  lines.push('| Rule | Field | Expected (artifact) | Actual (on-chain) | OK |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of report.rows) {
    lines.push(`| ${r.rule} | ${r.field} | ${r.expected} | ${r.actual} | ${r.ok ? '✅' : '❌'} |`);
  }
  lines.push('');
  if (report.extraRules.length > 0) {
    lines.push('Installed rules not described by the artifact (informational):');
    for (const r of report.extraRules) {
      lines.push(
        `- id ${r.id}: ${r.contextType.type}${r.contextType.contract === null ? '' : `(${r.contextType.contract})`} "${r.name}", ${r.signers.length} signer(s), ${r.policies.length} polic${r.policies.length === 1 ? 'y' : 'ies'}, valid_until ${r.validUntil ?? 'None'}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
