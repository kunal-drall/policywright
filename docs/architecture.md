# Architecture

policywright is a small, single-direction pipeline. Each stage is a pure-ish function over
the types in [`src/types.ts`](../src/types.ts), which is the single source of truth for
every shape in the system.

```
                  ┌──────────────┐
  tx hash ───────▶│ sources/rpc  │─┐
                  └──────────────┘ │   ┌──────────────┐   ┌──────────────┐
                                   ├──▶│ synthesizer  │──▶│   emitter    │
  fixtures/ ──────▶ sources/      ─┘   └──────────────┘   └──────────────┘
                    fixture            SmartAccountSpec      spec.json
                  RecordedTx                 │               context-rule.json
                                             │               summary.txt
                                             │               FrequencyLimitPolicy.rs
                                             ▼
                                       ┌──────────────┐
                                       │  simulate    │──▶ dry-run report
                                       └──────────────┘
```

## Stages

### 1. Recording (`src/sources/`)

Produces a `RecordedTx`: the transaction hash/network, the ordered `ScopedCall`s
(`contract`, `fnName`, decoded `args`), and the `AssetFlow`s (token, direction, amount).

- **`fixture.ts`** loads `fixtures/recorded-tx.json`, a deterministic, offline Blend-claim
  → Soroswap-swap recording. It validates the document defensively and reconstructs
  `bigint` amounts (the JSON stores them as decimal strings, since JSON has no bigint).
  This source drives the demo and the test suite with no network dependency.
- **`rpc.ts`** is the optional live adapter. It fetches one or more transactions from a
  Soroban RPC node by hash and merges them — in ledger-close-time order, each call tagged
  with its `sourceHash` — into a single `RecordedTx` (via the shared decoders in
  `decode.ts`).
- **`simulation.ts`** ingests a saved `simulateTransaction` exchange
  (`record --from-simulation <file>`) into a `RecordedTx` with `source: "simulation"` —
  simulation discovers the authorization tree an unsigned envelope does not carry.
- **`recorded.ts`** re-loads a previously saved recording (`synth --input <file>`).

  The synthesizer also takes deploy-time **install targets** (`--signer`,
  `--policy-address`, `--ledger-head`) so the emitted rules carry real `Signer` shapes,
  deployed policy addresses, and a relative `lifetimeLedgers` (schema v2).

  Decoding assumptions (Soroban protocol 27 / CAP-67, `@stellar/stellar-sdk` 15.1.0 —
  every shape verified against the committed captures, [FACTS.md §3](FACTS.md)):
  - the transaction is a v1 (or fee-bump-wrapping-v1) envelope;
  - contract calls come from `InvokeHostFunction` operations whose host function is
    `InvokeContract` (`InvokeContractArgs` → contract, function, args via `scValToNative`);
  - token movements come from CAP-67/SEP-41 token events — `transfer`, SAC
    `mint`/`burn`/`clawback` — in both coexisting topic shapes (SAC events carry a 4th
    SEP-0011 asset-string topic; plain SEP-41 tokens emit 3 topics) with `i128` or
    CAP-67 muxed-map `data`, attributed to the subject account when it is the `from`
    (out) or `to` (in);
  - the subject account is passed explicitly (`--account <G…|C…>`) — the economic actor
    of a smart-account flow is often a `C…` contract address, not the envelope source;
    without it the first transaction's source account is assumed and a warning records
    the assumption;
  - each token's symbol/decimals are resolved by simulating its SEP-41 `symbol()` /
    `decimals()` getters against the same node, cached per token. A token that is not a
    standard SAC/SEP-41 token (or a node that rejects the simulation) falls back to the
    full contract id with `resolved: false` — never a silent guess.

  Failure modes (not found, failed on-chain, wrong network, no contract calls, malformed
  envelope) return a typed `RecorderError` — `BAD_INPUT` / `TX_NOT_FOUND` / `NETWORK` /
  `DECODE_FAILED` ([src/sources/errors.ts](../src/sources/errors.ts)) — rather than a
  silent empty result.

### 2. Synthesis (`src/synthesizer.ts`)

`synthesize(tx, config, now) → SmartAccountSpec`. The design mirrors OZ's smart-account
model: a **context rule** fixes scope, and a small set of **policies** bound to it enforce
quantitative limits.

- **Scope** — the distinct `(contract, fn)` pairs observed, in first-seen order, plus a
  short derived rule name (OZ caps rule names at 20 **bytes** — multibyte symbols count
  per byte; [FACTS.md §2.3](FACTS.md)).
- **Spending limits** — per asset, sum the **gross outflow** (ignoring inflows) and cap it
  at `gross × capMultiplier` (rounded up so the cap never sits below what was observed).
  - _Gross, not net:_ an asset received then sent within the same flow (BLND: claimed in,
    swapped out) nets to ~zero, but the account still moved the gross amount out, so that
    is what is capped.
  - _Inflow-only assets get no cap_ — the USDC received from the swap moves nothing out, so
    no spending policy is emitted for it. This is the minimal-permission case.
- **Frequency** — one frequency-limit policy is always emitted from config.
- **Argument scope** — the exported `ARGUMENT_DERIVATION_RULES` table (one rule today,
  `swap-path`: the first contract-address vector of any `*swap*` call, i.e. the Soroswap
  `path`) is applied to every observed call; each match records the **set** of token
  addresses observed there as an `argumentScopes` entry tagged with its rule. When
  `config.constrainArguments` is enabled the entries are also added to `policies` (and thus
  enforced as denials); otherwise they are advisory and the simulator flags violations as
  permitted-with-a-scope-gap. Set semantics only — not ordering, hop count, or amounts
  (limits in the README).
