# Demo script — the recordable Tranche 2 demo

Five beats, ≤ 5:00 total. Every `[EXPECT]` block below is real output produced
on 2026-09-02 by running the command — or making the agent tool call — shown,
against the public testnet RPC (`https://soroban-testnet.stellar.org`) and
the live testnet smart account
[`CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT`](https://stellar.expert/explorer/testnet/contract/CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT).
Values that depend on the ledger at run time — ledger heads, `valid_until`,
rule ids, transaction hashes, auth digests, timestamps — are marked as such;
everything else reproduces verbatim. The artifact this script installs is
committed under [examples/live/demo/](../examples/live/demo/) (its flags in
`synth.args`; CI re-emits and diffs it), the install log at
[examples/live/testnet/install-20260902T153356Z.json](../examples/live/testnet/install-20260902T153356Z.json),
and the verify output at
[examples/live/testnet/verify-demo-20260902T153356Z.md](../examples/live/testnet/verify-demo-20260902T153356Z.md).

The three human-recorded artifacts Tranche 2 still needs are this video
(D2.5's "end-to-end demo recorded"), the MCP reference-session transcript
(D2.1 — [mcp-reference-session.md](mcp-reference-session.md)) and the skill
demo transcript (D2.2 — [skill-demo-script.md](skill-demo-script.md)). Beats
1 and 2 below are those two conversations, so one recording session can
produce all three: save the unedited Claude Code transcript as
`evidence/sessions/mcp-reference-session-<YYYY-MM-DD>.md` and
`evidence/sessions/skill-demo-<YYYY-MM-DD>.md`, and link them from
[EVIDENCE.md](../evidence/EVIDENCE.md).

## Prep (off camera)

- `git clone https://github.com/kunal-drall/policywright && cd policywright && npm ci && npm test`
  — green (215 tests, including the stdio MCP suite and the skill
  walkthrough). `jq` on the machine.
- `claude mcp list` from the repository root → `policywright: … ✓ Connected`
  (the committed [`.mcp.json`](../.mcp.json)); `claude` in the same directory
  loads the project skill from `.claude/skills/`.
- The gitignored `.env` with `STELLAR_SECRET_KEY` / `STELLAR_PUBLIC_KEY` of
  the funded testnet identity `GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W`
  (≥ 10 XLM; refund via `https://friendbot.stellar.org?addr=<G…>`). It is
  never shown on camera; the three install transactions cost ~0.035 XLM.
- **Retention.** The criterion hashes `9fff676c…` / `ae943f99…` (the real
  claim → swap of 2026-08-08) left the public node's ~7-day window around
  2026-08-15 — re-checked 2026-09-02: `TX_NOT_FOUND`, node window ledgers
  4346894–4467853. Beat 1 therefore records the committed **real
  `simulateTransaction` exchange** live (token metadata resolves on-chain)
  and shows the honest `TX_NOT_FOUND` for the old hashes; Beat 2 continues
  from the committed recording, exactly as the two scripts say. _Optional
  live-hash path:_ within 7 days before recording, perform a fresh Blend
  `claim` → Soroswap BLND→USDC swap from `GBMWJIAD…` (as on 2026-08-08, e.g.
  built as raw XDR against the router and signed in Stellar Lab) and pass the
  two fresh hashes in Beat 1 and Beat 2 — the result shapes equal the
  committed recording with new hashes, ledger and amounts.
- **Rules on the account** at the time of writing: id 0 (admin), ids 1–3
  (D2.5, `valid_until` 4983015 ≈ 2026-10-02), ids 4–6 (this script's real
  run, `valid_until` 4588890 ≈ 2026-09-09). Beat 4 appends the next three
  ids; Beat 5 verifies **through the install log**, which is what selects an
  install when the same artifact has been installed more than once.
- If the restored policy entries have lapsed (after ≈ 2026-10-02):
  `scripts/restore-testnet.sh` first.

---

## Beat 1 — an agent calls the MCP tools live (0:00–0:55)

**[SAY]** "This is Tranche 2 of policywright. The engine from Tranche 1 is
now served to agents as four MCP tools — record, synthesize, simulate,
verify — from the committed `.mcp.json`. There is no install or deploy tool,
by design. Here is Claude Code calling them against the live testnet."

**[DO]** In Claude Code from the repository root, say Turn 1, Turn 2 and
Turn 6 of [mcp-reference-session.md](mcp-reference-session.md) verbatim
(record the saved simulation exchange; record the old hashes; verify the
account against `examples/live/fresh/context-rule.json` with the D2.5 install
log). Keep the tool-result panels open.

**[EXPECT]** (real tool results, 2026-09-02, Claude Code 2.0.76):

`mcp__policywright__record` on `examples/live/simulated-soroswap-swap.json`,
account `GABJUTWU…`:

```json
{
  "ok": true,
  "source": "simulation",
  "network": "testnet",
  "summary": {
    "calls": [
      {
        "contract": "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
        "fnName": "swap_exact_tokens_for_tokens"
      }
    ],
    "flows": [
      { "symbol": "native", "resolved": true, "direction": "out", "amountFormatted": "1" },
      { "symbol": "USDC", "resolved": true, "direction": "in", "amountFormatted": "0.0316046" }
    ]
  },
  "warnings": []
}
```

(fields elided for the page; `resolved: true` is the live SEP-41 metadata
lookup — the only network access in this call).

`mcp__policywright__record` on the two old hashes — an `isError` result
whose text is the envelope (the ledger numbers move with the node):

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "TX_NOT_FOUND",
    "message": "[TX_NOT_FOUND] transaction 9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6 not found on testnet. Public RPC nodes only retain recent history (this node: ledgers 4346894–4467853, oldest closed 2026-08-26T15:24:29.000Z, about 7 days); older transactions must be recorded from a saved capture or an archival node. Also check the hash is on the right network.",
    "source": "RecorderError"
  }
}
```

`mcp__policywright__verify` on `CBQ6H7IL…QHDT` with
`examples/live/fresh/context-rule.json` and
`examples/live/testnet/install-20260902T105742Z.json`: `pass: true`, 15
rows `ok`, rules found as ids 1–3, every `valid_until` `4983015 (install
log)`, `extraRules` = id 0 (`Default "multisig"`) plus ids 4–6 (later
installs of the same names — see Prep), `latestLedger` 4467855 at the time.

Say over it: "Every number the agent shows came out of a tool result; the
old hashes fail honestly with the node's retention window instead of a
guess."

## Beat 2 — the skill: "grant permission to…" with a clarification (0:55–2:05)

**[SAY]** "The `policywright-grant` skill turns that into a conversation.
I'll ask it to grant permission to claim my Blend yield and swap it to USDC.
It records, synthesizes with defaults, then asks before assuming — the cap,
the lifetime, whether other swap routes are denied, and the signer and policy
addresses it cannot know from the recording."

**[DO]** Say Turn 1 of [skill-demo-script.md](skill-demo-script.md)
verbatim ("Grant permission to claim my Blend yield and swap it to USDC. Here
are the transactions: … My account is `GBMWJIAD…`"). On `TX_NOT_FOUND`
answer "Use the saved recording at
`examples/live/recorded-claim-swap-fresh.json`". When the skill asks its
questions, answer Turn 3 verbatim: "Keep the 10 % headroom but over a week,
lifetime 7 days, deny other routes. Signer `GATUKCIM…KS3W`; the frequency
policy is at `CDSVPSTS…2ZPP` and the spending limit at `CCOQPGEY…4W4E`.
Write the files to `out/grant-blend-swap`." Let it dry-run. Then say "Just
install it."

**[EXPECT]** (real tool results, 2026-09-02):

First `mcp__policywright__synthesize` (defaults): `installable.asIs: false`
with four violations (three `policy address is null — synthesize with
--policy-address …`, one `spending_limit needs at least one authenticated
signer … — synthesize with --signer`); `scopeNotes` include, verbatim:

```
BLND: outflow capped at 2.3533505 per 86400s (observed gross out 2.1394095, capMultiplier 1.1).
USDC: no spend cap emitted — the synthesizer caps gross OUTFLOW only and found none for this asset (minimal permission: nothing moved out, nothing to cap).
Argument scope (swap-path): swap_exact_tokens_for_tokens arg[2] (path) observed token set of 2 — ADVISORY: a route through any other token is permitted and flagged as a scope gap; set config.constrainArguments to enforce. Offline-only until the argument-checking policy codegen exists.
Lifetime: 2592000s (518400 ledgers at an estimated 5 s/ledger); frequency: at most 5 call(s) per 86400s.
```

The skill's next message asks, numbered, at least **T1** (cap: exactly
2.1394095, the 10 % headroom, or another ceiling/window), **T2** (lifetime),
**T4** (deny other routes or allow-and-flag) and **T5** (signer and deployed
policy addresses). This is the clarification moment — pause on it.

Second `mcp__policywright__synthesize` (with the answers):
`installable.asIs: true`, `violations: []`; `config` =
`{ lifetimeSecs: 604800, spendWindowSecs: 604800, capMultiplier: 1.1, constrainArguments: true }`;
every rule `lifetimeLedgers: 120960`; `pw:xfer:BLND` →
`stock:spending_limit { spending_limit: "23533505", period_ledgers: 120960 }`;
`scopeNotes` now say `ENFORCED`; `files` = `summary.txt`, `spec.json`,
`context-rule.json`, `FrequencyLimitPolicy.rs` under `out/grant-blend-swap/`;
the skill quotes the banner with the Rust: _Generated contracts are
illustrative and unaudited — not for production deployment until the Audit
Bank audit._ (The same four files, emitted by the CLI with the same values,
are committed under [examples/live/demo/](../examples/live/demo/) — byte
identical.)

`mcp__policywright__simulate` (same recording, same config):
`counts: { permit: 1, deny: 5, flag: 0 }`, `deviations: 0`:

```
| replay recorded flow | ✅ permit (permit) | — | within scope, lifetime, argument, spend cap, and frequency limits |
| over the spend cap | ⛔ deny (spending-limit) | composed stock:spending_limit on rule pw:xfer:BLND | outflow of 2.3533506 BLND exceeds the 2.3533505 cap per 604800s |
| call to an unseen function | ⛔ deny (scope) | context rule scope — … | set_admin @ CCJUD55A… is outside the context rule's scope |
| call after rule expiry | ⛔ deny (lifetime) | context rule valid_until — … | call at 1786770913 is after the rule expires at 1786770912 |
| over the frequency limit | ⛔ deny (frequency-limit) | generated custom:FrequencyLimitPolicy (FrequencyLimitPolicy.rs) on rules pw:claim, pw:swap | this would be call 6 within 86400s, over the cap of 5 |
| BLND→XLM swap (route through unobserved XLM) | ⛔ deny (argument-constraint) | dry-run harness only — no on-chain artifact yet | argument constraint violated: swap_exact_tokens_for_tokens arg[2] path (rule swap-path) must stay within the observed token set {BLND CB22KRA3…, USDC CAQCFVLO…}; candidate routes through unobserved XLM CDLZFC3S… |
```

"Just install it" → **no tool call**; the skill repeats the human command
(`npm run cli -- install --artifact out/grant-blend-swap/context-rule.json --account <C…> --dry-run`, then without `--dry-run`).

Say over it: "Reviewed means dry-run with zero deviations. And the skill
cannot install — it hands me the command."

## Beat 3 — argument-scope deny, both modes, from the CLI (2:05–2:40)

**[SAY]** "The same harness from the CLI on the real recorded claim→swap.
The route BLND→XLM was never observed. By default it is permitted and
flagged as a scope gap; with `--constrain-arguments` it is denied, and the
reason names the rule, the argument, the allowed set and the offending
token. Both reports are committed and CI regenerates and diffs them on every
run."

**[DO]**

```bash
npm run --silent cli -- simulate --input examples/live/recorded-claim-swap-fresh.json | grep 'BLND→XLM'
npm run --silent cli -- simulate --input examples/live/recorded-claim-swap-fresh.json --constrain-arguments | grep 'BLND→XLM'
```

**[EXPECT]** (deterministic; the committed
[simulation-report.md](../examples/live/simulation-report.md) and
[simulation-report.constrained.md](../examples/live/simulation-report.constrained.md),
reproduced 2026-09-02):

```
| BLND→XLM swap (route through unobserved XLM) | ⚠️ flag (argument-constraint) | dry-run harness only — advisory, no on-chain artifact | permitted with a scope gap (constrainArguments is off, so this constraint is advisory): swap_exact_tokens_for_tokens arg[2] path (rule swap-path) must stay within the observed token set {BLND CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF, USDC CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}; candidate routes through unobserved XLM CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC; enable --constrain-arguments to deny it |
| BLND→XLM swap (route through unobserved XLM) | ⛔ deny (argument-constraint) | dry-run harness only — no on-chain artifact yet | argument constraint violated: swap_exact_tokens_for_tokens arg[2] path (rule swap-path) must stay within the observed token set {BLND CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF, USDC CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}; candidate routes through unobserved XLM CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC |
```

Say over it: "Enforced by — the harness only. No stock OpenZeppelin policy
can scope an argument, and the artifact says so in a DELTA note instead of
pretending."

## Beat 4 — install onto the testnet smart account, signed client-side (2:40–3:55)

**[SAY]** "Now the deploy-second half, which no agent can reach. The CLI
takes the artifact the skill produced, unmodified; validates it against
OpenZeppelin's install signature; simulates twice — the second time in
enforcing mode with the account's `AuthPayload` entry and the Delegated
signer's nested `__check_auth` entry that simulation never returns — then
signs here, on this machine, with the operator's key, and submits. The key
never left this machine and the MCP server never saw it."

**[DO]** (the script sources `.env` into the environment and writes the
install log under `examples/live/testnet/`):

```bash
scripts/install-testnet.sh out/grant-blend-swap/context-rule.json --dry-run
scripts/install-testnet.sh out/grant-blend-swap/context-rule.json
```

**[EXPECT]** dry run (real, 2026-09-02 15:31 UTC; on camera the ledger head,
`valid_until` = head + 120960, and the resource fees differ):

```
policywright install — DRY RUN (nothing submitted)
account      : CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT
admin rule   : 0 (Delegated(GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W))
signing mode : local-fallback — local signer from .env (fallback): the .env key acts as the Delegated(G) rule signer and transaction source; a wallet would sign this same transaction via signTransaction, but no SEP-43 wallet can sign an OZ External digest (FACTS §8.4), and the wallets-kit page is the cohort-wallet track (open)
ledger head  : 4467898
rules        : 3

