/**
 * A local stub Soroban RPC for network-free end-to-end tests of the MCP
 * server: a plain HTTP JSON-RPC endpoint that
 *
 *  - `getTransaction`: replays a committed raw capture (`examples/live/<hash>.json`,
 *    the verbatim exchange scripts/capture.ts saved) for a known hash, and
 *    answers `NOT_FOUND` with a retention window for any other;
 *  - `simulateTransaction`: decodes the InvokeContract the SDK built and
 *    answers the read-only getters the library uses — SEP-41 `symbol()` /
 *    `decimals()` for known tokens, and the smart-account / policy getters
 *    `verify` reads (`get_context_rules_count`, `get_context_rule`,
 *    `get_frequency_limit_data`, `get_spending_limit_data`) from a scripted
 *    account state — and a host error for anything else.
 *
 * Response shapes follow what the pinned SDK 15.1.0 parses
 * (lib/rpc/parsers.js: parseTransactionInfo, parseRawSimulation) and what the
 * live node returned in the committed captures.
 */

import { createServer, type Server } from 'node:http';
import {
  Address,
  SorobanDataBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { encodeSigner } from '../src/install.js';
import type { OzSigner } from '../src/types.js';

/** A rule as the account's `get_context_rule` returns it (FACTS §14.4). */
export interface StubRule {
  readonly id: number;
  readonly contextType:
    | { readonly type: 'CallContract'; readonly contract: string }
    | { readonly type: 'Default' };
  readonly name: string;
  readonly signers: readonly OzSigner[];
  readonly policies: readonly string[];
  readonly validUntil: number | null;
}

/** Scripted on-chain state for one smart account. */
export interface StubAccount {
  readonly rules: readonly StubRule[];
  /** Params per `<ruleId>:<policyAddress>`, as the policy getter returns them. */
  readonly params: ReadonlyMap<
    string,
    | { readonly kind: 'frequency'; readonly windowSecs: bigint; readonly maxCalls: number }
    | { readonly kind: 'spending'; readonly spendingLimit: bigint; readonly periodLedgers: number }
  >;
}

export interface StubRpcOptions {
  /** hash → committed capture document (the whole file). */
  readonly captures: ReadonlyMap<string, unknown>;
  /** token contract → SEP-41 metadata. */
  readonly tokens: ReadonlyMap<string, { readonly symbol: string; readonly decimals: number }>;
  /** smart account → scripted state. */
  readonly accounts: ReadonlyMap<string, StubAccount>;
  readonly latestLedger: number;
  readonly oldestLedger: number;
}

export interface StubRpc {
  readonly url: string;
  /** Every JSON-RPC method the server received, in order. */
  readonly calls: readonly string[];
  close(): Promise<void>;
}

function symbolKey(name: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(name);
}

/** A `#[contracttype]` struct: an ScMap keyed by field-name symbols, sorted by name. */
function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: symbolKey(k), val: fields[k] as xdr.ScVal })),
  );
}

function u32Vec(values: readonly number[]): xdr.ScVal {
  return xdr.ScVal.scvVec(values.map((v) => xdr.ScVal.scvU32(v)));
}

function contextRuleScVal(rule: StubRule): xdr.ScVal {
  return struct({
    id: xdr.ScVal.scvU32(rule.id),
    context_type:
      rule.contextType.type === 'Default'
        ? xdr.ScVal.scvSymbol('Default')
        : xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('CallContract'),
            Address.fromString(rule.contextType.contract).toScVal(),
          ]),
    name: xdr.ScVal.scvString(rule.name),
    signers: xdr.ScVal.scvVec(rule.signers.map(encodeSigner)),
    signer_ids: u32Vec(rule.signers.map((_, i) => i)),
    policies: xdr.ScVal.scvVec(rule.policies.map((p) => Address.fromString(p).toScVal())),
    policy_ids: u32Vec(rule.policies.map((_, i) => i)),
    valid_until: rule.validUntil === null ? xdr.ScVal.scvVoid() : xdr.ScVal.scvU32(rule.validUntil),
  });
}

function paramsScVal(params: NonNullable<ReturnType<StubAccount['params']['get']>>): xdr.ScVal {
  if (params.kind === 'frequency') {
    return struct({
      window_secs: nativeToScVal(params.windowSecs, { type: 'u64' }),
      max_calls: xdr.ScVal.scvU32(params.maxCalls),
      call_history: xdr.ScVal.scvVec([]),
    });
  }
  return struct({
    spending_limit: nativeToScVal(params.spendingLimit, { type: 'i128' }),
    period_ledgers: xdr.ScVal.scvU32(params.periodLedgers),
    spent: nativeToScVal(0n, { type: 'i128' }),
    period_start: xdr.ScVal.scvU32(0),
  });
}

interface Invocation {
  readonly contract: string;
  readonly fnName: string;
  readonly args: readonly unknown[];
}

