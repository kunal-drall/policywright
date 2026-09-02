/**
 * Install: turn an emitted `context-rule.json` (schema v2) into the
 * `add_context_rule` transactions a smart account accepts — simulated,
 * signed client-side, submitted — consuming the artifact UNMODIFIED through
 * {@link planInstall}. Nothing here is reachable from the MCP server: this is
 * the explicit, human-initiated CLI/signing step (structural rule).
 *
 * How a rule install authorizes (docs/FACTS.md §8.2–8.4, RECONCILIATION-T2
 * rows 32–39): `add_context_rule` calls `require_auth` on the account's own
 * C-address, so the transaction carries ONE `SorobanAuthorizationEntry` with
 * address credentials for the account whose `signature` is the `AuthPayload`
 * (`{ signers: Map<Signer, Bytes>, context_rule_ids: [adminRuleId] }`). The
 * admin rule's `Delegated(G)` signer is authenticated by
 * `G.require_auth_for_args((auth_digest,))` inside `__check_auth` — an entry
 * simulation never returns, so it is built here: when G is the transaction
 * source it carries `SourceAccount` credentials and the transaction signature
 * covers it. `auth_digest = sha256(signature_payload ‖ xdr(context_rule_ids))`.
 */

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  hash,
  rpc,
  scValToNative,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'node:crypto';
import {
  encodeInstallParams,
  validateContextRuleDocument,
  type ContextRuleDoc,
  type ContextRuleDocument,
  type InstallShapeViolation,
} from './install-shape.js';
import { NETWORK_PASSPHRASES } from './network.js';
import type { Network, OzSigner } from './types.js';

/** Machine-readable failure categories for the installer. */
export type InstallErrorCode =
  | 'SHAPE_INVALID'
  | 'BAD_INPUT'
  | 'NO_SIGNING_SURFACE'
  | 'SIMULATION_FAILED'
  | 'SUBMIT_FAILED'
  | 'NETWORK';

/** Raised for any installer failure; never carries a secret. */
export class InstallError extends Error {
  override readonly name = 'InstallError';
  readonly code: InstallErrorCode;
  readonly details: unknown;

  constructor(code: InstallErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Artifact → add_context_rule arguments (mechanical encoding, no new values)
// ---------------------------------------------------------------------------

/** `Signer::Delegated(addr)` → `Vec[Symbol("Delegated"), Address]`; `External` adds the key bytes. */
export function encodeSigner(signer: OzSigner): xdr.ScVal {
  if (signer.type === 'Delegated') {
    return xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('Delegated'),
      Address.fromString(signer.address).toScVal(),
    ]);
  }
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    Address.fromString(signer.verifier).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(signer.keyData, 'hex')),
  ]);
}

/** `ContextRuleType::CallContract(addr)` → `Vec[Symbol("CallContract"), Address]` (tuple-variant enum). */
export function encodeContextType(rule: ContextRuleDoc): xdr.ScVal {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('CallContract'),
    Address.fromString(rule.contextType.contract).toScVal(),
  ]);
}

/** `Option<u32>`: `None` → `Void`, `Some(n)` → `U32(n)`. */
export function encodeOptionU32(value: number | null): xdr.ScVal {
  return value === null ? xdr.ScVal.scvVoid() : xdr.ScVal.scvU32(value);
}

/** Sort ScVals the way the host orders map keys of one type: by their XDR bytes. */
function byXdrBytes(a: xdr.ScVal, b: xdr.ScVal): number {
  return Buffer.compare(a.toXDR(), b.toXDR());
}

/** `policies: Map<Address, Val>` — one entry per binding, keys sorted (install order = key order). */
export function encodePoliciesMap(rule: ContextRuleDoc): xdr.ScVal {
  const entries = rule.policies.map((binding) => {
    if (binding.address === null) {
      throw new InstallError('SHAPE_INVALID', `${binding.policy} has no deployed address`);
    }
    return new xdr.ScMapEntry({
      key: Address.fromString(binding.address).toScVal(),
      val: encodeInstallParams(binding),
    });
  });
  entries.sort((x, y) => byXdrBytes(x.key(), y.key()));
  return xdr.ScVal.scvMap(entries);
}

