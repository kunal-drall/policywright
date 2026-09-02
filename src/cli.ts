/**
 * policywright command-line entry point.
 *
 *   demo                 run the end-to-end demo and self-check (see demo.ts)
 *   synth                synthesize a spec from the baked-in fixture (or --input) and print it
 *   simulate             run the dry-run scenarios against the fixture's (or --input) spec
 *   record <hash...>     fetch a transaction sequence by hash (or ingest a saved
 *                        simulation with --from-simulation) and print the merged
 *                        RecordedTx
 *   install              build, simulate, sign (client-side) and submit the
 *                        add_context_rule transactions for an emitted
 *                        context-rule.json — the explicit human-initiated step
 *   verify               read an account's installed rules + policy params and
 *                        diff them against an emitted context-rule.json
 *
 * synth and simulate accept SynthConfig overrides as flags (see USAGE); any
 * flag left out keeps its documented default from DEFAULT_SYNTH_CONFIG.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from './emitter.js';
import {
  InstallError,
  installRule,
  localFallbackSigner,
  planInstall,
  serverFor,
  type InstallResult,
} from './install.js';
import { parseContextRuleDocument, validateContextRuleDocument } from './install-shape.js';
import { CONTRACT_ADDRESS_SHAPE, isContractAddressShaped } from './network.js';
import {
  diffRules,
  readInstalledParams,
  readInstalledRules,
  renderVerifyReport,
  type InstalledParams,
} from './verify.js';
import { runDemo } from './demo.js';
import { loadFixture } from './sources/fixture.js';
import { loadRecordedTx } from './sources/recorded.js';
import { recordFromHashes, tokenResolverFor } from './sources/rpc.js';
import { ingestSimulation } from './sources/simulation.js';
import { badInput } from './sources/errors.js';
import {
  buildScenarios,
  probeTokenFor,
  renderReport,
  simulateCall,
  tokenLabelsFor,
} from './simulate.js';
import { synthesize } from './synthesizer.js';
import {
  DEFAULT_SYNTH_CONFIG,
  NO_INSTALL_TARGETS,
  type InstallTargets,
  type Network,
  type OzSigner,
  type RecordedTx,
  type SynthConfig,
} from './types.js';

const D = DEFAULT_SYNTH_CONFIG;

const USAGE = `policywright — synthesize a least-privilege smart-account authorization

Usage:
  npm run demo                          end-to-end demo + dry-run self-check
  npm run cli -- synth     [synth-flags] synthesize from the baked-in fixture
  npm run cli -- simulate  [synth-flags] dry-run scenarios against the spec
                                        (permit / deny / flag report)
  npm run record -- <txHash> [<txHash> ...] [record-flags]
  npm run record -- --from-simulation <file.json> [record-flags]
  npm run cli -- install --artifact <context-rule.json> --account <C...> [install-flags]
  npm run cli -- verify  --artifact <context-rule.json> --account <C...> [verify-flags]

Record flags:
  --network <n>            testnet|mainnet|futurenet (testnet)
  --rpc-url <url>          override the network's public RPC endpoint
  --account <G...|C...>    account movements are attributed to; without it the
                           first transaction's source account is assumed (a
                           warning records the assumption — smart-account flows
                           usually act through a C... address, not the source)
  --from-simulation <file> ingest a saved simulateTransaction exchange instead
                           of fetching hashes (source: "simulation")

A multi-step flow (e.g. Blend claim then Soroswap swap) is several hashes —
Soroban allows one InvokeHostFunction per transaction. Passing every hash
merges them into ONE RecordedTx ordered by ledger close time.

Synthesis flags (defaults in parentheses):
  --input <recorded.json>    synthesize from a saved record output instead of
                             the baked-in fixture (e.g. examples/live/recorded-claim-swap.json)
  --out <dir>                (synth) write spec.json, context-rule.json, summary.txt
                             and FrequencyLimitPolicy.rs into <dir> instead of
                             printing them
  --lifetime <secs>          context-rule lifetime (${D.lifetimeSecs})
  --spend-window <secs>      spend-cap rolling window (${D.spendWindowSecs})
  --cap-multiplier <number>  cap = observed gross out * this (${D.capMultiplier})
  --frequency-window <secs>  frequency rolling window (${D.frequencyWindowSecs})
  --frequency-max <count>    max calls per frequency window (${D.frequencyMaxCalls})
  --constrain-arguments      enforce the derived argument constraints (swap-path
                             token set): a violating route is DENIED. Default
                             off: the route is permitted and FLAGGED instead.

Install targets (synth; deploy-time facts the artifact must carry to install as-is):
  --signer delegated:<G...|C...>            rule signer in the real OZ Signer shape
  --signer external:<verifier C...>:<hex>   (repeatable; ≤ 15)
  --policy-address <policy>=<C...>          deployed policy contract per binding kind
                             (custom:FrequencyLimitPolicy, stock:spending_limit)
  --ledger-head <n>          live ledger head → absolute validUntilLedger; omit to
                             emit the relative lifetimeLedgers only

Simulate flags:
  --probe-token <C...>       token the unobserved-route scenario routes through
                             (default: the network's native XLM SAC, unless XLM
                             was observed — then a synthetic placeholder)

Install flags (testnet only; the signer is STELLAR_SECRET_KEY from the
environment — never an argument — and is never printed):
  --artifact <context-rule.json>  the emitted artifact, consumed unmodified
  --account <C...>           the OZ smart account to install into
  --admin-rule-id <n>        the account's admin rule (default 0, the constructor's)
  --admin-signer <spec>      the admin rule's signer(s) (same syntax as --signer);
                             default: delegated:<the signing key's public key>
  --dry-run                  simulate everything (incl. auth entries), submit nothing
  --source <G...>            (dry-run only) the intended transaction source when
                             STELLAR_SECRET_KEY is not set
  --out <install-log.json>   write the machine-readable install log
  --network <n>, --rpc-url <url>

Verify flags:
  --artifact, --account, --network, --rpc-url as above
  --install-log <json>       compare valid_until with what the install computed
  --out <verify.md>          write the Markdown report

Networks default to testnet.`;

/** Minimal `--key value` / `--key=value` flag parser. */
function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith('--')) {
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(arg.slice(2), next);
        i += 1;
      } else {
        flags.set(arg.slice(2), 'true');
      }
    }
  }
  return flags;
}

