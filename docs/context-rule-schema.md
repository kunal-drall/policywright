# The `context-rule.json` schema

`context-rule.json` is the installable half of policywright's output: the
OpenZeppelin smart-account context rules (plus per-rule policy install
parameters) that authorize exactly the recorded flow. It is emitted by
`npm run demo` (to `out/`), by `npm run cli -- synth` (`--out <dir>` writes
it), and is committed for the real recorded sequences under
[`examples/live/`](../examples/live/).

Everything in the file targets a **pinned OZ release** and uses that release's
**real parameter names and units** — verified against source, never assumed
(see [FACTS.md](FACTS.md) §2.4–2.5, §8.2). JSON has no comments, so every
policy binding carries its OZ file:line citation in a `paramsSource` field.
The installer ([src/install.ts](../src/install.ts)) consumes the document
through [src/install-shape.ts](../src/install-shape.ts) and nothing else: it
validates every field against the checks the contracts perform and encodes
the values mechanically. A document that fails validation is not installed.

## Versioning

| Field           | Meaning                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `schemaVersion` | Integer, currently **2**. Bumped on any change to the emitted shape; this file documents it. |

Consumers must reject documents whose `schemaVersion` they do not know.

**v1 → v2 (2026-09-02, D2.5; RECONCILIATION-T2 emitter fixes E1–E5).**
v1 derived `validUntilLedger` from the _recording_ ledger (already in the past
at install), emitted `signers: []` with a note asking the installer to "attach
signers", left every policy `address` null, and described policy instances
misleadingly. v2 emits a relative `lifetimeLedgers`, takes signers and policy
addresses as **inputs** (`installTargets`), and emits an absolute
`validUntilLedger` only from a supplied live ledger head. A v2 document with
`installTargets` filled in installs as-is; one without is a design artifact and
the installer says so.

## Version 2 — top level

| Field             | Type   | Meaning                                                                                                                                                                                                                                                                                |
| ----------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`   | int    | `2`.                                                                                                                                                                                                                                                                                   |
| `generatedBy`     | string | `"policywright"`.                                                                                                                                                                                                                                                                      |
| `target`          | object | The OZ release the shapes are verified against: `package`, `version` (`v0.7.2`), `commit`, and `installEntryPoint` (the `add_context_rule` signature + file:line).                                                                                                                     |
| `source`          | object | Provenance of the recording: `network`, `recordedFrom` (`fixture \| rpc \| simulation`), `subject`, `ledger`, `sourceHashes` (every tx hash in the merged sequence).                                                                                                                   |
| `ledgerTimeBasis` | object | `estimatedSecsPerLedger` (5) and a note: every ledger-denominated value below was converted from configured seconds at this estimated rate.                                                                                                                                            |
| `installTargets`  | object | The deploy-time facts the rules were emitted with (echoed for reproducibility): `signers` (array of signers, see below), `policyAddresses` (binding kind → deployed `C…` address), `ledgerHead` (int or null). Supplied on the CLI as `--signer`, `--policy-address`, `--ledger-head`. |
| `contextRules`    | array  | The installable rules — see below.                                                                                                                                                                                                                                                     |
| `notes`           | array  | **Composition deltas**: unit conversions performed, constraints the stock policies cannot express, and install-time obligations. Read these before installing.                                                                                                                         |
| `config`          | object | The `SynthConfig` the spec was synthesized with (reproducibility).                                                                                                                                                                                                                     |

## Version 2 — one context rule

Each entry maps 1:1 onto the arguments of
`SmartAccount::add_context_rule(context_type, name, valid_until, signers, policies)`
(`packages/accounts/src/smart_account/mod.rs:238-248` at the `target` commit):

| Field              | Type        | Maps to                    | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contextType`      | object      | `context_type`             | Always `{ "type": "CallContract", "contract": "C..." }` — one rule binds exactly one contract; `Default` is never emitted (it would authorize everything). Encoded as the tuple-variant enum `Vec[Symbol("CallContract"), Address]`.                                                                                                                                                             |
| `name`             | string      | `name`                     | ≤ 20 **bytes** (OZ `MAX_NAME_SIZE`, `mod.rs:522-530`).                                                                                                                                                                                                                                                                                                                                           |
| `lifetimeLedgers`  | int         | _(input to)_ `valid_until` | **v2.** The configured lifetime in ledgers (`lifetimeSecs` at ~5 s/ledger). The installer computes `valid_until = ledger head at install + lifetimeLedgers` when `validUntilLedger` is null.                                                                                                                                                                                                     |
| `validUntilLedger` | int \| null | `valid_until`              | A **ledger sequence**, not a Unix time (`storage.rs:282`). **v2:** absolute only when synthesis was given a live ledger head (`installTargets.ledgerHead + lifetimeLedgers`); otherwise `null`. Never derived from the recording ledger — that value would already be past (`PastValidUntil` 3005).                                                                                              |
| `signers`          | array       | `signers`                  | **v2:** the rule's signers in the real `Signer` shape (`storage.rs:96-102`): `{ "type": "Delegated", "address": "G…\|C…" }` or `{ "type": "External", "verifier": "C…", "keyData": "<hex>" }`. OZ requires ≥ 1 signer or policy per rule and ≤ 15 signers; the stock `spending_limit` rejects when no signers authenticated, so a signer-less `spending_limit` rule is refused by the installer. |
| `observedFns`      | array       | _(nothing)_                | Advisory. Rules cannot carry function names (matching is contract-level); function-level narrowing must live in a policy (Tranche 2 codegen).                                                                                                                                                                                                                                                    |
| `policies`         | array       | `policies` map             | One entry per policy to attach (≤ 5) — see below. Install order is the map's **key (address) order**, not this array's order.                                                                                                                                                                                                                                                                    |