/** The five `add_context_rule` arguments, in order (mod.rs:238-248). */
export function buildAddContextRuleArgs(rule: ContextRuleDoc, validUntil: number): xdr.ScVal[] {
  return [
    encodeContextType(rule),
    xdr.ScVal.scvString(rule.name),
    encodeOptionU32(validUntil),
    xdr.ScVal.scvVec(rule.signers.map(encodeSigner)),
    encodePoliciesMap(rule),
  ];
}

/** One rule of an install plan. */
export interface InstallPlanRule {
  readonly index: number;
  readonly name: string;
  readonly contract: string;
  /** Absolute ledger sequence: the artifact's own value, or head + lifetimeLedgers. */
  readonly validUntil: number;
  readonly validUntilSource: 'artifact' | 'head+lifetime';
  readonly signers: readonly OzSigner[];
  readonly policies: readonly { readonly policy: string; readonly address: string }[];
  readonly args: readonly xdr.ScVal[];
}

/**
 * Validate the artifact for install (every check the contracts perform) and
 * map each rule to its call arguments. The only value not taken verbatim from
 * the artifact is the absolute `valid_until` when the artifact carries the
 * relative `lifetimeLedgers` (E1): `ledgerHead + lifetimeLedgers`.
 */
export function planInstall(doc: ContextRuleDocument, ledgerHead: number): InstallPlanRule[] {
  const violations: InstallShapeViolation[] = validateContextRuleDocument(doc, {
    forInstall: true,
  });
  if (violations.length > 0) {
    throw new InstallError(
      'SHAPE_INVALID',
      `the artifact would not install as-is (${violations.length} violation(s)): ${violations
        .map((v) => `${v.path}: ${v.ozError} — ${v.message}`)
        .join('; ')}`,
      violations,
    );
  }
  return doc.contextRules.map((rule, index) => {
    const validUntil =
      rule.validUntilLedger !== null
        ? rule.validUntilLedger
        : ledgerHead + (rule.lifetimeLedgers ?? 0);
    if (validUntil <= ledgerHead) {
      throw new InstallError(
        'BAD_INPUT',
        `${rule.name}: valid_until ${validUntil} is not after the current ledger ${ledgerHead} (PastValidUntil 3005) — re-synthesize without a stale --ledger-head`,
      );
    }
    return {
      index,
      name: rule.name,
      contract: rule.contextType.contract,
      validUntil,
      validUntilSource: rule.validUntilLedger !== null ? 'artifact' : 'head+lifetime',
      signers: rule.signers,
      policies: rule.policies.map((b) => ({ policy: b.policy, address: b.address as string })),
      args: buildAddContextRuleArgs(rule, validUntil),
    };
  });
}

// ---------------------------------------------------------------------------
// Authorization: AuthPayload, auth_digest, the Delegated nested entry
// ---------------------------------------------------------------------------

/** `sha256(HashIdPreimage::SorobanAuthorization{networkId, nonce, expiration, invocation})`. */
export function signaturePayload(
  networkPassphrase: string,
  nonce: xdr.Int64,
  signatureExpirationLedger: number,
  invocation: xdr.SorobanAuthorizedInvocation,
): Buffer {
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce,
      signatureExpirationLedger,
      invocation,
    }),
  );
  return hash(preimage.toXDR());
}

/** OZ's rule-bound digest: `sha256(signature_payload ‖ xdr(Vec<u32> context_rule_ids))` (storage.rs:492-495). */
export function authDigest(payload: Buffer, contextRuleIds: readonly number[]): Buffer {
  const ids = xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))).toXDR();
  return hash(Buffer.concat([payload, ids]));
}

/**
 * The `AuthPayload` struct as the sorted `ScMap` `__check_auth` decodes
 * (storage.rs:131-138): `context_rule_ids: Vec<u32>`, `signers: Map<Signer,
 * Bytes>` (Delegated signers carry empty bytes — their proof is the nested
 * entry; External signers carry the 64-byte signature over `auth_digest`).
 */
export function buildAuthPayload(
  signers: readonly OzSigner[],
  contextRuleIds: readonly number[],
  signatures: ReadonlyMap<string, Buffer>,
): xdr.ScVal {
  const entries = signers.map((signer) => {
    const key = encodeSigner(signer);
    const sig = signatures.get(signerKey(signer)) ?? Buffer.alloc(0);
    return new xdr.ScMapEntry({ key, val: xdr.ScVal.scvBytes(sig) });
  });
  entries.sort((x, y) => byXdrBytes(x.key(), y.key()));
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signers'), val: xdr.ScVal.scvMap(entries) }),
  ]);
}