/** Parse a flag as a finite number, throwing a clear error otherwise. */
function numberFlag(flags: Map<string, string>, key: string, fallback: number): number {
  const raw = flags.get(key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${key} must be a number, got "${raw}"`);
  }
  return value;
}

/** A boolean flag is true when present unless explicitly set to "false". */
function boolFlag(flags: Map<string, string>, key: string, fallback: boolean): boolean {
  const raw = flags.get(key);
  if (raw === undefined) {
    return fallback;
  }
  return raw !== 'false';
}

/** Every value of a repeatable `--key value` / `--key=value` flag, in order. */
function multiFlag(args: readonly string[], key: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === `--${key}`) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        values.push(next);
        i += 1;
      }
    } else if (arg?.startsWith(`--${key}=`)) {
      values.push(arg.slice(key.length + 3));
    }
  }
  return values;
}

/** Parse `delegated:<addr>` / `external:<verifier>:<hex>` into an OZ signer. */
function parseSigner(spec: string): OzSigner {
  const [kind, ...rest] = spec.split(':');
  if (kind === 'delegated' && rest.length === 1 && rest[0] !== undefined) {
    return { type: 'Delegated', address: rest[0] };
  }
  if (kind === 'external' && rest.length === 2 && rest[0] !== undefined && rest[1] !== undefined) {
    return { type: 'External', verifier: rest[0], keyData: rest[1] };
  }
  throw new Error(
    `--signer must be delegated:<G...|C...> or external:<verifier C...>:<hex pubkey>, got "${spec}"`,
  );
}

/** Build InstallTargets from the repeatable synth flags. */
function parseInstallTargets(args: readonly string[], flags: Map<string, string>): InstallTargets {
  const signers = multiFlag(args, 'signer').map(parseSigner);
  const policyAddresses: Record<string, string> = {};
  for (const entry of multiFlag(args, 'policy-address')) {
    const eq = entry.indexOf('=');
    const policy = eq === -1 ? '' : entry.slice(0, eq);
    const address = eq === -1 ? '' : entry.slice(eq + 1);
    if (policy !== 'custom:FrequencyLimitPolicy' && policy !== 'stock:spending_limit') {
      throw new Error(
        `--policy-address must be custom:FrequencyLimitPolicy=<C...> or stock:spending_limit=<C...>, got "${entry}"`,
      );
    }
    if (!CONTRACT_ADDRESS_SHAPE.test(address)) {
      throw new Error(`--policy-address ${policy}: "${address}" is not a C... contract address`);
    }
    policyAddresses[policy] = address;
  }
  const head = flags.get('ledger-head');
  const ledgerHead = head === undefined ? null : numberFlag(flags, 'ledger-head', 0);
  if (signers.length === 0 && Object.keys(policyAddresses).length === 0 && ledgerHead === null) {
    return NO_INSTALL_TARGETS;
  }
  return { signers, policyAddresses, ledgerHead };
}

/** Build a SynthConfig from flags, overriding documented defaults. */
function parseSynthConfig(flags: Map<string, string>): SynthConfig {
  return {
    lifetimeSecs: numberFlag(flags, 'lifetime', D.lifetimeSecs),
    spendWindowSecs: numberFlag(flags, 'spend-window', D.spendWindowSecs),
    capMultiplier: numberFlag(flags, 'cap-multiplier', D.capMultiplier),
    frequencyWindowSecs: numberFlag(flags, 'frequency-window', D.frequencyWindowSecs),
    frequencyMaxCalls: numberFlag(flags, 'frequency-max', D.frequencyMaxCalls),
    constrainArguments: boolFlag(flags, 'constrain-arguments', D.constrainArguments),
  };
}

function parseNetwork(value: string | undefined): Network {
  if (value === undefined) {
    return 'testnet';
  }
  if (value !== 'testnet' && value !== 'mainnet' && value !== 'futurenet') {
    throw new Error(`unknown network "${value}" (expected testnet, mainnet, or futurenet)`);
  }
  return value;
}

/**
 * Serialise a RecordedTx to JSON: bigints as decimal strings, byte arguments
 * as `hex:<...>` strings (JSON.stringify would otherwise explode a Uint8Array
 * into an index-keyed object).
 */
function recordedTxToJson(tx: RecordedTx): string {
  return JSON.stringify(
    tx,
    // Must be a `function` (not arrow) to reach `this[key]`: JSON.stringify
    // applies Buffer.prototype.toJSON BEFORE the replacer sees the value, so
    // byte arguments must be intercepted on the holder object.
    function (this: Record<string, unknown>, key: string, value: unknown) {
      const raw = this[key];
      if (raw instanceof Uint8Array) {
        return `hex:${Buffer.from(raw).toString('hex')}`;
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    },
    2,
  );
}

function cmdSynth(
  config: SynthConfig,
  inputPath: string | undefined,
  outDir: string | undefined,
  targets: InstallTargets,
): void {
  const tx = inputPath === undefined ? loadFixture() : loadRecordedTx(inputPath);
  const spec = synthesize(tx, config, tx.timestamp ?? 0, targets);
  const artifacts = emit(tx, spec);
  if (outDir !== undefined) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'summary.txt'), artifacts.summary);
    writeFileSync(join(outDir, 'spec.json'), `${artifacts.specJson}\n`);
    writeFileSync(join(outDir, 'context-rule.json'), `${artifacts.contextRuleJson}\n`);
    writeFileSync(join(outDir, 'FrequencyLimitPolicy.rs'), artifacts.rustPolicy);
    process.stdout.write(artifacts.summary);
    process.stdout.write(`Artefacts written to ${outDir}/\n`);
    return;
  }
  process.stdout.write(artifacts.summary);
  process.stdout.write('\n--- spec.json ---\n');
  process.stdout.write(`${artifacts.specJson}\n`);
  process.stdout.write('\n--- context-rule.json ---\n');
  process.stdout.write(`${artifacts.contextRuleJson}\n`);
}

function cmdSimulate(
  config: SynthConfig,
  inputPath: string | undefined,
  probeToken: string | undefined,
): void {
  const tx = inputPath === undefined ? loadFixture() : loadRecordedTx(inputPath);
  const spec = synthesize(tx, config, tx.timestamp ?? 0);
  const probe = probeTokenFor(spec, tx, probeToken);
  const labels = tokenLabelsFor(tx, probe);
  const results = buildScenarios(spec, tx, probeToken === undefined ? {} : { probeToken }).map(
    (s) => simulateCall(spec, s.candidate, labels),
  );
  process.stdout.write(`${renderReport(results, { tx, spec, probe })}\n`);
}

/** Positional (non-flag) arguments, skipping each flag's value token. */
function positionalArgs(rest: readonly string[]): string[] {
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith('--')) {
      // `--flag value` consumes the next token; `--flag=value` does not.
      const next = rest[i + 1];
      if (!arg.includes('=') && next !== undefined && !next.startsWith('--')) {
        i += 1;
      }
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

async function cmdRecord(rest: readonly string[]): Promise<void> {
  const flags = parseFlags(rest);
  const hashes = positionalArgs(rest);
  const network = parseNetwork(flags.get('network'));
  const rpcUrl = flags.get('rpc-url');
  const account = flags.get('account');
  const simulationFile = flags.get('from-simulation');

  let tx: RecordedTx;
  if (simulationFile !== undefined) {
    if (hashes.length > 0) {
      throw badInput('--from-simulation cannot be combined with transaction hashes');
    }
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(simulationFile, 'utf8'));
    } catch (cause) {
      throw badInput(
        `could not read simulation file ${simulationFile}: ${(cause as Error).message}`,
      );
    }
    tx = await ingestSimulation(doc, {
      network,
      ...(account === undefined ? {} : { account }),
      resolveToken: tokenResolverFor(network, rpcUrl),
    });
  } else {
    if (hashes.length === 0) {
      throw badInput(
        'record requires at least one transaction hash (or --from-simulation <file>): ' +
          'npm run record -- <txHash> [<txHash> ...]',
      );
    }
    tx = await recordFromHashes(hashes, {
      network,
      ...(rpcUrl === undefined ? {} : { rpcUrl }),
      ...(account === undefined ? {} : { account }),
    });
  }
  process.stdout.write(`${recordedTxToJson(tx)}\n`);
}

/** Load and shape-check an emitted artifact for install/verify. */
function loadArtifact(path: string | undefined, forInstall: boolean) {
  if (path === undefined) {
    throw new Error('--artifact <context-rule.json> is required');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`could not read artifact ${path}: ${(cause as Error).message}`);
  }
  const doc = parseContextRuleDocument(raw);
  const violations = validateContextRuleDocument(doc, { forInstall });
  return { doc, violations };
}

function requireAccount(flags: Map<string, string>): string {
  const account = flags.get('account');
  if (account === undefined || !isContractAddressShaped(account)) {
    throw new Error('--account <C...> (the smart account contract address) is required');
  }
  return account;
}

async function cmdInstall(rest: readonly string[]): Promise<void> {
  const flags = parseFlags(rest);
  const network = parseNetwork(flags.get('network'));
  if (network !== 'testnet') {
    throw new Error(`install is testnet-only (got --network ${network})`);
  }
  const account = requireAccount(flags);
  const dryRun = boolFlag(flags, 'dry-run', false);
  const { doc, violations } = loadArtifact(flags.get('artifact'), true);
  if (violations.length > 0) {
    const report = violations.map(
      (v) => `  - ${v.path}: ${v.ozError} — ${v.message} (${v.source})`,
    );
    throw new Error(`[SHAPE_INVALID] the artifact would not install as-is:\n${report.join('\n')}`);
  }
  const secret = process.env['STELLAR_SECRET_KEY'];
  let signer;
  if (secret !== undefined && secret !== '') {
    signer = localFallbackSigner(secret);
  } else if (dryRun && flags.get('source') !== undefined) {
    const source = flags.get('source') as string;
    signer = {
      mode: 'local-fallback' as const,
      reason:
        'dry run without a key: --source names the intended transaction source; nothing is signed',
      publicKey: source,
      signTransaction: () => Promise.reject(new Error('dry run: no key to sign with')),
      signDigest: () => null,
    };
  } else {
    throw new Error(
      'STELLAR_SECRET_KEY is not set in the environment (source it from the gitignored .env — never pass it as an argument); for a key-less --dry-run pass --source <G...>',
    );
  }
  const adminSigners: OzSigner[] =
    multiFlag(rest, 'admin-signer').length > 0
      ? multiFlag(rest, 'admin-signer').map(parseSigner)
      : [{ type: 'Delegated', address: signer.publicKey }];
  const adminRuleId = numberFlag(flags, 'admin-rule-id', 0);
  const rpcUrl = flags.get('rpc-url');
  const server = serverFor(network, rpcUrl);
  const head = (await server.getLatestLedger()).sequence;
  const plan = planInstall(doc, head);

  process.stdout.write(
    `policywright install — ${dryRun ? 'DRY RUN (nothing submitted)' : 'TESTNET'}\n`,
  );
  process.stdout.write(`account      : ${account}\n`);
  process.stdout.write(
    `admin rule   : ${adminRuleId} (${adminSigners.map((sg) => (sg.type === 'Delegated' ? `Delegated(${sg.address})` : `External(${sg.verifier}, …)`)).join(', ')})\n`,
  );
  process.stdout.write(`signing mode : ${signer.mode} — ${signer.reason}\n`);
  process.stdout.write(`ledger head  : ${head}\n`);
  process.stdout.write(`rules        : ${plan.length}\n\n`);

  const results: InstallResult[] = [];
  for (const rule of plan) {
    process.stdout.write(
      `→ ${rule.name}  CallContract(${rule.contract})  valid_until ${rule.validUntil} (${rule.validUntilSource})  policies: ${rule.policies.map((p) => `${p.policy}@${p.address}`).join(', ')}\n`,
    );
    const result = await installRule(rule, signer, {
      network,
      ...(rpcUrl === undefined ? {} : { rpcUrl }),
      account,
      adminRuleId,
      adminSigners,
      dryRun,
    });
    results.push(result);
    process.stdout.write(
      result.submitted
        ? `  ✓ installed as rule id ${result.contextRuleId ?? '?'} — tx ${result.txHash} (ledger ${result.ledger}); auth entries ${result.authEntries}, digest ${result.auth.digestHex.slice(0, 16)}…\n`
        : `  ✓ simulation passed (enforcing, ${result.authEntries} auth entries, min resource fee ${result.simulation.minResourceFee}); not submitted\n`,
    );
  }
  const log = {
    generatedBy: 'policywright install',
    at: new Date().toISOString(),
    network,
    account,
    adminRuleId,
    adminSigners,
    signingMode: signer.mode,
    signingReason: signer.reason,
    dryRun,
    ledgerHeadAtPlan: head,
    artifact: flags.get('artifact'),
    results,
  };
  const out = flags.get('out');
  if (out !== undefined) {
    writeFileSync(out, `${JSON.stringify(log, null, 2)}\n`);
    process.stdout.write(`\ninstall log written to ${out}\n`);
  }
}

async function cmdVerify(rest: readonly string[]): Promise<void> {
  const flags = parseFlags(rest);
  const network = parseNetwork(flags.get('network'));
  const account = requireAccount(flags);
  const rpcUrl = flags.get('rpc-url');
  const { doc } = loadArtifact(flags.get('artifact'), false);
  const { rules, latestLedger } = await readInstalledRules(network, account, rpcUrl);
  const params = new Map<string, InstalledParams>();
  for (const rule of doc.contextRules) {
    const found = rules.find(
      (r) => r.contextType.contract === rule.contextType.contract && r.name === rule.name,
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
          process.stderr.write(
            `warning: could not read ${binding.policy} params for rule ${found.id}: ${(cause as Error).message}\n`,
          );
        }
      }
    }
  }
  let expectedValidUntil: Map<string, number> | undefined;
  const logPath = flags.get('install-log');
  if (logPath !== undefined) {
    const log = JSON.parse(readFileSync(logPath, 'utf8')) as {
      results: { rule: string; validUntil: number }[];
    };
    expectedValidUntil = new Map(log.results.map((r) => [r.rule, r.validUntil]));
  }
  const report = diffRules(doc, rules, {
    account,
    network,
    latestLedger,
    params,
    ...(expectedValidUntil === undefined ? {} : { expectedValidUntil }),
  });
  const rendered = renderVerifyReport(report);
  process.stdout.write(`${rendered}\n`);
  const out = flags.get('out');
  if (out !== undefined) {
    writeFileSync(out, `${rendered}\n`);
  }
  if (!report.pass) {
    process.exitCode = 2;
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'demo':
      runDemo();
      return;
    case 'synth': {
      const flags = parseFlags(rest);
      cmdSynth(
        parseSynthConfig(flags),
        flags.get('input'),
        flags.get('out'),
        parseInstallTargets(rest, flags),
      );
      return;
    }
    case 'simulate': {
      const flags = parseFlags(rest);
      cmdSimulate(parseSynthConfig(flags), flags.get('input'), flags.get('probe-token'));
      return;
    }
    case 'record':
      await cmdRecord(rest);
      return;
    case 'install':
      await cmdInstall(rest);
      return;
    case 'verify':
      await cmdVerify(rest);
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${USAGE}\n`);
      return;
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((error: unknown) => {
  const err = error as Error;
  process.stderr.write(`${err.message}\n`);
  if (error instanceof InstallError && error.details !== undefined) {
    process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  }
  process.exit(1);
});