- **Policy budget** — OZ allows at most `MAX_POLICIES` (5) policies per context rule;
  exceeding that adds a warning to the spec rather than failing.

`SynthConfig` is validated up front and echoed into the spec for reproducibility. All of
the above knobs are exposed as CLI flags on `synth`/`simulate`.

### 3. Emission (`src/emitter.ts`, `src/rust-policy.ts`)

Renders the spec four ways:

- **`spec.json`** — bigint-safe JSON (amounts as decimal strings).
- **`context-rule.json`** — installable OZ context rules + policy install params
  ([schema](context-rule-schema.md)).
- **`summary.txt`** — a human-readable rundown of the observed flow, the context rule, the
  policies (with amounts formatted by token decimals), and any warnings.
- **`FrequencyLimitPolicy.rs`** — the custom policy in Rust, implementing OZ's real
  `Policy` trait (associated `AccountParams`; `install` / `enforce` / `uninstall`;
  `enforce` rejects by panicking — there is no `can_enforce` hook). At the default
  config the emitted source is byte-identical to the compiled-and-tested crate at
  [contracts/frequency-limit-policy](../contracts/frequency-limit-policy) (equality locked
  by [test/rust-policy.test.ts](../test/rust-policy.test.ts); non-default
  `--frequency-window`/`--frequency-max` values are substituted into the template). Every
  generated Rust file is stamped **ILLUSTRATIVE / UNAUDITED — NOT DEPLOY-READY**; the
  summary carries the same note.

### 3b. Install and verify (`src/install-shape.ts`, `src/install.ts`, `src/verify.ts`)

The deploy-second half, reachable only from the CLI (never from the MCP server).
`install-shape.ts` validates an emitted `context-rule.json` (schema v2) field-by-field
against the checks the OZ contracts perform and encodes install params as the sorted
`ScMap` they decode; `install.ts` maps each rule to `add_context_rule` arguments, builds the
account's `AuthPayload` entry and the `Delegated(G)` signer's nested `__check_auth` entry,
simulates in enforcing mode, signs through a labelled `SigningSurface` (local `.env` key
fallback today; a wallet signs the same transaction), and submits; `verify.ts` reads the
account's rules and policy params back through simulated getters and diffs them (pure
`diffRules`, thin RPC layer). Details: [smart-account-install.md](smart-account-install.md).

### 4. Simulation (`src/simulate.ts`)

`simulateCall(spec, candidate) → SimulationResult`. Checks run in a fixed order; the first
failure decides the outcome:

1. **scope** — is the `(contract, fn)` pair authorised? (deny: unseen function)
2. **lifetime** — is the call within the rule's validity window? (deny: expired)
3. **argument-constraint** (enforced) — does the swap route through an unobserved token?
   (deny — only when `constrainArguments` is enabled; the reason names the rule, call,
   argument index, allow-set, and offending token)
4. **spending-limit** — does any outflow exceed its asset's cap? (deny: over-cap)
5. **frequency-limit** — would this call exceed the rolling call cap? (deny: too frequent)
6. **argument-constraint** (advisory) — when not enforced, an unobserved route is **flagged**:
   the call is permitted by every enforced check, and the report says so and how to close
   the gap.

If every check passes the call is permitted. `buildScenarios` derives the standard
permit/deny/flag set generically from a spec: the recorded replay, one deny per enforced
check, and — when an argument constraint was derived — the REAL observed swap re-routed
through a **probe token**: the recording network's native XLM Stellar Asset Contract
(address derived from the network passphrase in `src/network.ts`; `--probe-token` to
override; a synthetic placeholder only if XLM itself was observed). `renderReport` formats
results as Markdown with a provenance header (recording, generated policy set — each policy
annotated with its realisation: composed stock binding, generated contract, or offline-only
— mode, decision legend), an **Enforced by** column attributing each decision to the
artifact that realises the deciding check, and a token legend, so a committed report is
self-describing. The realisation itself comes from `realisePolicies` in the synthesizer
([compose vs. generate](compose-vs-generate.md)).

### 5. Agent surface (`src/mcp/`)

The same pipeline, exposed to an agent over the Model Context Protocol (stdio) as exactly four
tools — `record`, `synthesize`, `simulate`, `verify` — that wrap the library entry points above
and nothing else (`src/mcp/tools.ts`; the reuse audit is in
[mcp-server.md](mcp-server.md#reuse-audit--what-each-tool-wraps)). `src/mcp/schemas.ts` holds the
versioned Zod contracts the server advertises as JSON Schema (committed under `schemas/mcp/`), and
every failure is a typed envelope mapped from the existing `RecorderError` / `InstallError` /
`SynthError` codes. `synthesize` and `simulate` stay pure; `record` and `verify` are deterministic
per chain state ([determinism map](mcp-server.md#determinism-map)). **Stage 3b is not reachable
from here**: there is no install or deploy tool, the server never signs, and it needs no secret —
the artifact an agent produces is what the human installs with the CLI.

## Design choices

- **`bigint` everywhere for token amounts** — no float rounding in money math; formatting
  to human decimals happens only at the edges (`emitter.formatAmount`).
- **Explicit `now`** — synthesis takes the current time as a parameter rather than reading
  the clock, keeping it deterministic and testable.
- **Offline-first** — the fixture is the default source; the live RPC adapter is opt-in, so
  the demo, tests, and CI never depend on network state or RPC retention windows.
- **Code-first, deploy-second, structurally** — the agent surface can produce and check
  artifacts but cannot install them; installation is a separate, explicit, human-initiated
  CLI/signing step. A design that needed the agent to deploy would be a design error.