/** Stable key for a signer in signature maps. */
export function signerKey(signer: OzSigner): string {
  return signer.type === 'Delegated'
    ? `Delegated:${signer.address}`
    : `External:${signer.verifier}:${signer.keyData.toLowerCase()}`;
}

/**
 * The entry a `Delegated(G)` signer needs and simulation never returns: G
 * authorizes `account.__check_auth(auth_digest)` (recorded from the current
 * frame — FACTS §8.4). With G as the transaction source the credentials are
 * `SourceAccount` and the transaction signature covers it.
 */
export function buildDelegatedCheckAuthEntry(
  account: string,
  digest: Buffer,
): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(account).toScAddress(),
          functionName: '__check_auth',
          args: [xdr.ScVal.scvBytes(digest)],
        }),
      ),
      subInvocations: [],
    }),
  });
}

// ---------------------------------------------------------------------------
// Signing surface
// ---------------------------------------------------------------------------

/**
 * What signs the transaction (and, for External signers, the digest). The
 * local fallback wraps the `.env` key; a wallet implementation would sign the
 * same transaction through `signTransaction` (SEP-43) and cannot sign an
 * OZ `External` digest (FACTS §8.4).
 */
export interface SigningSurface {
  readonly mode: 'local-fallback' | 'wallet';
  /** Why this mode is in use — printed in every output, so a reviewer sees it. */
  readonly reason: string;
  readonly publicKey: string;
  signTransaction(tx: Transaction): Promise<Transaction>;
  /** Sign an OZ `auth_digest` (External signers only); null when unsupported. */
  signDigest(digest: Buffer): Promise<Buffer> | null;
}

/** The labelled fallback: a Keypair from the gitignored `.env`. Never logs the secret. */
export function localFallbackSigner(secret: string): SigningSurface {
  const kp = Keypair.fromSecret(secret);
  return {
    mode: 'local-fallback',
    reason:
      'local signer from .env (fallback): the .env key acts as the Delegated(G) rule signer and transaction source; a wallet would sign this same transaction via signTransaction, but no SEP-43 wallet can sign an OZ External digest (FACTS §8.4), and the wallets-kit page is the cohort-wallet track (open)',
    publicKey: kp.publicKey(),
    signTransaction: (tx) => {
      tx.sign(kp);
      return Promise.resolve(tx);
    },
    signDigest: (digest) => Promise.resolve(kp.sign(digest)),
  };
}

// ---------------------------------------------------------------------------
// The install transaction
// ---------------------------------------------------------------------------

/** Options for {@link installRule}. */
export interface InstallOptions {
  readonly network: Network;
  readonly rpcUrl?: string;
  /** The smart account's C-address. */
  readonly account: string;
  /** The account's admin rule (the constructor's Default rule is id 0). */
  readonly adminRuleId: number;
  /** The admin rule's signers — must include the signing surface's key as Delegated(G) or as an External key. */
  readonly adminSigners: readonly OzSigner[];
  /** Simulate fully (including the auth entries) but do not submit. */
  readonly dryRun: boolean;
  /** Ledgers the auth entry stays valid after the current head (default 120 ≈ 10 min). */
  readonly signatureLifetimeLedgers?: number;
}

/** Result of one rule install (or dry run). */
export interface InstallResult {
  readonly rule: string;
  readonly contract: string;
  readonly validUntil: number;
  readonly validUntilSource: 'artifact' | 'head+lifetime';
  readonly submitted: boolean;
  readonly txHash: string | null;
  readonly ledger: number | null;
  /** The on-chain rule id returned by add_context_rule (null on dry run). */
  readonly contextRuleId: number | null;
  readonly signingMode: SigningSurface['mode'];
  readonly signingReason: string;
  readonly authEntries: number;
  /** Auth-entry expiration ledger, nonce, and digest — reproducibility, no secrets. */
  readonly auth: {
    readonly nonce: string;
    readonly expirationLedger: number;
    readonly digestHex: string;
  };
  readonly simulation: { readonly minResourceFee: string; readonly latestLedger: number };
}