## Version 2 — one policy binding

`add_context_rule` takes policies as `Map<Address, Val>` (policy contract
address → install params). Each binding is emitted as:

| Field           | Type           | Meaning                                                                                                                                                                                                                      |
| --------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy`        | string         | `"stock:spending_limit"` or `"custom:FrequencyLimitPolicy"`.                                                                                                                                                                 |
| `address`       | string \| null | **v2:** the deployed policy contract's `C…` address from `installTargets.policyAddresses`; `null` when none was supplied (then a note says so and the installer refuses). Two bindings on one rule may not share an address. |
| `installParams` | object         | The policy's **real** `AccountParams` field names, exactly as the target contract decodes them; encoded as a sorted `ScMap` keyed by field-name symbols ([FACTS.md §13.1](FACTS.md)).                                        |
| `paramsSource`  | string         | The file:line (at the `target` commit) the param shape was verified against — the "comment" JSON cannot carry.                                                                                                               |
| `derivedFrom`   | object         | (`stock:spending_limit` only) the observed asset, gross outflow, and configured window the params were derived from.                                                                                                         |

The two shapes emitted today:

- **`stock:spending_limit`** — `{ "spending_limit": "<i128 as decimal string>",
"period_ledgers": <u32> }`
  (`packages/accounts/src/policies/spending_limit.rs:88-94`). Bound only to a
  token's `CallContract` rule where the recording's subject authorized a
  direct `transfer` of that token — the only context the stock policy meters;
  anything else panics `NotAllowed` (`spending_limit.rs:222-294`). Amounts are
  decimal strings because JSON numbers cannot carry i128. The deployable form
  of the stock module is OZ's own wrapper contract, vendored at
  [contracts/spending-limit-policy](../contracts/spending-limit-policy).
- **`custom:FrequencyLimitPolicy`** — `{ "window_secs": <u64>, "max_calls":
<u32> }`, matching the generated Rust's `FrequencyLimitParams`
  (contracts/frequency-limit-policy/src/lib.rs, emitted by src/rust-policy.ts —
  the compiled crate's tests exercise exactly this shape). One deployed
  instance serves every rule of every account (state keyed on
  `(smart_account, context_rule_id)`). The generated contract is illustrative
  and unaudited — see the banner it carries.

## Why several rules, and why a token rule

An OZ context rule binds **one** contract, and `__check_auth` receives **one
`Context` per `require_auth` call** in the authorized tree (FACTS §2.5). The
recorded claim+swap flow therefore needs a rule per called contract **and** a
rule for the token whose `transfer` the subject authorized inside the swap —
that token rule is exactly where the stock spending limit attaches and meters
the outflow. Spend caps for assets with **no** subject-authorized direct
transfer cannot fire on-chain via the stock policy; they are recorded as
`DELTA` notes instead of being emitted in a shape the real contract would
reject, and remain enforced in the offline dry run.

## How a rule is installed (v2 → transaction)

One transaction per rule invokes `account.add_context_rule(...)` with the five
arguments above, carrying the account's own authorization entry whose
`signature` is the `AuthPayload { signers, context_rule_ids: [adminRuleId] }`
and, for a `Delegated(G)` admin signer, G's nested `__check_auth(auth_digest)`
entry — see [smart-account-install.md](smart-account-install.md).