function decodeInvocation(envelopeB64: string): Invocation {
  const envelope = xdr.TransactionEnvelope.fromXDR(envelopeB64, 'base64');
  const tx = envelope.switch().name === 'envelopeTypeTx' ? envelope.v1().tx() : null;
  if (tx === null) {
    throw new Error('stub rpc: only v1 envelopes are simulated');
  }
  const op = tx.operations()[0];
  if (op === undefined || op.body().switch().name !== 'invokeHostFunction') {
    throw new Error('stub rpc: expected an InvokeHostFunction operation');
  }
  const host = op.body().invokeHostFunctionOp().hostFunction();
  const inv = host.invokeContract();
  return {
    contract: Address.fromScAddress(inv.contractAddress()).toString(),
    fnName: inv.functionName().toString(),
    args: inv.args().map((a) => scValToNative(a) as unknown),
  };
}

function simulationSuccess(retval: xdr.ScVal, latestLedger: number): Record<string, unknown> {
  return {
    transactionData: new SorobanDataBuilder().build().toXDR('base64'),
    minResourceFee: '100',
    events: [],
    results: [{ auth: [], xdr: retval.toXDR('base64') }],
    stateChanges: [],
    latestLedger,
  };
}

function simulationError(message: string, latestLedger: number): Record<string, unknown> {
  return { error: message, events: [], latestLedger };
}

function answerSimulation(options: StubRpcOptions, inv: Invocation): Record<string, unknown> {
  const { latestLedger } = options;
  const token = options.tokens.get(inv.contract);
  if (token !== undefined && inv.fnName === 'symbol') {
    return simulationSuccess(xdr.ScVal.scvString(token.symbol), latestLedger);
  }
  if (token !== undefined && inv.fnName === 'decimals') {
    return simulationSuccess(xdr.ScVal.scvU32(token.decimals), latestLedger);
  }
  const account = options.accounts.get(inv.contract);
  if (account !== undefined && inv.fnName === 'get_context_rules_count') {
    return simulationSuccess(xdr.ScVal.scvU32(account.rules.length), latestLedger);
  }
  if (account !== undefined && inv.fnName === 'get_context_rule') {
    const id = Number(inv.args[0]);
    const rule = account.rules.find((r) => r.id === id);
    if (rule === undefined) {
      return simulationError(
        'HostError: Error(Contract, #3000) — ContextRuleNotFound',
        latestLedger,
      );
    }
    return simulationSuccess(contextRuleScVal(rule), latestLedger);
  }
  if (inv.fnName === 'get_frequency_limit_data' || inv.fnName === 'get_spending_limit_data') {
    const ruleId = Number(inv.args[0]);
    const forAccount = String(inv.args[1]);
    const state = options.accounts.get(forAccount);
    const params = state?.params.get(`${ruleId}:${inv.contract}`);
    if (params === undefined) {
      return simulationError(
        'HostError: Error(Storage, MissingValue) — policy not installed for this rule',
        latestLedger,
      );
    }
    return simulationSuccess(paramsScVal(params), latestLedger);
  }
  return simulationError(
    `HostError: Error(Storage, MissingValue) — stub rpc has no answer for ${inv.fnName} on ${inv.contract}`,
    latestLedger,
  );
}

function handle(options: StubRpcOptions, method: string, params: unknown): Record<string, unknown> {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'getTransaction': {
      const hash = String(p['hash']).toLowerCase();
      const capture = options.captures.get(hash) as { response?: { result?: unknown } } | undefined;
      if (capture?.response?.result !== undefined) {
        return capture.response.result as Record<string, unknown>;
      }
      return {
        status: 'NOT_FOUND',
        txHash: hash,
        latestLedger: options.latestLedger,
        latestLedgerCloseTime: '1786168610',
        oldestLedger: options.oldestLedger,
        oldestLedgerCloseTime: '1785562667',
      };
    }
    case 'simulateTransaction': {
      const envelope = p['transaction'];
      if (typeof envelope !== 'string') {
        return simulationError('stub rpc: missing transaction', options.latestLedger);
      }
      return answerSimulation(options, decodeInvocation(envelope));
    }
    default:
      throw new Error(`stub rpc: unsupported method ${method}`);
  }
}

/** Start the stub on an ephemeral 127.0.0.1 port. */
export function startStubRpc(options: StubRpcOptions): Promise<StubRpc> {
  const calls: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      const request = JSON.parse(body) as { id: unknown; method: string; params?: unknown };
      calls.push(request.method);
      let payload: Record<string, unknown>;
      try {
        payload = {
          jsonrpc: '2.0',
          id: request.id,
          result: handle(options, request.method, request.params),
        };
      } catch (error) {
        payload = {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: (error as Error).message },
        };
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('stub rpc: no address'));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}`,
        calls,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