→ pw:claim  CallContract(CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW)  valid_until 4588858 (head+lifetime)  policies: custom:FrequencyLimitPolicy@CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP
  ✓ simulation passed (enforcing, 2 auth entries, min resource fee 118420); not submitted
→ pw:swap  CallContract(CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD)  valid_until 4588858 (head+lifetime)  policies: custom:FrequencyLimitPolicy@CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP
  ✓ simulation passed (enforcing, 2 auth entries, min resource fee 118421); not submitted
→ pw:xfer:BLND  CallContract(CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF)  valid_until 4588858 (head+lifetime)  policies: stock:spending_limit@CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E
  ✓ simulation passed (enforcing, 2 auth entries, min resource fee 180149); not submitted

install log written to examples/live/testnet/install-dry-run-20260902T153120Z.json
```

The install (real, 2026-09-02 15:34 UTC — the committed
[install-20260902T153356Z.json](../examples/live/testnet/install-20260902T153356Z.json);
on camera the head, `valid_until`, rule ids (the next free ids), transaction
hashes and digests differ):

```
policywright install — TESTNET
account      : CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT
admin rule   : 0 (Delegated(GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W))
signing mode : local-fallback — local signer from .env (fallback): …
ledger head  : 4467930
rules        : 3

→ pw:claim  CallContract(CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW)  valid_until 4588890 (head+lifetime)  policies: custom:FrequencyLimitPolicy@CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP
  ✓ installed as rule id 4 — tx 6fee5fc8ab46cd221c6b807ee22c12e216d1d072e2179b4f6964c6c646e22ed6 (ledger 4467932); auth entries 2, digest d342e3c2f2991890…