/** Narrow a polled transaction to the successful shape (status compared as text). */
function isSuccessful(
  r: rpc.Api.GetTransactionResponse,
): r is rpc.Api.GetSuccessfulTransactionResponse {
  return String(r.status) === 'SUCCESS';
}

const DEFAULT_RPC: Record<Network, string> = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://mainnet.sorobanrpc.com',
  futurenet: 'https://rpc-futurenet.stellar.org',
};

/** Build a server; testnet-only is enforced by the CLI, not here. */
export function serverFor(network: Network, rpcUrl?: string): rpc.Server {
  const url = rpcUrl ?? DEFAULT_RPC[network];
  return new rpc.Server(url, { allowHttp: url.startsWith('http://') });
}

function randomNonce(): xdr.Int64 {
  // A random non-negative i64; the host only requires uniqueness per (address, nonce).
  const bytes = randomBytes(8);
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  return xdr.Int64.fromString(BigInt(`0x${bytes.toString('hex')}`).toString());
}

function invokeOp(
  account: string,
  args: readonly xdr.ScVal[],
  auth: xdr.SorobanAuthorizationEntry[],
) {
  const op = new Contract(account).call('add_context_rule', ...args);
  const body = op.body().invokeHostFunctionOp();
  return xdr.Operation.fromXDR(
    new xdr.Operation({
      sourceAccount: null,
      body: xdr.OperationBody.invokeHostFunction(
        new xdr.InvokeHostFunctionOp({ hostFunction: body.hostFunction(), auth }),
      ),
    }).toXDR(),
  );
}

async function buildTx(
  server: rpc.Server,
  network: Network,
  source: string,
  account: string,
  args: readonly xdr.ScVal[],
  auth: xdr.SorobanAuthorizationEntry[],
): Promise<Transaction> {
  const acct = await server.getAccount(source);
  const builder = new TransactionBuilder(acct, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASES[network],
  });
  builder.addOperation(invokeOp(account, args, auth));
  return builder.setTimeout(120).build();
}

/**
 * Install one planned rule: simulate to learn the account's auth entry tree,
 * fill its credentials with the AuthPayload, add the Delegated signer's nested
 * entry (or sign the digest for an External signer), simulate again with the
 * real entries, then sign and submit (unless dry-run).
 */
