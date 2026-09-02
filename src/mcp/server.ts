/**
 * policywright MCP server (stdio). Exposes exactly four tools — `record`,
 * `synthesize`, `simulate`, `verify` — over the Model Context Protocol so an
 * agent can drive the toolkit end to end.
 *
 * There is deliberately NO install or deploy tool. The toolkit generates
 * reviewable policy code; deployment is always a separate, explicit,
 * human-initiated step (`npm run cli -- install`, which today signs with the
 * operator's .env key — a wallet signing surface is the open cohort-wallet
 * track). This server never signs, never submits, and never needs a secret.
 *
 * Run: `npm run mcp` (equivalently `tsx src/mcp/server.ts`). Configuration is
 * read from POLICYWRIGHT_NETWORK / POLICYWRIGHT_RPC_URL / POLICYWRIGHT_ROOT
 * (docs/mcp-server.md). Logs go to stderr only — stdout is the protocol.
 *
 * SDK: @modelcontextprotocol/server 2.0.0 (spec 2026-07-28), dual-era stdio
 * via `serveStdio` (docs/FACTS.md §9, §15).
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  RecordInputSchema,
  RecordOutputSchema,
  SimulateInputSchema,
  SimulateOutputSchema,
  SynthesizeInputSchema,
  SynthesizeOutputSchema,
  UNAUDITED_BANNER,
  VerifyInputSchema,
  VerifyOutputSchema,
} from './schemas.js';
import {
  configFromEnv,
  record,
  runTool,
  simulateTool,
  synthesizeTool,
  verifyTool,
  type ServerConfig,
  type ToolOutcome,
} from './tools.js';

/** Server name; tools are callable as `mcp__policywright__<tool>` in Claude Code. */
export const SERVER_NAME = 'policywright';

/** The package version, so the server reports the same version as the CLI. */
export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

/** Instructions the server hands to the agent at initialization. */
export const SERVER_INSTRUCTIONS = `policywright turns a Soroban transaction the user already performed into the least-privilege OpenZeppelin smart-account authorization that permits exactly that flow, with an offline dry run before anything is installed.

Workflow: record (hashes → recording) → synthesize (recording → spec, context-rule.json, generated policy, notes) → simulate (recording → permit/deny/flag table) → the HUMAN installs → verify (artifact vs. what the account has on-chain).

Rules:
- Never invent hashes, addresses, or amounts: every value comes from a tool output.
- Always show the dry run (simulate) before calling a policy reviewed, and surface synthesize.notes, warnings, and scopeNotes — they state what is NOT permitted and why.
- Generated code is unaudited. Whenever you show rustPolicy, show its banner: "${UNAUDITED_BANNER}"
- There is no install or deploy tool here, by design. Installing is a separate, explicit, human-initiated step: npm run cli -- install --artifact <context-rule.json> --account <C…> [--dry-run] (testnet; today the CLI signs with the operator's .env key — a wallet signing surface is the open cohort-wallet track). Tell the user that, do not try to work around it.
- This server holds no secrets and cannot sign or submit anything. record and verify read public chain data; synthesize and simulate are pure.
- Messages from the underlying library may cite CLI flags. Their tool-input equivalents: --account → account; --probe-token → probeToken; --constrain-arguments → config.constrainArguments; --signer → installTargets.signers; --policy-address → installTargets.policyAddresses; --ledger-head → installTargets.ledgerHead; --lifetime/--spend-window/--cap-multiplier/--frequency-window/--frequency-max → config.*; --input → recordingPath; --out → outDir; --install-log → installLogPath.

Errors come back as isError results whose single text block is the JSON envelope { schemaVersion: 1, ok: false, error: { code, message, source } } with codes BAD_INPUT | TX_NOT_FOUND | NETWORK | DECODE_FAILED | SHAPE_INVALID | INTERNAL (no structuredContent on errors: it would not match the tool's output schema).`;