→ pw:swap  CallContract(CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD)  valid_until 4588890 (head+lifetime)  policies: custom:FrequencyLimitPolicy@CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP
  ✓ installed as rule id 5 — tx 7763c0f6a30a3e9a24944d685b5faaab2b4360e5b1a136f2f0386b5d2bb9007a (ledger 4467933); auth entries 2, digest e62389cf2bd787f8…
→ pw:xfer:BLND  CallContract(CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF)  valid_until 4588890 (head+lifetime)  policies: stock:spending_limit@CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E
  ✓ installed as rule id 6 — tx cdb5266d038768a7a7bf9e3130e5c6efdcdaf04a3e1a574e6d13e34eb459893d (ledger 4467934); auth entries 2, digest ffc5c650df02c18d…

install log written to examples/live/testnet/install-20260902T153356Z.json
```

Point at `signing mode : local-fallback` — the client-side signing moment —
and at `auth entries 2` on each line: the account's `AuthPayload` entry and
the hand-built `Delegated(G)` nested entry. Say: "A wallet would sign this
same transaction; that page is the open cohort-wallet track, and it replaces
only the signing surface."

## Beat 5 — verify green, and the rule on the explorer (3:55–4:50)

**[SAY]** "Read-only verify: every rule, signer, policy address, install
parameter and `valid_until` is read back from chain and diffed against the
artifact — fifteen for fifteen, through the install log that names this
install. Then the transactions and the account on the explorer."

**[DO]** (use the log file the previous step printed):

```bash
npm run --silent cli -- verify --artifact out/grant-blend-swap/context-rule.json \
  --account CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT \
  --install-log examples/live/testnet/install-<stamp>.json
