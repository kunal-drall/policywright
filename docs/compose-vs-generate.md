# When policywright composes vs. generates

Compose-first is policywright's permanent default: **configure a stock
OpenZeppelin policy wherever one expresses the constraint; generate fresh Rust
only where none can.** This page states the boundary exactly as the code
implements it, so a reviewer can predict — and a test can assert — which side
of the line every synthesised constraint falls on.

The decision is made per policy by `realisePolicies` in
[src/synthesizer.ts](../src/synthesizer.ts) and surfaced in three places: the
`context-rule.json` bindings (what installs), the dry-run report's policy-set
header and **Enforced by** column (what decided each scenario), and
[test/compose-boundary.test.ts](../test/compose-boundary.test.ts) (the
invariant).

## The boundary

| Synthesised constraint                                                        | Stock OZ policy that expresses it                                                                                                                               | Realisation                                                                                                         | Artifact                                                                                                                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spend cap on an asset the subject **directly `transfer`red** in the recording | `spending_limit` — `SpendingLimitAccountParams { spending_limit: i128, period_ledgers: u32 }` (`spending_limit.rs:88-94`); meters `transfer` calls (`:222-294`) | **composed** — params only, on the token's `CallContract` rule                                                      | `context-rule.json` → `stock:spending_limit { spending_limit, period_ledgers }` with the OZ `file:line` in `paramsSource`                                           |
| Spend cap on an asset with **no** subject-authorized direct transfer          | none that fires — `spending_limit` panics `NotAllowed` on any non-`transfer` context ([FACTS §2.4](FACTS.md))                                                   | **offline-only** — the harness enforces it; `context-rule.json` records a `DELTA` note instead of rejectable params | none on-chain (a future generated policy could read the outflow; not built)                                                                                         |
| Call-frequency limit                                                          | none ships ([FACTS §2.4](FACTS.md): no stock frequency policy)                                                                                                  | **generated** — a net-new stateful policy contract implementing the real `Policy` trait                             | `FrequencyLimitPolicy.rs` (byte-identical to the compiled-and-tested crate at the default config) bound as `custom:FrequencyLimitPolicy { window_secs, max_calls }` |
| Argument constraint (swap `path` token set)                                   | none ships (no stock argument-value scoping)                                                                                                                    | **offline-only** — enforced by the harness when `--constrain-arguments` is on; `DELTA` note otherwise               | none on-chain (argument-checking policy codegen is the remaining T2 codegen item)                                                                                   |
| Function-level narrowing inside a contract                                    | none — rules are contract-level (`storage.rs:289-304`)                                                                                                          | **offline-only** — the harness's scope model; `observedFns` is advisory in the artifact                             | none on-chain (same future generated policy)                                                                                                                        |

Two consequences follow, and the tests assert both:

1. **A constraint a stock policy can express is never generated.** There is no
   code path that emits a spend cap into Rust; `realisePolicies` can only
   return `composed` or `offline-only` for a spending limit.
2. **A generated policy is never a re-implementation of a stock one.** The
   only generated contract is the frequency limit, for which OZ ships nothing.

## Why the line sits here

- The stock `spending_limit` is asset-blind and `transfer`-only: it meters the
  `i128` at `args[2]` of a `transfer` context and rejects everything else.
  Composing it is therefore only correct on the **token's** rule, and only when
  the recording proves the subject authorizes that `transfer` (each
  `require_auth` is its own `Context` at `__check_auth` — [FACTS §2.5](FACTS.md)).
  policywright reads that proof from the authorization trees; the offline
  fixture carries none, which is why its BLND cap is a `DELTA` note while the
  real recording's BLND cap composes.
- A frequency bound is a human-time constraint the account must **remember**
  (call history per `(smart_account, context_rule_id)`), and OZ ships no such
  policy. Generating it is the only option; the generated contract follows the
  stock storage-segregation pattern exactly
  ([contracts/frequency-limit-policy](../contracts/frequency-limit-policy)).

## What "compiles" and "passes simulation" mean for each artifact

| Artifact                                       | Compiles                                                                                                                                                                                                                                                                    | Passes simulation                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composed configuration (`context-rule.json`)   | Validates field-by-field against the `add_context_rule` signature and every bound policy's install guards ([src/install-shape.ts](../src/install-shape.ts), each check citing its OZ line), and its params encode to the exact `ScVal` the policy's `AccountParams` decodes | The dry-run harness denies the over-cap scenario, attributing it to `composed stock:spending_limit on rule pw:xfer:BLND`; permits the recorded replay. Honest limit: the harness measures the window in seconds and caps a candidate's outflow — the on-chain policy meters `transfer` amounts per ledger window |
| Generated contract (`FrequencyLimitPolicy.rs`) | `cargo build` / `cargo test --locked` against the pinned toolchain (25 Rust tests in the Soroban test environment); `stellar contract build` reproduces the recorded wasm hash; the emitted source is byte-identical to the crate                                           | The dry-run harness denies the repeat-within-window scenario, attributing it to `generated custom:FrequencyLimitPolicy`; the Rust tests exercise the same rolling-window semantics on-contract                                                                                                                   |

## Where to see it on real data

From the recorded testnet claim→swap sequence
([examples/live/recorded-claim-swap-fresh.json](../examples/live/recorded-claim-swap-fresh.json)),
`npm run cli -- synth --input examples/live/recorded-claim-swap-fresh.json --out examples/live/fresh`
writes both artifacts side by side — the composed configuration
([context-rule.json](../examples/live/fresh/context-rule.json)) and the
generated contract
([FrequencyLimitPolicy.rs](../examples/live/fresh/FrequencyLimitPolicy.rs)) —
and the dry-run report
([examples/live/simulation-report.md](../examples/live/simulation-report.md))
shows each deny attributed to the artifact that realises it.

## Planned composition targets

`simple_threshold` and `weighted_threshold` exist as stock modules
([FACTS §2.4](FACTS.md)) and will be composed — never generated — when
multi-signer flows enter the synthesizer's scope.
