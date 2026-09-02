# Skill demo script — "grant permission to do X from this transaction"

The exact demo conversation for D2.2 — _"Skill packaged; a demo shows 'grant
permission to do X from this transaction' producing a reviewed policy."_ It
runs the project skill `policywright-grant`
([.claude/skills/policywright-grant/SKILL.md](../.claude/skills/policywright-grant/SKILL.md))
over the policywright MCP server on the real recorded claim→swap sequence.

Every **Expected tool call** block below is validated against the tool's
committed input schema, and the whole sequence is executed against the real
server (with a stub RPC replaying the committed captures) by
[test/skill.test.ts](../test/skill.test.ts) — so the machine walkthrough is
green before a human records it. The human recording is the criterion's
"demo shows" clause and the BLOCKER in
[EVIDENCE.md § D2.2](../evidence/EVIDENCE.md).

## 1. Clarification triggers (written before the skill was authored)

The skill must **ask**, never assume, whenever one of these holds. Each
question is phrased with the numbers from the tool outputs — the skill never
invents an amount, hash, or address.

| #   | Trigger                                                                                                                                                                                                              | The question the skill asks                                                                                                                                                                                                                                                                                                              | What the answer changes                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Ambiguous cap** — always, for every asset that flowed out (the funded plan's own example: "this transferred 50 USDC — cap at 50, or allow up to 100 over a week?")                                                 | "The recording moved **2.1394095 BLND** out. The default cap is that amount plus 10 % headroom (**2.3533505 BLND per 24 h**). Do you want (a) exactly the observed amount, (b) the default headroom, or (c) a different ceiling and window — e.g. up to 10 BLND per week?"                                                               | `config.capMultiplier`, `config.spendWindowSecs` — the cap is always observed gross outflow × multiplier; a larger ceiling is expressed as a multiplier over a longer window                        |
| T2  | **Ambiguous lifetime** — always                                                                                                                                                                                      | "How long should this permission last? The default is **30 days** (2 592 000 s ≈ 518 400 ledgers). Shorter is safer; it can be re-granted."                                                                                                                                                                                              | `config.lifetimeSecs`                                                                                                                                                                               |
| T3  | **Multi-asset outflows** — whenever `record.summary.flows` has more than one asset with `direction: "out"`                                                                                                           | "This flow moved out **two assets** (X and Y). Each gets its own cap; do you want the same headroom for both, or different ceilings per asset? Note: policywright emits one cap per asset from the observed outflow — it cannot cap one asset in terms of another."                                                                      | Whether to run one synthesis or to ask the user to split the delegation; per-asset ceilings are still expressed through the single `capMultiplier`, so differing ceilings mean separate delegations |
| T4  | **Argument constraint on/off** — whenever `synthesize.spec.argumentScopes` is non-empty (a swap-path token set was derived)                                                                                          | "The swap was routed **BLND → USDC**. Should a swap through any other token be **denied** (enforce the observed route) or **allowed but flagged** (the default)? Either way this is enforced offline by the dry run only, not on-chain yet."                                                                                             | `config.constrainArguments`                                                                                                                                                                         |
| T5  | **A synthesize warning or note that changes scope** — any entry in `synthesize.warnings` (e.g. more than 5 policies), a `DELTA:` note (a constraint the stock policies cannot express), or `installable.asIs: false` | Relay the warning verbatim and ask: "This changes what the policy can enforce on-chain: ⟨warning⟩. Do you accept that, narrow the delegation, or stop here?" For `installable.asIs: false`: "To install as-is I need the signer address and the deployed policy addresses; without them this stays a design document. Do you have them?" | Whether to proceed, `installTargets`, or ending with a design artifact                                                                                                                              |
| T6  | **Subject ambiguity** — `record.warnings` contains "no --account given" (the recorder assumed the first transaction's source account)                                                                                | "Movements were attributed to ⟨address⟩ by assumption. Is that the account this delegation is for, or is the real actor a smart account (C…)?"                                                                                                                                                                                           | Re-record with `account`                                                                                                                                                                            |

T1, T2 and T4 fire on the demo recording; T3, T5 (`installable.asIs: false`
until targets are given) and T6 are covered by the skill and tested in the
walkthrough where the data triggers them.

## 2. Before you start

```bash
git clone https://github.com/kunal-drall/policywright && cd policywright
npm ci && npm test        # green; includes the MCP stdio suite and the skill walkthrough
claude mcp list           # policywright … ✓ Connected (from the committed .mcp.json)
claude                    # in the repository root; the project skill loads from .claude/skills/
```

No secret is needed. Nothing in this demo installs, signs, or submits.

## 3. The conversation

### Turn 1 — the ask

> **You:** Grant permission to claim my Blend yield and swap it to USDC.
> Here are the transactions:
> `9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6` and
> `ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46`.
> My account is `GBMWJIADBWN6FJUQPSVKWZE7ZFEPHEN2YBINQ7UVPHJ2WJW2SWI6WD4Q`.

The skill activates (the phrase "grant permission … here are the
transactions" is its trigger) and records the flow.

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

Expected result in the walkthrough test (captures replayed): `ok: true`,
calls `claim` on `CAPBMXIQ…` (Blend pool) and `swap_exact_tokens_for_tokens`
on `CCJUD55A…` (Soroswap router); flows BLND in 2.1394095, BLND out
2.1394095, USDC in 1.0516011; no warnings.

**Live today** these hashes are older than the public node's ~7-day
retention window, so the real result is the error envelope
`{ ok: false, error: { code: "TX_NOT_FOUND" } }`. The skill must then say so
and ask for either fresh hashes or a saved recording — answer:

> **You:** Use the saved recording at
> `examples/live/recorded-claim-swap-fresh.json`.

(and every later turn passes `recordingPath` instead of the inline
recording — the walkthrough uses `recordingPath` throughout, so the two
branches converge here).

### Turn 2 — first synthesis and the plain-language rule

The skill synthesizes with defaults to have real numbers to ask about.

Expected tool call — `mcp__policywright__synthesize`:

```json
{ "recordingPath": "examples/live/recorded-claim-swap-fresh.json" }
```

Expected result: `installable.asIs: false` (no signer / policy addresses
yet), three rules `pw:claim`, `pw:swap`, `pw:xfer:BLND`, `scopeNotes` with the
BLND cap (2.3533505 per 86400 s), USDC uncapped, the advisory swap-path
scope, lifetime 2 592 000 s; `notes` with the `DELTA:` entry;
`unauditedBanner` present.

The skill presents the rule in plain language — scope, caps, lifetime,
warnings — then asks the clarification questions **T1, T2, T4** and, because
`installable.asIs` is false, **T5**:

> **Skill:** Here is what the recording permits… (scope: `claim` on the Blend
> pool, `swap_exact_tokens_for_tokens` on the Soroswap router; BLND out capped
> at 2.3533505 per day; USDC only came in, so no cap; at most 5 calls per day;
> lifetime 30 days; the observed route BLND→USDC is advisory). Before I
> finalise: (T1) cap BLND at exactly 2.1394095, keep the 10 % headroom, or a
> different ceiling/window? (T2) lifetime 30 days, or shorter? (T4) deny swaps
> through other tokens, or allow-and-flag? (T5) to install as-is I need the
> signer and the deployed policy addresses — do you have them?

### Turn 3 — the answers and the re-synthesis

> **You:** Keep the 10 % headroom but over a week, lifetime 7 days, deny other
> routes. Signer `GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W`;
> the frequency policy is at
> `CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP` and the spending
> limit at `CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E`. Write
> the files to `out/grant-blend-swap`.

Expected tool call — `mcp__policywright__synthesize`:

```json
{
  "recordingPath": "examples/live/recorded-claim-swap-fresh.json",
  "config": {
    "capMultiplier": 1.1,
    "spendWindowSecs": 604800,
    "lifetimeSecs": 604800,
    "constrainArguments": true
  },
  "installTargets": {
    "signers": [
      { "type": "Delegated", "address": "GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W" }
    ],
    "policyAddresses": {
      "custom:FrequencyLimitPolicy": "CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP",
      "stock:spending_limit": "CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E"
    }
  },
  "outDir": "out/grant-blend-swap",
  "overwrite": true
}
```

Expected result: `installable.asIs: true`; `config.constrainArguments: true`,
`config.spendWindowSecs: 604800`, `config.lifetimeSecs: 604800`;
`contextRule.contextRules[*].lifetimeLedgers: 120960`; the BLND binding's
`period_ledgers: 120960`; `scopeNotes` say `ENFORCED`; four files under
`out/grant-blend-swap/`. The skill restates the rule with the chosen numbers
and shows the banner with the generated policy.

### Turn 4 — the dry run

The skill always dry-runs before calling the policy reviewed.

Expected tool call — `mcp__policywright__simulate`:

```json
{
  "recordingPath": "examples/live/recorded-claim-swap-fresh.json",
  "config": {
    "capMultiplier": 1.1,
    "spendWindowSecs": 604800,
    "lifetimeSecs": 604800,
    "constrainArguments": true
  }
}
```

Expected result: `deviations: 0`, `counts: { permit: 1, deny: 5, flag: 0 }`
— the recorded flow permitted; over the cap, an unseen function, after
expiry, over the frequency limit, and the BLND→XLM route all denied (the
route because T4 chose enforcement). The skill shows the table and explains
each row.

### Turn 5 — hand-over (no tool call)

> **Skill:** The reviewed policy is in `out/grant-blend-swap/`:
> `context-rule.json` (what gets installed — three rules, real OpenZeppelin
> install params, your signer and the deployed policy addresses),
> `summary.txt`, `spec.json`, and `FrequencyLimitPolicy.rs` —
> _Generated contracts are illustrative and unaudited — not for production deployment until the Audit Bank audit._
> I cannot install it; you do, explicitly:
> `npm run cli -- install --artifact out/grant-blend-swap/context-rule.json --account <your C…> --dry-run`
> then without `--dry-run`. Afterwards I can verify what is on-chain against
> this artifact.

### Turn 6 (optional) — the deploy-second boundary

> **You:** Just install it.

Expected: **no tool call**; the skill repeats the human step. Any attempt
to install, sign, or submit is a finding.

## 4. Recording it

The tool calls of Turns 2–4 were made from Claude Code 2.0.76 on 2026-09-02
and returned exactly the expected results (quoted in
[demo-script-t2.md](demo-script-t2.md), Beat 2; the same artifact was then
installed into the testnet account as rule ids 4–6 and verified). What the
criterion still needs is the saved transcript of a human-run conversation.

Run the turns in one Claude Code session from the repository root, save the
unedited transcript as `evidence/sessions/skill-demo-<YYYY-MM-DD>.md` (or a
screen recording), note the Claude Code version and date, and link it from
[EVIDENCE.md § D2.2](../evidence/EVIDENCE.md).
