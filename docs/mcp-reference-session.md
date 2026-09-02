# MCP reference session

The exact conversation to run in Claude Code (or Claude Desktop) against the
policywright MCP server, exercising all four tools on the **real recorded
data** committed in this repository, plus the live testnet smart account. This
is the human-recorded half of D2.1 — "The server runs locally and an agent
calls each tool end to end; a reference session is recorded."

Every expected result below is something the network-free test suite already
reproduces byte-for-byte from committed artifacts
([test/mcp.test.ts](../test/mcp.test.ts)); the session shows the same calls
going through a real agent host, with the two network tools (`record`,
`verify`) reaching the real testnet RPC.

## Before you start

```bash
git clone https://github.com/kunal-drall/policywright && cd policywright
npm ci
npm test                      # 215 tests incl. the stdio MCP suite and the skill walkthrough — must be green
claude mcp list               # → "policywright: … ✓ Connected" (from the committed .mcp.json)
```

Open Claude Code **in the repository root** (`claude`); approve the
project-scoped server when prompted. Tools appear as
`mcp__policywright__record`, `mcp__policywright__synthesize`,
`mcp__policywright__simulate`, `mcp__policywright__verify`. For Claude
Desktop, register with absolute paths as in
[mcp-server.md](mcp-server.md#registering-it-with-an-agent) and restart it.

No secret is needed at any point. Nothing in this session installs, signs, or
submits anything.

## The conversation

Say each **You:** line verbatim (or close to it). "Expected tool call" is the
call the agent should make; "Expected result" is what to check before moving
on. If the agent calls a different tool, or invents a value, stop and note it —
that is a finding, not something to work around.

### Turn 1 — record a real simulated flow (network: token metadata)

> **You:** Use policywright to record the saved simulateTransaction exchange at
> `examples/live/simulated-soroswap-swap.json`, attributing movements to
> `GABJUTWU2LMN7VYU7Z43GV2OY7HPL5RXXJAQUBYHYLW5KHTRJUVNNJ3Q`. Summarise the
> calls and token flows and any warnings.

Expected tool call — `mcp__policywright__record`:

```json
{
  "simulationPath": "examples/live/simulated-soroswap-swap.json",
  "account": "GABJUTWU2LMN7VYU7Z43GV2OY7HPL5RXXJAQUBYHYLW5KHTRJUVNNJ3Q"
}
```

Expected result: `ok: true`, `source: "simulation"`, one call
`swap_exact_tokens_for_tokens` on the Soroswap router
`CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`, flows
`out 1 native (XLM)` and `in 0.0316046` of `CB3TLW74…JOV2F`; token
symbol/decimals resolved live from testnet (`resolved: true`; if a token's
metadata cannot be resolved the flow says `resolved: false` and `warnings`
explains). This is the recorder's simulation path on a real captured exchange
([FACTS.md §3.6](FACTS.md)).

### Turn 2 — record by hash: the retention window, honestly

> **You:** Now record the real claim→swap sequence by hash:
> `9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6` and
> `ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46`, account
> `GBMWJIADBWN6FJUQPSVKWZE7ZFEPHEN2YBINQ7UVPHJ2WJW2SWI6WD4Q`. If the node no
> longer has them, tell me why and what to do instead.

Expected tool call — `mcp__policywright__record`:

```json
{
  "hashes": [
    "9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6",
    "ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46"
  ],
  "account": "GBMWJIADBWN6FJUQPSVKWZE7ZFEPHEN2YBINQ7UVPHJ2WJW2SWI6WD4Q"
}
```

Expected result **today**: an `isError` result whose text is the JSON envelope
`{ ok: false, error: { code: "TX_NOT_FOUND", … } }` — these transactions
closed at ledger 4029100 on 2026-08-08 and public testnet RPC retains
120 960 ledgers (about 7 days; [FACTS.md §15](FACTS.md)). The agent should
relay the code and the node's window, and propose the committed recording of
exactly that sequence (`examples/live/recorded-claim-swap-fresh.json`, proven
byte-identical to the raw captures by `test/recorder.test.ts`) for the next
steps. If you have performed a claim→swap on testnet within the last week,
pass those hashes instead and expect a success shaped like the committed
recording (`summary.calls` = `claim`, `swap_exact_tokens_for_tokens`).

### Turn 3 — synthesize the reviewable policy (pure)

> **You:** Synthesize the least-privilege authorization from
> `examples/live/recorded-claim-swap-fresh.json`, with signer
> `GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W` (Delegated) and the
> deployed policy addresses `custom:FrequencyLimitPolicy` =
> `CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP`,
> `stock:spending_limit` = `CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E`.
> Explain in plain language what it permits, what it caps, what it does not
> permit, and whether it would install as-is.

Expected tool call — `mcp__policywright__synthesize`:

```json
{
  "recordingPath": "examples/live/recorded-claim-swap-fresh.json",
  "installTargets": {
    "signers": [
      { "type": "Delegated", "address": "GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W" }
    ],
    "policyAddresses": {
      "custom:FrequencyLimitPolicy": "CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP",
      "stock:spending_limit": "CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E"
    }
  }
}
```

Expected result: `contextRule` equal to the committed
[examples/live/fresh/context-rule.json](../examples/live/fresh/context-rule.json)
(three rules `pw:claim`, `pw:swap`, `pw:xfer:BLND`; `schemaVersion: 2`),
`installable.asIs: true`, `spec`/`summary`/`rustPolicy.source` equal to the
committed `spec.json` / `summary.txt` / `FrequencyLimitPolicy.rs`. The agent
must show the banner (`unauditedBanner`) when it mentions the generated Rust,
and relay: BLND outflow capped at 2.3533505 per 86400 s; USDC only flowed in
so no cap; at most 5 calls per day; lifetime 30 days (518 400 ledgers); the
swap `path` constraint is ADVISORY (flag only) — from `scopeNotes` and
`notes`, including the `DELTA:` note.

### Turn 4 — re-synthesize with the argument constraint enforced

> **You:** Same again, but enforce the argument constraints and set the
> lifetime to 7 days. What changed?

Expected tool call — `mcp__policywright__synthesize` with the same
`recordingPath` and `installTargets` plus
`"config": { "constrainArguments": true, "lifetimeSecs": 604800 }`.

Expected result: `config.constrainArguments: true`, `scopeNotes` now says
`ENFORCED`, `contextRules[*].lifetimeLedgers: 120960`; the agent explains that
a route through an unobserved token would now be denied in the dry run, and
that this is still offline-only (no on-chain artifact for it yet — the `DELTA`
note).

### Turn 5 — dry-run both ways (pure)

> **You:** Dry-run the default policy set for that recording, then the
> enforced one. Show me the permit/deny/flag table for each and say what the
> difference means.

Expected tool calls — `mcp__policywright__simulate` twice:

```json
{ "recordingPath": "examples/live/recorded-claim-swap-fresh.json" }
```

```json
{
  "recordingPath": "examples/live/recorded-claim-swap-fresh.json",
  "config": { "constrainArguments": true }
}
```

Expected results: first call `counts: { permit: 1, deny: 4, flag: 1 }`,
`deviations: 0`, the `BLND→XLM swap (route through unobserved XLM)` row
**flagged** (`argument-constraint`) with `report` equal to the committed
[simulation-report.md](../examples/live/simulation-report.md); second call
`counts: { permit: 1, deny: 5, flag: 0 }`, the same row **denied**, `report`
equal to
[simulation-report.constrained.md](../examples/live/simulation-report.constrained.md).
The agent should say a flag means "permitted, with a scope gap".

### Turn 6 — verify the live testnet install (network: read-only)

> **You:** Verify what is installed on the testnet smart account
> `CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT` against
> `examples/live/fresh/context-rule.json`, using the install log
> `examples/live/testnet/install-20260902T105742Z.json`.

Expected tool call — `mcp__policywright__verify`:

```json
{
  "artifactPath": "examples/live/fresh/context-rule.json",
  "account": "CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT",
  "installLogPath": "examples/live/testnet/install-20260902T105742Z.json"
}
```

Expected result while the D2.5 rules are live (they expire at ledger
4 983 015, ≈ 2026-10-02): `pass: true`, 15 rows all `ok`, rules found as ids
1–3 (the install log's `valid_until` 4983015 selects them), `extraRules` =
the admin rule id 0 `multisig` plus any later installs of the same artifact
names — ids 4–6 from the demo-script run of 2026-09-02 until ledger 4 588 890
(≈ 2026-09-09), and whatever a demo recording adds — and a `report` matching
[examples/live/testnet/verify.md](../examples/live/testnet/verify.md) except
for the `read at ledger` number and that informational list. After expiry the `valid_until` rows fail
(`pass: false`) and the agent should say so plainly; if the RPC endpoint is
unreachable the result is a `NETWORK` error envelope.

### Turn 7 — the deploy-second boundary (no tool call)

> **You:** Install it for me.

Expected: **no tool call**. The agent explains there is no install tool by
design and hands over the human step —
`npm run cli -- install --artifact <context-rule.json> --account CBQ6H7IL… --dry-run`
then without `--dry-run` — which signs with the operator's own key. If the
agent attempts anything else, that is a finding.

## Recording it

The six tool calls above were made from Claude Code 2.0.76 on 2026-09-02
and returned exactly the expected shapes (results quoted in
[demo-script-t2.md](demo-script-t2.md), Beat 1); what the criterion still
needs is the saved transcript of a human-run session.

1. Run the seven turns in one session.
2. Save the transcript: in Claude Code, copy the conversation (or use the
   session export) to `evidence/sessions/mcp-reference-session-<YYYY-MM-DD>.md`;
   in Claude Desktop, save a screen recording or screenshots of every tool call
   and result.
3. Note the Claude Code / Desktop version and the date at the top of the file.
4. Link the file from [EVIDENCE.md § D2.1](../evidence/EVIDENCE.md) and close
   the BLOCKER there.

The transcript is evidence only if it is unedited; a turn that deviated from
the expectation stays in, with a note.