```

Browser: the three `✓ installed` transaction links, e.g.
<https://stellar.expert/explorer/testnet/tx/6fee5fc8ab46cd221c6b807ee22c12e216d1d072e2179b4f6964c6c646e22ed6>
(the invocation `add_context_rule` on the account, with the Delegated
signer's nested `__check_auth` in the authorization tree), then the account
<https://stellar.expert/explorer/testnet/contract/CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT>
and the two policy contracts it binds:
<https://stellar.expert/explorer/testnet/contract/CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP>
(generated `FrequencyLimitPolicy`, wasm `42227f2b…` = the reproducible
build) and
<https://stellar.expert/explorer/testnet/contract/CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E>
(OpenZeppelin's stock `spending_limit`).

**[EXPECT]** (real, read at ledger 4467941 — the committed
[verify-demo-20260902T153356Z.md](../examples/live/testnet/verify-demo-20260902T153356Z.md);
on camera the rule ids, `valid_until` and the informational list differ):

```
# policywright verify — PASS

Account: CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT (testnet); read at ledger 4467941.

| Rule | Field | Expected (artifact) | Actual (on-chain) | OK |
| --- | --- | --- | --- | --- |
| pw:claim | rule | CallContract(CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW) "pw:claim" | installed as rule id 4 | ✅ |
| pw:claim | signers | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | ✅ |
| pw:claim | policies | CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP | CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP | ✅ |
| pw:claim | custom:FrequencyLimitPolicy params | {"window_secs":86400,"max_calls":5} | {"window_secs":"86400","max_calls":5} | ✅ |
| pw:claim | valid_until | 4588890 (install log) | 4588890 | ✅ |
| pw:swap | rule | CallContract(CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD) "pw:swap" | installed as rule id 5 | ✅ |
| pw:swap | signers | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | ✅ |
| pw:swap | policies | CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP | CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP | ✅ |
| pw:swap | custom:FrequencyLimitPolicy params | {"window_secs":86400,"max_calls":5} | {"window_secs":"86400","max_calls":5} | ✅ |
| pw:swap | valid_until | 4588890 (install log) | 4588890 | ✅ |
| pw:xfer:BLND | rule | CallContract(CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF) "pw:xfer:BLND" | installed as rule id 6 | ✅ |
| pw:xfer:BLND | signers | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | ✅ |
| pw:xfer:BLND | policies | CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E | CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E | ✅ |
| pw:xfer:BLND | stock:spending_limit params | {"spending_limit":"23533505","period_ledgers":120960} | {"spending_limit":"23533505","period_ledgers":120960} | ✅ |
| pw:xfer:BLND | valid_until | 4588890 (install log) | 4588890 | ✅ |

