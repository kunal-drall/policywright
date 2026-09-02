# The policywright MCP server

A local, stdio [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes policywright's four operations — `record`, `synthesize`,
`simulate`, `verify` — to an agent (Claude Code, Claude Desktop, or any MCP
client). It is the T2 deliverable D2.1 ("The server runs locally and an agent
calls each tool end to end; a reference session is recorded").

**There is no install or deploy tool, by design.** The toolkit generates
reviewable policy code; installation into a smart account is always a
separate, explicit, human-initiated step — the CLI `install` command, which
today signs with the operator's `.env` key (a wallet signing surface is the
open cohort-wallet track, [FACTS.md §8.4](FACTS.md)) — never an agent call.
The server never signs anything and never needs a secret. See
[Code-first, deploy-second](#code-first-deploy-second).

Everything below is verified against the installed SDK
([FACTS.md §9, §15](FACTS.md)); the tests in
[test/mcp.test.ts](../test/mcp.test.ts) spawn the real server over stdio and
call every tool against committed fixtures with no network access.

## Contents

- [Running it](#running-it)
- [Registering it with an agent](#registering-it-with-an-agent)
- [The four tools](#the-four-tools)
- [Structured I/O and schemas](#structured-io-and-schemas)
- [Error codes](#error-codes)
- [Determinism map](#determinism-map)
- [Reuse audit — what each tool wraps](#reuse-audit--what-each-tool-wraps)
- [Configuration](#configuration)
- [Code-first, deploy-second](#code-first-deploy-second)
- [Testing](#testing)

## Running it

```bash
npm ci
npm run mcp            # serves MCP over stdio until the client closes it
```

`npm run mcp` runs `tsx src/mcp/server.ts`. The server speaks JSON-RPC on
stdin/stdout and logs only to stderr. It advertises itself as
`policywright` (version from `package.json`) and serves both protocol eras
the v2 SDK supports — the current `2026-07-28` revision and the legacy
`initialize`-handshake era that Claude Code uses for stdio servers by default
([FACTS.md §9.2](FACTS.md)).

SDK: `@modelcontextprotocol/server` **2.0.0** (v2 line, spec `2026-07-28`),
`zod` **4.5.4**, both pinned exactly in `package.json`. The test client is
`@modelcontextprotocol/client` 2.0.0 (dev dependency).

## Registering it with an agent

Tools are callable as `mcp__policywright__<tool>` once registered
([FACTS.md §9.4](FACTS.md)).

**Claude Code — project scope (committed).** [`.mcp.json`](../.mcp.json) at
the repository root registers the server for anyone who opens this project in
Claude Code; Claude Code asks for approval the first time. It launches the
repository's own pinned `tsx` on `src/mcp/server.ts`, so `npm ci` is the only
prerequisite. `claude mcp list` shows it and checks it starts.

**Claude Code — any other scope.** From the repository root:

```bash
claude mcp add --transport stdio policywright -- npm run --silent mcp
# or, cwd-independent:
claude mcp add --transport stdio policywright -- \
  node "$PWD/node_modules/tsx/dist/cli.mjs" "$PWD/src/mcp/server.ts"
```

Add `-e POLICYWRIGHT_NETWORK=testnet -e POLICYWRIGHT_RPC_URL=<url>` to pin the
network/endpoint (see [Configuration](#configuration)).

**Claude Desktop.** Add to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`) with
**absolute paths** and restart Desktop fully:

```json
{
  "mcpServers": {
    "policywright": {
      "command": "node",
      "args": [
        "/absolute/path/to/policywright/node_modules/tsx/dist/cli.mjs",
        "/absolute/path/to/policywright/src/mcp/server.ts"
      ],
      "env": { "POLICYWRIGHT_NETWORK": "testnet" }
    }
  }
}
```

The server's stderr lands in `~/Library/Logs/Claude/mcp-server-policywright.log`.

The reference session to run once registered is
[mcp-reference-session.md](mcp-reference-session.md).

## The four tools

Every tool takes one JSON object and returns one JSON object
(`structuredContent`, also serialised into the text block). Inputs that name
files (`recordingPath`, `artifactPath`, …) are read by the server process:
absolute paths as given, relative paths against the repository root
(`POLICYWRIGHT_ROOT`). Only `.json` files are read, `.env*` names are refused,
and a file that is not JSON is reported without echoing its content. The two
tools that can write (`record.outPath`, `synthesize.outDir`) never replace an
existing file unless the call says `overwrite: true`; every RPC URL that
appears in an output or a message is redacted to origin + path (no
credentials, query, or fragment).

| Tool         | What it is for                                                                                                                                                                                                                                                                    | Input (one of)                                                                                  | Output carries                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `record`     | Turn what already happened on-chain into a `RecordedTx`: fetch one or more transaction hashes from Soroban RPC (a multi-step flow is several hashes, merged in ledger order), or ingest a saved `simulateTransaction` exchange. The recording is the input to the next two tools. | `hashes` (+ `account`) · `simulation` / `simulationPath`                                        | `recording` (the `RecordedTx` JSON the CLI prints), a `summary` of calls and token flows, the recorder's `warnings`                                                      |
| `synthesize` | Derive the least-privilege authorization for a recording: the context rule (scope), the composed stock-policy configuration, the generated policy, and the notes/warnings a reviewer must read. Pure — same input, same output.                                                   | `recording` / `recordingPath` (+ `config`, `installTargets`, `now`, `outDir`)                   | `spec`, `contextRule` (schema v2), `summary`, `rustPolicy` (with the **unaudited banner**), `notes`, `warnings`, `realisations`, `installable` (would it install as-is?) |
| `simulate`   | Dry-run the synthesized policy set: the standard permit/deny/flag scenarios plus any candidate calls the caller supplies, as a data table and as the Markdown report. Pure.                                                                                                       | `recording` / `recordingPath` (+ `config`, `probeToken`, `candidates`, `standardScenarios`)     | `results` rows (`decision`, `reasonCode`, `reason`, `enforcedBy`, expectation match), `counts`, the `report`                                                             |
| `verify`     | Read a smart account's installed rules and policy parameters from chain and diff them against an emitted artifact. Read-only simulated getters; nothing is signed or submitted.                                                                                                   | `artifact` / `artifactPath`, `account` (+ `installLog` / `installLogPath`, `network`, `rpcUrl`) | `pass`, the diff `rows`, `extraRules`, the Markdown `report`, `warnings` for parameters that could not be read                                                           |

The full field-by-field contract is the committed JSON Schema for each tool
under [schemas/mcp/](../schemas/mcp/); the tool descriptions the server
advertises say when to use each tool and what to do with its result.

## Structured I/O and schemas

- **Versioned.** Every input accepts and every output carries
  `schemaVersion: 1` — the MCP I/O schema version (`MCP_SCHEMA_VERSION` in
  [src/mcp/schemas.ts](../src/mcp/schemas.ts)). Artifacts embedded in outputs
  keep their own version: `contextRule.schemaVersion` is the
  `context-rule.json` schema version (**2**, [context-rule-schema.md](context-rule-schema.md)).
  A consumer must reject versions it does not know; the server rejects an
  input `schemaVersion` it does not know with `BAD_INPUT`.
- **One source of truth.** The Zod schemas in `src/mcp/schemas.ts` define the
  contracts; the server advertises them as JSON Schema (draft 2020-12) in
  `tools/list`, and `npm run mcp:schemas` writes the same JSON Schema to
  [schemas/mcp/](../schemas/mcp/) (`--check` fails if the committed copies
  drift; CI runs it, and the stdio test asserts the advertised schemas equal
  the committed files).
- **Banner.** Every output that contains generated code carries the banner
  verbatim: `synthesize.unauditedBanner` is the sentence _"Generated contracts
  are illustrative and unaudited — not for production deployment until the
  Audit Bank audit."_, `synthesize.rustPolicy.banner` is the full
  `ILLUSTRATIVE / UNAUDITED` header block the Rust file starts with (which
  contains that sentence), and `rustPolicy.unaudited` is `true`. The Rust
  source itself is inline in `rustPolicy.source` unless it was written to
  `outDir` (then `rustPolicy.path` names the file; `includeRustSource: true`
  forces it inline); `sourceBytes` is always present.
- **Bigints** travel as decimal strings (as in every committed artifact);
  byte arguments as `hex:<…>` strings — the CLI's own serialisation.

## Error codes

A tool failure is an MCP _tool execution error_: a result with
`isError: true` whose single text block is the JSON envelope

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": { "code": "TX_NOT_FOUND", "message": "…", "source": "RecorderError" }
}
```

There is deliberately **no `structuredContent` on an error result**: clients
validate `structuredContent` against the tool's output schema whenever it is
present — the client bundled in Claude Code 2.0.76 does so even on `isError`
results ([FACTS.md §15.2](FACTS.md)) — and an error envelope cannot conform
to a success schema. The envelope's own JSON Schema is
[schemas/mcp/error.json](../schemas/mcp/error.json).

`code` is mapped from the existing typed taxonomies — nothing is invented:

| Code            | From                                                                                                   | Meaning                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BAD_INPUT`     | `RecorderError`, `InstallError`, `SynthError`, and the server's own semantic checks (`ToolInputError`) | the caller's arguments or files are invalid: unknown `schemaVersion`, both `hashes` and a simulation, a malformed recording or install log, a bad config value, an unreadable or non-JSON file, an existing output without `overwrite`, a checksum-invalid account                           |
| `TX_NOT_FOUND`  | `RecorderError`                                                                                        | the node has no record of the hash; the `message` states the node's retention window (public nodes keep ~7 days) — there is no `details` field                                                                                                                                               |
| `NETWORK`       | `RecorderError`, `InstallError`                                                                        | the RPC endpoint could not be reached, or a simulated getter failed                                                                                                                                                                                                                          |
| `DECODE_FAILED` | `RecorderError` (`error.section` names the XDR part)                                                   | fetched data did not match the shapes in FACTS.md                                                                                                                                                                                                                                            |
| `SHAPE_INVALID` | `ToolInputError` wrapping `parseContextRuleDocument`                                                   | the `verify` input is not a context-rule document at all (no numeric `schemaVersion` / `contextRules` array, a malformed rule or binding). OZ install-signature **violations are not errors**: they come back as data in `synthesize.installable.violations` and `verify.artifactViolations` |
| `INTERNAL`      | anything else                                                                                          | an unexpected failure; the message is the error's message                                                                                                                                                                                                                                    |

`error.details` is present only when the source carried structured details
(an `InstallError`'s details, the server's own checks); `error.section` only
for `DECODE_FAILED`. `InstallError`'s `NO_SIGNING_SURFACE`, `SIMULATION_FAILED`
and `SUBMIT_FAILED` are install-only and unreachable from this server.

Two failures never reach a tool: **input-schema validation** comes back as a
plain-text `isError` result from the SDK (`Input validation error: Invalid
arguments for tool …`, no envelope), and an **unknown tool** is a JSON-RPC
`-32602` protocol error that the client raises as an exception. Both are the
SDK's documented behaviour ([FACTS.md §15.2](FACTS.md)); the test suite pins
them.

## Determinism map

Written before the code, and honest about the network tools.

| Tool         | Pure? | Same input → same output when…                                                                                                                                                                                       | Reads the clock?                                                       | Touches the network?                                                                                                                                                     | Writes files?                |
| ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `record`     | No    | …the chain state seen by the node is the same: the transactions are inside the node's retention window, and the tokens' `symbol()`/`decimals()` simulate to the same values. Deterministic per (input, chain state). | No — `timestamp`/`ledger` come from the chain, never from `Date.now()` | Yes: `getTransaction` per hash; `simulateTransaction` of the SEP-41 getters per token (also for the `simulation` input, which needs token metadata)                      | Only when `outPath` is given |
| `synthesize` | Yes   | always. `now` defaults to `recording.timestamp` (the CLI's rule); no clock, no network, no randomness, no environment.                                                                                               | No                                                                     | No                                                                                                                                                                       | Only when `outDir` is given  |
| `simulate`   | Yes   | always. Scenario timestamps derive from the spec; the probe token derives from the network passphrase (`Asset.native().contractId`), a pure function.                                                                | No                                                                     | No                                                                                                                                                                       | No                           |
| `verify`     | No    | …the account's installed rules, the policies' stored parameters and `latestLedger` are unchanged. Deterministic per (artifact, install log, chain state). The `diffRules` core is pure and network-free.             | No                                                                     | Yes: simulated read-only getters (`get_context_rules_count`, `get_context_rule`, `get_frequency_limit_data`, `get_spending_limit_data`) — nothing is signed or submitted | No                           |

The server holds no state between calls; every call is independent. Reading a
`*Path` input is I/O at the edge of an otherwise pure tool (`synthesize`,
`simulate`): the same file content gives the same output.

## Reuse audit — what each tool wraps

Tools wrap the library; no policy logic is re-implemented in `src/mcp/`.
Where the CLI held orchestration that the server also needs, it was moved into
the library and the CLI now calls the same function (behaviour unchanged).

| Tool         | Library entry points (all pre-existing unless marked)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Typed errors it can surface                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `record`     | `recordFromHashes` (src/sources/rpc.ts); `ingestSimulation` + `tokenResolverFor` (src/sources/simulation.ts, rpc.ts); `recordedTxToJson` (**moved** from cli.ts into src/sources/recorded.ts) and its **new** object form `recordedTxToJsonValue`; **new** `defaultRpcUrl` (src/sources/rpc.ts, exposes the pre-existing endpoint table); `formatAmount` (emitter) for the summary                                                                                                                                                          | `RecorderError`: `BAD_INPUT`, `TX_NOT_FOUND`, `NETWORK`, `DECODE_FAILED`         |
| `synthesize` | `parseRecordedJson` (src/sources/recorded.ts); `synthesize`, `realisePolicies` (src/synthesizer.ts); `emit`, `describePolicy`, `describeBinding` (src/emitter.ts); `ILLUSTRATIVE_HEADER` (src/rust-policy.ts); `parseContextRuleDocument` + `validateContextRuleDocument` (src/install-shape.ts) for the `installable` verdict; `DEFAULT_SYNTH_CONFIG`, `NO_INSTALL_TARGETS`, `ESTIMATED_SECS_PER_LEDGER` (src/types.ts). The `scopeNotes` prose reads the spec (policies, emitted rules, argument scopes) — it never re-derives a decision | `SynthError` → `BAD_INPUT`; `RecorderError` `BAD_INPUT` on a malformed recording |
| `simulate`   | `parseRecordedJson`; `synthesize`; `evaluateScenarios` (**new** in src/simulate.ts — composes the pre-existing `probeTokenFor`, `tokenLabelsFor`, `buildScenarios`, `simulateCall`, `renderReport`; the CLI and the demo now call it too)                                                                                                                                                                                                                                                                                                   | `SynthError` → `BAD_INPUT`; probe-token shape is enforced by the input schema    |
| `verify`     | `parseContextRuleDocument`, `validateContextRuleDocument` (src/install-shape.ts); `verifyArtifact` and `expectedValidUntilFromInstallLog` (**new** in src/verify.ts — the read-rules → read-params → `diffRules` orchestration that lived in `cmdVerify`; the CLI now calls it); `renderVerifyReport`                                                                                                                                                                                                                                       | `InstallError`: `BAD_INPUT`, `NETWORK`; `SHAPE_INVALID` from the artifact gate   |

The CLI's typed error taxonomy, for reference: `RecorderError` codes
`BAD_INPUT | TX_NOT_FOUND | NETWORK | DECODE_FAILED` (src/sources/errors.ts);
`InstallError` codes `SHAPE_INVALID | BAD_INPUT | NO_SIGNING_SURFACE |
SIMULATION_FAILED | SUBMIT_FAILED | NETWORK` (src/install.ts); `SynthError`
(uncoded). The fixture loader's `FixtureError` is not reachable — no tool
loads the baked-in fixture. The server's mapping is in
[src/mcp/tools.ts](../src/mcp/tools.ts) (`toToolError`).

## Configuration

No secrets, ever. The server reads three optional environment variables:

| Variable               | Default                                                            | Meaning                                                                                                  |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `POLICYWRIGHT_NETWORK` | `testnet`                                                          | `testnet` \| `mainnet` \| `futurenet` — the network `record` and `verify` use unless a call overrides it |
| `POLICYWRIGHT_RPC_URL` | the network's public endpoint (src/sources/rpc.ts, src/install.ts) | the Soroban RPC endpoint; a call's `rpcUrl` overrides it                                                 |
| `POLICYWRIGHT_ROOT`    | the repository root                                                | base for relative `*Path` inputs                                                                         |

`STELLAR_SECRET_KEY` is never read: the server has nothing to sign. The test
suite starts the server with a fake secret in its environment and asserts no
output contains it. A keyed `POLICYWRIGHT_RPC_URL` (credentials or a query
token) is redacted wherever a URL is echoed.

## Code-first, deploy-second

Structural, not stylistic. The server registers exactly four tools; there is
no `install`, no `deploy`, no `sign`, no `submit`. The test suite asserts the
tool list. `synthesize` tells the agent whether the artifact would install
as-is (`installable.asIs` and the OZ violations otherwise) and the server's
instructions tell the agent what the human does next:

```bash
npm run cli -- install --artifact <context-rule.json> --account <C…> --dry-run   # simulate only
npm run cli -- install --artifact <context-rule.json> --account <C…>             # sign + submit (testnet, .env key)
```

That step reads the artifact the agent produced, unmodified, and refuses
anything that would not install as-is ([smart-account-install.md](smart-account-install.md)).
Today it signs with the operator's `.env` key (the labelled fallback); a
wallet signing surface is the open cohort-wallet track. Neither is reachable
from the server.

## Testing

`npm test` runs [test/mcp.test.ts](../test/mcp.test.ts), which

1. starts a local stub Soroban RPC (`test/stub-rpc.ts`) that replays the
   committed raw `getTransaction` captures of the real claim→swap sequence,
   answers the token metadata getters, and serves the installed rules and
   policy parameters of the testnet smart account exactly as recorded in
   `examples/live/testnet/`;
2. spawns the real server over stdio (`node_modules/tsx` on
   `src/mcp/server.ts`) with `POLICYWRIGHT_RPC_URL` pointing at the stub and a
   fake `STELLAR_SECRET_KEY` in its environment;
3. calls every tool through `@modelcontextprotocol/client` and asserts: the
   tool list (exactly four, no install/deploy/sign/submit) and that
   `src/mcp/tools.ts` imports only `InstallError` from the installer; the
   advertised schemas equal the committed files; `record` reproduces
   `examples/live/recorded-claim-swap-fresh.json` byte-for-byte and ingests
   the committed simulation exchange; `synthesize` reproduces the four
   artifacts under `examples/live/fresh/` (`synth.args` there is the CLI flag
   file the test reads its `installTargets` from); `simulate` reproduces
   both committed reports and evaluates caller-supplied candidates;
   `verify` reproduces `examples/live/testnet/verify.md` (PASS, 15 rows); the
   error codes reachable over stdio (`BAD_INPUT`, `TX_NOT_FOUND`, `NETWORK`,
   `SHAPE_INVALID`, the SDK-formatted schema error, the unknown-tool
   protocol error; `DECODE_FAILED` and the full mapping are unit-tested);
   error results carry no `structuredContent`; the banner; overwrite
   refusal; URL redaction; no secret and no file content in any output.

CI runs the suite and `npm run mcp:schemas -- --check`
([ci.yml](../.github/workflows/ci.yml)).