const DESCRIPTIONS = {
  record: `Record what already happened on-chain. Give it the transaction hash(es) of a flow the user performed (a multi-step flow such as "claim Blend yield, then swap on Soroswap" is SEVERAL hashes — pass them all; they are merged in ledger order into ONE recording), plus the account whose authorizations are being scoped (account: G… or the smart account's C…). Alternatively ingest a saved simulateTransaction exchange (simulation / simulationPath) for a flow that was only simulated. Reads public RPC data only.
Use it first, once per flow. Then pass \`recording\` (or the file written with outPath) to synthesize and simulate. Surface \`warnings\` to the user (assumed subject, unresolved token metadata). Public RPC nodes retain about 7 days of history: an older hash returns TX_NOT_FOUND — ask the user for a recent transaction or a saved capture.`,
  synthesize: `Derive the least-privilege authorization for a recording: the context rule (exact contract+function scope), spend caps from observed gross outflow (inflow-only assets get NO cap), a call-frequency limit, and the derived argument constraints — then emit the reviewable artifacts: spec.json, context-rule.json (the OpenZeppelin rules with real stock spending_limit install params), summary.txt, and the generated FrequencyLimitPolicy.rs (UNAUDITED — always show its banner). Pure: same input, same output; no network.
Use it after record. Pass \`config\` to change caps/windows/lifetime or to enforce argument constraints (constrainArguments), and \`installTargets\` (signers, deployed policy addresses) so the artifact installs as-is — \`installable.asIs\` says whether it would. Read \`notes\`, \`warnings\`, \`scopeNotes\` and present them: they are the decisions a reviewer must see (what is capped, what is not permitted, what the stock policies cannot express). Hand the user contextRule (or the files in outDir) for the human install step; never install from here.`,
  simulate: `Dry-run the synthesized policy set before anything is installed. Returns the permit/deny/flag table as data (\`results\`) and as a Markdown \`report\`: the standard scenarios (replay of the recorded flow → permit; over the spend cap, an unseen function, after expiry, over the frequency limit → deny; the recorded swap re-routed through an unobserved token → flag by default, deny with config.constrainArguments) plus any \`candidates\` you supply in the candidate-call format. Pure; no network.
Use it after synthesize with the SAME recording and config, and always before telling the user a policy is reviewed. \`deviations\` must be 0 (the harness self-check). A flag means "permitted, with a scope gap" — say so and offer constrainArguments.`,
  verify: `Read a smart account's installed context rules and policy parameters from chain (read-only simulated getters; nothing is signed or submitted) and diff them against an emitted context-rule.json: rule present, signers, policy addresses, install params, valid_until (against the install log when given). Returns \`pass\`, the diff \`rows\`, and a Markdown \`report\`.
Use it AFTER the human has installed the artifact with the CLI, to confirm what is on-chain equals what was reviewed; or to inspect what an account currently has. A NETWORK error means the RPC endpoint (POLICYWRIGHT_RPC_URL / rpcUrl) could not be reached.`,
} as const;

/**
 * Shape a tool outcome as the MCP result. Success: `structuredContent` plus
 * the same JSON in the text block (the spec's backwards-compatible form).
 * Failure: the envelope as the JSON text block ONLY — clients validate
 * `structuredContent` against the advertised output schema whenever it is
 * present (Claude Code's bundled client does so even on `isError` results,
 * FACTS §15.2), and an error envelope cannot conform to a success schema.
 */
function toResult<T extends Record<string, unknown>>(outcome: ToolOutcome<T>) {
  if (outcome.ok) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(outcome.value) }],
      structuredContent: outcome.value,
    };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(outcome.error) }],
    isError: true,
  };
}

/** Build a server instance with the four tools registered. One instance per connection. */
export function createServer(config: ServerConfig = configFromEnv()): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: packageVersion(),
      title: 'policywright',
      description:
        'Record a Soroban transaction, synthesize the least-privilege OpenZeppelin smart-account authorization, dry-run it, and verify an install. No install/deploy tool: deployment is a separate human step.',
      websiteUrl: 'https://policywright.lemmalabs.space',
    },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    'record',
    {
      title: 'Record a performed transaction flow',
      description: DESCRIPTIONS.record,
      inputSchema: RecordInputSchema,
      outputSchema: RecordOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      toResult(await runTool(() => record(args, config), [config.rpcUrl, args.rpcUrl])),
  );

  server.registerTool(
    'synthesize',
    {
      title: 'Synthesize the least-privilege authorization',
      description: DESCRIPTIONS.synthesize,
      inputSchema: SynthesizeInputSchema,
      outputSchema: SynthesizeOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => toResult(await runTool(() => synthesizeTool(args, config))),
  );

  server.registerTool(
    'simulate',
    {
      title: 'Dry-run the policy set (permit / deny / flag)',
      description: DESCRIPTIONS.simulate,
      inputSchema: SimulateInputSchema,
      outputSchema: SimulateOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => toResult(await runTool(() => simulateTool(args, config))),
  );

  server.registerTool(
    'verify',
    {
      title: 'Verify an install against the chain (read-only)',
      description: DESCRIPTIONS.verify,
      inputSchema: VerifyInputSchema,
      outputSchema: VerifyOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      toResult(await runTool(() => verifyTool(args, config), [config.rpcUrl, args.rpcUrl])),
  );

  return server;
}

/** Serve over stdio until the client closes the connection. */
export function main(): void {
  let config: ServerConfig;
  try {
    config = configFromEnv();
  } catch (error) {
    process.stderr.write(`policywright mcp: ${(error as Error).message}\n`);
    process.exit(2);
  }
  process.stderr.write(
    `policywright mcp ${packageVersion()}: serving record/synthesize/simulate/verify over stdio (network ${config.network}${config.rpcUrl === undefined ? '' : `, rpc ${config.rpcUrl}`}); no install/deploy tool by design\n`,
  );
  serveStdio(() => createServer(config), {
    onerror: (error) => {
      process.stderr.write(`policywright mcp: ${error.message}\n`);
    },
  });
}

// Run only when invoked directly (not when imported by the tests).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