Installed rules not described by the artifact (informational):
- id 0: Default "multisig", 1 signer(s), 0 policies, valid_until None
- id 1: CallContract(CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW) "pw:claim", 1 signer(s), 1 policy, valid_until 4983015
- id 2: CallContract(CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD) "pw:swap", 1 signer(s), 1 policy, valid_until 4983015
- id 3: CallContract(CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF) "pw:xfer:BLND", 1 signer(s), 1 policy, valid_until 4983015
```

Close: "Five approved Tranche 2 deliverables, each with its evidence in
`evidence/EVIDENCE.md`. Testnet-only and unaudited until the Tranche 3
Audit Bank audit. The wallet signing page — the same transaction signed by
Freighter instead of the local key — is the open cohort-wallet track."

---

## Recording notes

- Terminal font ≥ 16 pt, dark theme, 1080p or higher; Claude Code and the
  terminal side by side for Beats 1–2.
- Clean shell: the `.env` is sourced only inside `scripts/install-testnet.sh`;
  never run `env`, `cat .env`, or `stellar keys secret` on camera.
- Do not say "CI runs on push": this repository is a fork and every green run
  is a manual dispatch, as the README discloses.
- One full dry run of all five beats before recording (it appends three more
  rule ids to the account; that is fine — Beat 5 selects the install by its
  log). Single take preferred.
- The D2.5 rules (ids 1–3) and the restored policy entries expire around
  2026-10-02; re-run `scripts/restore-testnet.sh` before a later recording if
  they have lapsed. The RPC keeps the install transactions ~7 days: link the
  ones from the recording itself.
- Upload public (YouTube or Loom); open the link in an incognito window
  before pasting it into the form.
