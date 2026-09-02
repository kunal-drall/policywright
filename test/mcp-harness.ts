/**
 * Shared harness for the stdio MCP tests: the real server process spawned
 * with the repository's pinned tsx, driven through @modelcontextprotocol/client,
 * against a local stub RPC (test/stub-rpc.ts) that replays the committed raw
 * captures of the real testnet claim→swap sequence and serves the D2.5
 * testnet smart account's installed rules and policy parameters exactly as
 * recorded in examples/live/testnet/. Network-free.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { StrKey } from '@stellar/stellar-sdk';
import { startStubRpc, type StubRpc, type StubRule } from './stub-rpc.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const live = (name: string): string => join(ROOT, 'examples', 'live', name);
export const read = (path: string): string => readFileSync(path, 'utf8');
export const readJson = (path: string): unknown => JSON.parse(read(path));

// The real recorded claim→swap sequence (FACTS §12) and the D2.5 testnet state (FACTS §14).
export const CLAIM_HASH = '9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6';
export const SWAP_HASH = 'ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46';
export const BLND = 'CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF';
export const USDC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
export const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
export const ACCOUNT = 'CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT';
export const G = 'GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W';
export const VERIFY_LEDGER = 4_464_624; // examples/live/testnet/verify.md: "read at ledger 4464624"
export const FAKE_SECRET = 'SFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE';
/** A checksum-valid contract address the stub serves with only the constructor's admin rule. */
export const EMPTY_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 7));

/** The account state D2.5 left on testnet, derived from the committed artifact + install log. */
export function testnetAccountState() {
  const artifact = readJson(live('fresh/context-rule.json')) as {
    contextRules: {
      contextType: { contract: string };
      name: string;
      policies: { policy: string; address: string; installParams: Record<string, unknown> }[];
    }[];
  };
  const log = readJson(live('testnet/install-20260902T105742Z.json')) as {
    results: { rule: string; validUntil: number; contextRuleId: number }[];
  };
  const rules: StubRule[] = [
    {
      id: 0,
      contextType: { type: 'Default' },
      name: 'multisig',
      signers: [{ type: 'Delegated', address: G }],
      policies: [],
      validUntil: null,
    },
  ];
  const params = new Map<
    string,
    | { kind: 'frequency'; windowSecs: bigint; maxCalls: number }
    | { kind: 'spending'; spendingLimit: bigint; periodLedgers: number }
  >();
  for (const rule of artifact.contextRules) {
    const installed = log.results.find((r) => r.rule === rule.name);
    if (installed === undefined) {
      throw new Error(`install log has no row for ${rule.name}`);
    }
    rules.push({
      id: installed.contextRuleId,
      contextType: { type: 'CallContract', contract: rule.contextType.contract },
      name: rule.name,
      signers: [{ type: 'Delegated', address: G }],
      policies: rule.policies.map((p) => p.address),
      validUntil: installed.validUntil,
    });
    for (const binding of rule.policies) {
      const key = `${installed.contextRuleId}:${binding.address}`;
      params.set(
        key,
        binding.policy === 'custom:FrequencyLimitPolicy'
          ? {
              kind: 'frequency',
              windowSecs: BigInt(binding.installParams['window_secs'] as number),
              maxCalls: binding.installParams['max_calls'] as number,
            }
          : {
              kind: 'spending',
              spendingLimit: BigInt(binding.installParams['spending_limit'] as string),
              periodLedgers: binding.installParams['period_ledgers'] as number,
            },
      );
    }
  }
  return { rules, params };
}

export interface McpHarness {
  readonly stub: StubRpc;
  readonly client: Client;
  /** A scratch directory (outside the repository) the server's cwd points at. */
  readonly scratch: string;
  close(): Promise<void>;
}

export type ToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content: { type: string; text?: string }[];
};

/** Start the stub RPC and the real server over stdio; connect a client. */
export async function startMcpHarness(): Promise<McpHarness> {
  const state = testnetAccountState();
  const stub = await startStubRpc({
    captures: new Map([
      [CLAIM_HASH, readJson(live(`${CLAIM_HASH}.json`))],
      [SWAP_HASH, readJson(live(`${SWAP_HASH}.json`))],
    ]),
    tokens: new Map([
      [BLND, { symbol: 'BLND', decimals: 7 }],
      [USDC, { symbol: 'USDC', decimals: 7 }],
      [XLM_SAC, { symbol: 'native', decimals: 7 }],
    ]),
    accounts: new Map([
      [ACCOUNT, state],
      [EMPTY_ACCOUNT, { rules: state.rules.slice(0, 1), params: new Map() }],
    ]),
    latestLedger: VERIFY_LEDGER,
    oldestLedger: VERIFY_LEDGER - 120_960,
  });
  const scratch = mkdtempSync(join(tmpdir(), 'policywright-mcp-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(ROOT, 'src', 'mcp', 'server.ts'),
    ],
    cwd: scratch, // NOT the repo root: relative paths must resolve against POLICYWRIGHT_ROOT
    env: {
      ...getDefaultEnvironment(),
      POLICYWRIGHT_NETWORK: 'testnet',
      POLICYWRIGHT_RPC_URL: stub.url,
      POLICYWRIGHT_ROOT: ROOT,
      // The server must never read or echo this.
      STELLAR_SECRET_KEY: FAKE_SECRET,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'policywright-test-client', version: '0.0.0' });
  await client.connect(transport);
  return {
    stub,
    client,
    scratch,
    close: async () => {
      await client.close();
      await stub.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

/** Call a tool and return the raw result. */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}
