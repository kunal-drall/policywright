---
name: policywright-grant
description: Turn a Soroban transaction the user already performed into a reviewed least-privilege OpenZeppelin smart-account policy with the policywright MCP tools — record the hashes, synthesize the rule, ask the clarification questions (spend cap, lifetime, route constraint, signer and policy addresses), re-synthesize with the answers, dry-run it, and hand over the reviewable artifacts. Use when the user says "grant permission to do X from this transaction", pastes Stellar/Soroban transaction hashes to delegate a flow, or asks to limit what a key or agent may do on a smart account. Never installs, deploys, signs, or submits anything.
license: MIT
compatibility: Requires the policywright MCP server registered as "policywright" (the repository's .mcp.json after npm ci) and Soroban RPC access for record and verify. Testnet only.
metadata:
  project: policywright
  deliverable: D2.2
  server: policywright
allowed-tools: mcp__policywright__record mcp__policywright__synthesize mcp__policywright__simulate mcp__policywright__verify
---

# policywright-grant — "grant permission to do X from this transaction"

You turn something the user **already did** on Stellar (one or more Soroban
transactions) into the **least-privilege authorization** that permits exactly
that flow, review it with the user, dry-run it, and hand over the artifacts a
human installs. You use exactly four tools, in this order:

1. `mcp__policywright__record` — hashes → a recording
2. `mcp__policywright__synthesize` — recording → the rule, caps, notes, artifacts
3. `mcp__policywright__simulate` — recording + the same config → permit/deny/flag table
4. `mcp__policywright__verify` — only after the human has installed, on request

## Hard rules (read first)

- **Never install, deploy, sign, or submit.** There is no such tool and you
  must not look for one, run a CLI install, or ask for a key. When the user
  asks you to install, hand them the human step (see _Hand-over_) and stop.
- **Always dry-run before calling anything "reviewed".** A policy is
  reviewed only after `simulate` ran on the same recording and config and
  you showed its table with `deviations: 0`.
- **Always show the banner with generated code.** Whenever you mention or
  show `rustPolicy` / `FrequencyLimitPolicy.rs`, quote `unauditedBanner`
  verbatim:
  _Generated contracts are illustrative and unaudited — not for production deployment until the Audit Bank audit._
- **Never invent a hash, address, amount, or window.** Every number and
  identifier you say comes from a tool output or from the user's message.
  If you do not have it, ask.
- **Ask, do not assume**, on every clarification trigger below. The
  synthesizer's defaults are a starting point for the questions, not the
  answer.
- **Surface every `warnings`, `notes` and `scopeNotes` entry** that changes
  what the policy permits or can enforce, in the user's words, before asking
  for a decision.
- **Testnet only.** If the user names mainnet, stop and say this toolkit is
  testnet-only until the audit.

## Step 0 — preconditions

Check the four tools exist. If they do not, tell the user: from the
repository root run `npm ci`, then `claude mcp list` should show
`policywright … ✓ Connected` (the project's `.mcp.json`); restart the session.
Do not try to start the server yourself.

## Step 1 — gather what you need

From the user's message collect:

- **Transaction hashes** — 64 hex characters each. A multi-step flow (claim,
  then swap) is **several** hashes; pass all of them. If the user gives a
  saved recording path instead (a `.json` written by `record` or
  `npm run record`), skip Step 2 and use `recordingPath`.
- **The account** the delegation is for — a `G…` public key or the smart
  account's `C…` address. Ask for it if missing: without it the recorder
  assumes the first transaction's source account and says so in `warnings`.
- **What they mean by X** — in their own words; you will map it to the
  observed calls and flows, never the other way round.

## Step 2 — record

Call `mcp__policywright__record` with `{ "hashes": [...], "account": "…" }`.

- On success, restate what was observed from `summary`: each call
  (`fnName` on which contract) and each token flow (`amountFormatted`,
  `symbol`, `direction`). Relay `warnings` verbatim.
- If `warnings` says the subject was assumed → **trigger T6**, ask.
- On `TX_NOT_FOUND`: public nodes retain about seven days of history. Say
  that, and ask for either transactions from the last week or a saved
  recording (`recordingPath`). Do not guess or retry other hashes.
- On any other error, relay `error.code` and `error.message` and stop.

## Step 3 — first synthesis (defaults) and the plain-language rule

Call `mcp__policywright__synthesize` with just the recording
(`recording` = the `recording` field of the record result, or
`recordingPath`). Then present the rule in plain language, in this order:

1. **Scope** — the contracts and functions it permits, from
   `spec.contextRule.scopedCalls` and the `Rule …` lines of `scopeNotes`
   (one OpenZeppelin rule per contract; a token rule with a spending limit is
   part of the surface).
2. **Caps** — every asset line of `scopeNotes`: what is capped at how much per
   what window, and which assets are uncapped because they only flowed in.
3. **Frequency and lifetime** — from `config` and the `Lifetime:` line.
4. **Argument constraints** — the `Argument scope` line: advisory (flag) or
   enforced (deny), and that it is offline-only.
5. **What the stock policies cannot express** — every `notes` entry starting
   with `DELTA:`, and every `warnings` entry.
6. **Installable as-is?** — `installable.asIs`; if false, the reasons from
   `installable.violations` (typically: no signer, no deployed policy
   addresses).

Keep it to the user's vocabulary ("claim on the Blend pool", "swap on the
Soroswap router"); put addresses in backticks once.

## Step 4 — ask the clarification questions

Ask in **one** message, numbered, using the exact numbers from the outputs.
Wait for the answers. The triggers (details and question templates in
[references/clarifications.md](references/clarifications.md)):

| Trigger                                     | When                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **T1 cap**                                  | always, per asset that flowed out: exact amount, default headroom, or another ceiling/window |
| **T2 lifetime**                             | always                                                                                      |
| **T3 multi-asset**                          | more than one asset flowed out                                                              |
| **T4 argument constraint**                  | `spec.argumentScopes` is non-empty: deny other routes, or allow-and-flag                    |
| **T5 scope-changing warning / not installable** | any `warnings` entry, any `DELTA:` note, or `installable.asIs: false`                   |
| **T6 assumed subject**                      | `record.warnings` mentions "no --account given"                                             |

If the user answers only some, ask again for the rest. Never fill a gap with
a default silently; if they say "use the defaults", say which values those
are and proceed.

## Step 5 — map answers and re-synthesize

| Answer                                   | Input                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| exact observed amount                    | `config.capMultiplier: 1`                                                                              |
| default headroom                         | omit (`1.1`)                                                                                           |
| "up to N per week"                       | `config.spendWindowSecs: 604800` and `capMultiplier` = N ÷ observed gross outflow (say the multiplier) |
| lifetime                                 | `config.lifetimeSecs` (days × 86400)                                                                   |
| deny other routes / allow-and-flag       | `config.constrainArguments: true` / `false`                                                            |
| signer `G…`/`C…`                         | `installTargets.signers: [{ "type": "Delegated", "address": "…" }]`                                    |
| deployed policy addresses                | `installTargets.policyAddresses` (`custom:FrequencyLimitPolicy`, `stock:spending_limit`)              |
| "write the files to <dir>"               | `outDir` (+ `overwrite: true` only if they said to replace)                                            |

Call `mcp__policywright__synthesize` again with the **same recording** and
these inputs. Restate the rule with the chosen numbers (Step 3 format) and
confirm `installable.asIs`. If it is still false, say exactly what is missing.

## Step 6 — dry run

Call `mcp__policywright__simulate` with the same recording and the **same
`config`**. Show the table (`results`: label, decision, reason) and say:

- `deviations` must be `0` — if not, stop and report it as a defect.
- what each **deny** protects against, in one line each;
- a **flag** means "permitted, with a scope gap" — offer
  `constrainArguments: true` if they want it denied;
- any `warnings` (a candidate whose constraint was not evaluated).

Only now may you call the policy reviewed.

## Step 7 — hand-over

Give the user:

- the artifacts: `contextRule` (what gets installed), `summary`, `spec`,
  and the generated Rust **with the banner**; if `outDir` was used, the
  `files` paths;
- the one human step, verbatim:
  `npm run cli -- install --artifact <context-rule.json> --account <C…> --dry-run`
  then the same without `--dry-run` (testnet; the CLI signs with the
  operator's own key — you never touch it);
- the offer to `verify` afterwards.

## Step 8 — verify (only after the human installed, only if asked)

Call `mcp__policywright__verify` with the artifact (`artifact` or
`artifactPath`), the smart account `C…`, and the install log if they have it
(`installLogPath`). Report `pass`, the failing rows if any, and `extraRules`
(usually the account's admin rule — informational).

## Errors

| `error.code`    | What to do                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `TX_NOT_FOUND`  | retention window — ask for recent hashes or a saved recording                                       |
| `BAD_INPUT`     | relay the message; fix the input with the user (never by guessing)                                  |
| `NETWORK`       | the RPC endpoint could not be reached — say so; do not retry more than once                         |
| `DECODE_FAILED` | relay `error.section` and the message; stop — this needs a developer                                |
| `SHAPE_INVALID` | the document given to `verify` is not a context-rule artifact — use `synthesize`'s `contextRule`     |
| `INTERNAL`      | relay the message and stop                                                                          |

A plain-text error starting `Input validation error:` means the input broke
the tool's schema — fix the field it names (`references/tool-io.md`).

## References

- [references/clarifications.md](references/clarifications.md) — the trigger
  list, question templates, answer → input mapping.
- [references/tool-io.md](references/tool-io.md) — every tool's input fields
  and the output fields you present, plus the CLI-flag mapping.