export async function installRule(
  plan: InstallPlanRule,
  signer: SigningSurface,
  options: InstallOptions,
): Promise<InstallResult> {
  const server = serverFor(options.network, options.rpcUrl);
  const passphrase = NETWORK_PASSPHRASES[options.network];
  if (options.network === 'mainnet') {
    throw new InstallError('BAD_INPUT', 'mainnet installs are out of scope (testnet only)');
  }

  // 1. Recording-mode simulation: the host returns the account's own auth
  //    entry (address credentials, placeholder signature) with the exact
  //    invocation tree it will check.
  const probe = await buildTx(
    server,
    options.network,
    signer.publicKey,
    options.account,
    plan.args,
    [],
  );
  const sim1 = await server.simulateTransaction(probe);
  if (rpc.Api.isSimulationError(sim1)) {
    throw new InstallError('SIMULATION_FAILED', `recording simulation failed: ${sim1.error}`, {
      events: sim1.events?.map((e) => e.toXDR('base64')),
    });
  }
  const recorded = (sim1.result?.auth ?? []).find(
    (e) =>
      e.credentials().switch().name === 'sorobanCredentialsAddress' &&
      Address.fromScAddress(e.credentials().address().address()).toString() === options.account,
  );
  if (recorded === undefined) {
    throw new InstallError(
      'SIMULATION_FAILED',
      'simulation returned no authorization entry for the smart account — is the address an OZ smart account whose add_context_rule requires its own auth?',
    );
  }

  // 2. Fill the account entry: nonce, expiration, AuthPayload selecting the admin rule.
  const head = sim1.latestLedger;
  const expiration = head + (options.signatureLifetimeLedgers ?? 120);
  const nonce = randomNonce();
  const payload = signaturePayload(passphrase, nonce, expiration, recorded.rootInvocation());
  const digest = authDigest(payload, [options.adminRuleId]);

  // 3. Prove each admin signer: Delegated(G) with G == source → nested
  //    SourceAccount entry; External key we hold → signature over the digest.
  const signatures = new Map<string, Buffer>();
  const extraEntries: xdr.SorobanAuthorizationEntry[] = [];
  const localRawKey = Keypair.fromPublicKey(signer.publicKey).rawPublicKey().toString('hex');
  for (const adminSigner of options.adminSigners) {
    if (adminSigner.type === 'Delegated') {
      if (adminSigner.address !== signer.publicKey) {
        throw new InstallError(
          'NO_SIGNING_SURFACE',
          `admin signer Delegated(${adminSigner.address}) is not the transaction source ${signer.publicKey}; a Delegated signer that is not the source needs a wallet signAuthEntry over its nested __check_auth entry (not built in this session)`,
        );
      }
      extraEntries.push(buildDelegatedCheckAuthEntry(options.account, digest));
    } else {
      if (adminSigner.keyData.toLowerCase() !== localRawKey) {
        throw new InstallError(
          'NO_SIGNING_SURFACE',
          `admin signer External(${adminSigner.verifier}, ${adminSigner.keyData.slice(0, 8)}…) is not the local key; no SEP-43 wallet can sign an OZ External digest (FACTS §8.4)`,
        );
      }
      const sig = signer.signDigest(digest);
      if (sig === null) {
        throw new InstallError(
          'NO_SIGNING_SURFACE',
          'this signing surface cannot sign an External digest',
        );
      }
      signatures.set(signerKey(adminSigner), await sig);
    }
  }
  const authPayload = buildAuthPayload(options.adminSigners, [options.adminRuleId], signatures);
  const accountEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(options.account).toScAddress(),
        nonce,
        signatureExpirationLedger: expiration,
        signature: authPayload,
      }),
    ),
    rootInvocation: recorded.rootInvocation(),
  });
  const auth = [accountEntry, ...extraEntries];

  // 4. Enforcing simulation with the real entries: this runs __check_auth and
  //    every policy install, so a bad AuthPayload fails here, before signing.
  const tx = await buildTx(
    server,
    options.network,
    signer.publicKey,
    options.account,
    plan.args,
    auth,
  );
  const sim2 = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim2)) {
    throw new InstallError('SIMULATION_FAILED', `enforcing simulation failed: ${sim2.error}`, {
      events: sim2.events?.map((e) => e.toXDR('base64')),
    });
  }
  const base = {
    rule: plan.name,
    contract: plan.contract,
    validUntil: plan.validUntil,
    validUntilSource: plan.validUntilSource,
    signingMode: signer.mode,
    signingReason: signer.reason,
    authEntries: auth.length,
    auth: {
      nonce: nonce.toString(),
      expirationLedger: expiration,
      digestHex: digest.toString('hex'),
    },
    simulation: { minResourceFee: sim2.minResourceFee, latestLedger: sim2.latestLedger },
  };
  if (options.dryRun) {
    return { ...base, submitted: false, txHash: null, ledger: null, contextRuleId: null };
  }

  // 5. Assemble (keeps our auth entries — SDK assembleTransaction), sign, submit, poll.
  const assembled = rpc.assembleTransaction(tx, sim2).build();
  const signed = await signer.signTransaction(assembled);
  const sent = await server.sendTransaction(signed);
  if (String(sent.status) === 'ERROR') {
    throw new InstallError('SUBMIT_FAILED', `sendTransaction returned ERROR for ${sent.hash}`, {
      errorResult: sent.errorResult?.toXDR('base64'),
    });
  }
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (!isSuccessful(final)) {
    throw new InstallError(
      'SUBMIT_FAILED',
      `transaction ${sent.hash} ended with status ${String(final.status)}`,
      {
        resultXdr: 'resultXdr' in final ? final.resultXdr.toXDR('base64') : undefined,
      },
    );
  }
  let contextRuleId: number | null = null;
  if (final.returnValue !== undefined) {
    const decoded = scValToNative(final.returnValue) as { id?: number };
    contextRuleId = typeof decoded?.id === 'number' ? decoded.id : null;
  }
  return { ...base, submitted: true, txHash: sent.hash, ledger: final.ledger, contextRuleId };
}
