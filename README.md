# policywright

[![CI](https://github.com/kunal-drall/policywright/actions/workflows/ci.yml/badge.svg)](https://github.com/kunal-drall/policywright/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Policywright turns a transaction a user already performed (or simulated) into the
least-privilege [OpenZeppelin smart-account](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account)
authorization that permits exactly that flow — a context rule plus the minimum set of
policies — and lets them verify it with a dry-run before installing.

The worked example throughout is a Stellar/Soroban flow: a **Blend** pool emissions claim
(BLND in) followed by a **Soroswap** exact-input swap of that BLND into **USDC** (BLND
out, USDC in).

## How it works

```
RecordedTx ─▶ synthesize ─▶ SmartAccountSpec ─▶ emit ─┬─▶ spec.json
 (fixture or                (context rules +          ├─▶ context-rule.json
  live RPC)                  minimal policies)         ├─▶ summary.txt
                                  │                    └─▶ FrequencyLimitPolicy.rs
                                  └─▶ dry-run simulator ─▶ permit / deny / flag report
```

1. **Record** — capture a transaction as a normalised `RecordedTx` (scoped contract
   calls + token in/out flows). Sourced from the baked-in offline fixture or, on demand,
   from a live Soroban RPC node.
2. **Synthesize** — derive a least-privilege `SmartAccountSpec`:
   - a context rule scoped to the exact `(contract, function)` pairs observed;
   - a **gross-outflow** spending-limit policy per asset that left the account (an asset
     received and then sent — like BLND here — nets to ~zero but is still capped on the
     gross amount it moved out);
   - **no cap** for assets that only flowed in (e.g. the USDC received) — the
     minimal-permission case;
   - an always-on frequency-limit policy.
3. **Emit** — render the spec as JSON, a human-readable summary, an _illustrative_
   custom Rust policy, and **`context-rule.json`**: the installable OpenZeppelin
   context rules (one `CallContract` rule per contract, plus a rule per token whose
   `transfer` the subject authorized — where the **stock `spending_limit`** attaches
   with its real install params, `{ spending_limit: i128, period_ledgers: u32 }`).
   Units are converted to the on-chain ledger basis, every param shape carries its OZ
   source citation, and anything the stock policies cannot express is recorded as a
   delta note rather than emitted in a shape the real contract would reject. Schema:
   [docs/context-rule-schema.md](docs/context-rule-schema.md).
4. **Simulate** — dry-run candidate calls against the spec and report whether each would
   be **permitted, denied, or flagged** (and why), before anything is installed on-chain.
   Argument-level scope (the swap `path` token set) is derived always and enforced on
   request (`--constrain-arguments`).

## Quickstart

```bash
npm ci
npm run demo
```

`npm run demo` records the fixture, synthesizes the spec, emits the artefacts to `out/`,
and runs the dry-run scenarios — asserting each behaves as expected. It exits non-zero if
any scenario deviates, so it doubles as a smoke test. It needs no network access.

## Commands

| Command                                                                                                      | What it does                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run demo`                                                                                               | End-to-end pipeline + dry-run self-check (offline).                                                                                                       |
| `npm run cli -- synth [--input <recorded.json>]`                                                             | Synthesize from the fixture (or a saved record output, e.g. `examples/live/recorded-claim-swap.json`) and print the summary, spec, and context-rule JSON. |
| `npm run cli -- simulate [--input <recorded.json>] [--constrain-arguments] [--probe-token <C…>]`             | Run the dry-run scenarios against the fixture's spec (or a saved recording's) and print the permit / deny / flag report.                                  |
| `npm run record -- <txHash>... [--account <G\|C>] [--network testnet\|mainnet\|futurenet] [--rpc-url <url>]` | Fetch live transaction(s) by hash and print one merged recording. `record --from-simulation <file>` ingests a saved simulation instead.                   |

The live `record` path is optional: the network fetch itself is not exercised by the demo
or tests, but its decoders and multi-hash merge logic run network-free in
[test/recorder.test.ts](test/recorder.test.ts) against the committed raw captures of real
testnet transactions in [examples/live/](examples/live/). Given valid transaction hashes
within the RPC node's retention window, it decodes the `InvokeContract` calls and
CAP-67/SEP-41 token events into one merged `RecordedTx`, resolving each token's symbol/
decimals from its SAC metadata (with an explicit `resolved: false` fallback when that is
not possible). `--account <G…|C…>` names the subject whose authorizations are scoped;
`--from-simulation <file>` ingests a saved `simulateTransaction` exchange instead.
Not-found, failed, wrong-network, and decode failures return clear, actionable errors.

## Configuration

`synth` and `simulate` accept overrides for the synthesis knobs; anything omitted keeps
its default.

| Flag                        | Default         | Meaning                                               |
| --------------------------- | --------------- | ----------------------------------------------------- |
| `--lifetime <secs>`         | `2592000` (30d) | Context-rule lifetime (sets `valid_until`).           |
| `--spend-window <secs>`     | `86400` (1d)    | Rolling window the spend cap is measured over.        |
| `--cap-multiplier <number>` | `1.1`           | Cap = observed gross outflow × this (rounded up).     |
| `--frequency-window <secs>` | `86400` (1d)    | Rolling window for the frequency limit.               |
| `--frequency-max <count>`   | `5`             | Max calls allowed within the frequency window.        |
| `--constrain-arguments`     | off             | Enforce the derived argument constraints (see below). |

`simulate` also accepts `--input <recorded.json>` (run against a saved recording instead of
the fixture) and `--probe-token <C…>` (the token the unobserved-route scenario routes
through; default: the network's native XLM Stellar Asset Contract).

```bash
npm run cli -- synth --lifetime 604800 --cap-multiplier 1.25
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json --constrain-arguments
```

## Argument-level scope (`--constrain-arguments`)

The dry-run harness scopes not only _which_ calls a rule permits but, for the arguments it
knows how to read, _what they may contain_. Argument constraints are **derived on every
run** and recorded on the spec as `argumentScopes`; whether they are **enforced** is a
config decision, off by default — constraints are an opt-in tightening of the observed
flow, never a silent widening.

| Mode                             | Unobserved route (e.g. BLND→XLM when only BLND→USDC was recorded)                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Off (default)** — advisory     | ⚠️ **flag** — the call is _permitted_ by every enforced check; the report names the scope gap and how to close it.            |
| **On** (`--constrain-arguments`) | ⛔ **deny** — the constraint counts as a policy; the reason names the rule, the call, the argument, the allow-set, the route. |

**Derivation rules** — which observed arguments become constraints. The rule table is the
exported `ARGUMENT_DERIVATION_RULES` in [src/synthesizer.ts](src/synthesizer.ts); each
rule is applied to every observed call, and repeated observations union into one allow-set
per `(contract, function, argument)`.

| Rule        | Applies to                                              | Reads                                                                                                                                                                                                             | Produces                                                                                        |
| ----------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `swap-path` | every observed call whose function name contains `swap` | the first positional argument that is a non-empty vector of contract-address-shaped strings (`C` + 55 base32 chars) — `path: Vec<Address>` in the Soroswap router signature ([docs/FACTS.md](docs/FACTS.md) §4.3) | the **set** of token addresses observed in it, labelled `path`, e.g. `{BLND, USDC}` at `arg[2]` |

**Limits, stated plainly.**

- Set semantics only: a route through only-observed tokens is allowed in any order and hop
  count; amounts are the spending-limit policy's job.
- `swap-path` is the only rule. A swap whose route is not an address vector (Comet's
  `token_in` / `token_out` addresses) derives nothing, and no non-swap argument is
  constrained.
- The address check is a StrKey _shape_ check, not a checksum check.
- Enforcement lives in the **offline dry-run harness only**: no stock OpenZeppelin policy
  can express argument-value scoping, so `context-rule.json` records the constraint as a
  `DELTA` note. On-chain enforcement needs a generated policy whose `enforce` reads the
  argument — that is the remaining T2 policy-codegen deliverable and is not built yet.

**The criterion case on real data.** The recorded testnet claim→swap sequence
([examples/live/recorded-claim-swap-fresh.json](examples/live/recorded-claim-swap-fresh.json),
decoded from the committed raw captures) swapped BLND→USDC. The harness re-routes that
exact swap through the network's native XLM Stellar Asset Contract — an address derived
from the network passphrase, never observed in the recording — and reports it both ways:

```bash
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json
# → | BLND→XLM swap (route through unobserved XLM) | ⚠️ flag (argument-constraint) | permitted with a scope gap … |
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json --constrain-arguments
# → | BLND→XLM swap (route through unobserved XLM) | ⛔ deny (argument-constraint) | argument constraint violated: … |
```

Both reports are committed —
[examples/live/simulation-report.md](examples/live/simulation-report.md) and
[examples/live/simulation-report.constrained.md](examples/live/simulation-report.constrained.md) —
and CI regenerates and diffs them on every run. Every report states the recording, the
generated policy set and mode it was evaluated against, what each decision means, and which
addresses the token symbols refer to.

## The generated Rust policy is illustrative

The emitted `FrequencyLimitPolicy.rs` implements OpenZeppelin's real `Policy` trait
(`install` / `enforce` / `uninstall`, with `enforce` rejecting by panicking) and is
byte-identical to the compiled-and-tested crate at
[contracts/frequency-limit-policy](contracts/frequency-limit-policy) (25 Rust tests
against `stellar-accounts` v0.7.2; equality locked by
[test/rust-policy.test.ts](test/rust-policy.test.ts)). **It is not audited; deployment is
TESTNET-only and it must never be deployed to mainnet or used to guard real value** —
every generated Rust file is stamped with that warning, and the emitted summary carries
the same note.

## Development

| Script                                    | Purpose                                                      |
| ----------------------------------------- | ------------------------------------------------------------ |
| `npm test`                                | Run the Vitest suite.                                        |
| `npm run test:coverage`                   | Run tests with coverage (synthesizer + simulator held ≥90%). |
| `npm run lint`                            | ESLint (typescript-eslint, type-checked rules).              |
| `npm run format:check` / `npm run format` | Check / apply Prettier.                                      |
| `npm run typecheck`                       | `tsc --noEmit`.                                              |
| `npm run build`                           | Emit `dist/` (`tsconfig.build.json`).                        |

CI ([ci.yml](.github/workflows/ci.yml)) is configured for pushes to `main` and pull
requests, with three jobs: **build** (npm ci → lint → format:check → typecheck → test →
demo), **site** (docs-site build), and **contracts** (pinned Rust 1.97.1: `cargo fmt
--check` → `clippy -D warnings` → `cargo test`, then a `stellar contract build` of the
policy crate with the same pinned stellar-cli 27.1.0 used for the testnet deploy). Both
toolchains are cached. Because this repository is a GitHub fork, runs are currently
dispatched manually and cited per deliverable in
[evidence/EVIDENCE.md](evidence/EVIDENCE.md) (see the CI-trigger note there).

## Project layout

| Path                                   | Purpose                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                         | Core domain types (single source of truth).                                                                      |
| `src/sources/fixture.ts`               | Loads the baked-in offline recording.                                                                            |
| `src/sources/rpc.ts`                   | Optional live Soroban RPC adapter.                                                                               |
| `src/synthesizer.ts`                   | `RecordedTx` → `SmartAccountSpec`.                                                                               |
| `src/emitter.ts`, `src/rust-policy.ts` | Render spec JSON, context-rule JSON, summary, and Rust.                                                          |
| `src/simulate.ts`                      | Dry-run evaluator + scenarios + report (permit / deny / flag, argument constraints, probe token).                |
| `src/network.ts`                       | Network passphrases, the native XLM SAC address per network, the contract-address shape check.                   |
| `src/demo.ts`, `src/cli.ts`            | Demo orchestration and CLI.                                                                                      |
| `fixtures/recorded-tx.json`            | The committed offline recording.                                                                                 |
| `contracts/`                           | Rust workspace: the compiled-and-tested frequency-limit-policy crate (source of truth for the emitted template). |
| `scripts/deploy-testnet.sh`            | Testnet-only build + upload + deploy + hash-verify; appends the deployment log to evidence/EVIDENCE.md.          |

See [docs/architecture.md](docs/architecture.md) for the design in depth.

## Documentation site

[`site/`](site/) contains the public documentation site
(<https://policywright.lemmalabs.space>), built with Astro + Starlight. It is
fully static — no backend, no analytics — with built-in Pagefind search.

```bash
cd site
npm ci
npm run dev     # local dev server
npm run build   # static build to site/dist/
```

CI builds the site on every push and pull request (the `site` job in
[ci.yml](.github/workflows/ci.yml)).

### Deploying to policywright.lemmalabs.space (Vercel)

1. **Import the repo** at <https://vercel.com/new>. The committed
   [vercel.json](vercel.json) points install/build at `site/` and serves
   `site/dist`, so no build settings are needed. (Equivalent alternative:
   set the project's **Root Directory** to `site` in the Vercel dashboard and
   let it auto-detect Astro — in that case Vercel ignores the root
   `vercel.json`.)
2. **Add the domain** in the Vercel project: Settings → Domains →
   `policywright.lemmalabs.space`.
3. **DNS** — in the DNS zone for `lemmalabs.space`, add the record Vercel
   shows for the subdomain:

   | Type  | Name           | Value                   |
   | ----- | -------------- | ----------------------- |
   | CNAME | `policywright` | `cname.vercel-dns.com.` |

   Certificates are provisioned automatically once the record propagates.

## Deliverables

This project is built for Stellar SCF #44 — the awarded submission
["Record-to-Policy MCP + Agent skill"](https://communityfund.stellar.org/project/policywright-j8x)
— against a three-tranche plan. All dates are targets. The table tracks the funded deliverables and
what is actually verifiable in this repository today — see
[the roadmap](https://policywright.lemmalabs.space/roadmap/) for the full plan.

| Tranche                    | Target      | Deliverables                                                                                                                          | Status                          |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **T1 — MVP (testnet)**     | 31 Aug 2026 | Recording layer (live + simulated); least-privilege synthesizer; generated-policy compile + testnet deploy; open-source CLI + CI      | ✅ Delivered (D1.1–D1.4)        |
| **T2 — Testnet expansion** | 15 Oct 2026 | MCP server; Claude skill; dry-run harness + argument-level scope; net-new policy codegen with storage segregation; wallet integration | 🚧 In progress (D2.3 delivered) |
| **T3 — Mainnet launch**    | 30 Nov 2026 | Three end-to-end walkthroughs; OpenZeppelin validation; production release; mainnet demonstration; audit readiness (SCF Audit Bank)   | ⏳ Not started                  |

**Shipped and verifiable today**: the recording layer from the
offline fixture, from a live Soroban RPC node (multi-hash sequences with authorization
trees), and from a saved `simulateTransaction` exchange; the synthesizer (exact scope
binding, gross-outflow spend caps, minimal-permission inflows, frequency limits, and
installable OZ context rules with real stock-policy install params —
[docs/context-rule-schema.md](docs/context-rule-schema.md)); the emitter (`spec.json`,
`context-rule.json`, `summary.txt`, stamped illustrative Rust — the same source as the
compiled-and-tested crate in [contracts/](contracts/), 25 Rust tests, reproducible wasm
build per [docs/FACTS.md](docs/FACTS.md) §1.5); the offline dry-run
harness with argument-level scope (permit / deny / flag reports, the BLND→XLM case
both ways on the real recording — [above](#argument-level-scope---constrain-arguments));
the CLI; the Vitest suite with coverage thresholds; and CI. The emitted artifacts and
dry-run reports for real testnet claim+swap sequences are committed under
[`examples/live/`](examples/live/).

**Delivered late in T1:** the generated policy compiles, passes its Rust test suite, and
is deployed to testnet — contract ID and hash-verification trail in the deployment log in
[evidence/EVIDENCE.md](evidence/EVIDENCE.md). The deployed instance is testnet-only and
unaudited.

**Tranche 2 so far:** D2.3 — the dry-run harness with supported argument-level scope —
is delivered (evidence section D2.3 in [evidence/EVIDENCE.md](evidence/EVIDENCE.md)). The
rest of T2 — MCP server, Claude skill, storage-segregated codegen, wallet integration — is
tracked in [docs/T2-NOTES.md](docs/T2-NOTES.md).

## Acknowledgements

policywright extends the prior art of **[kalepail/pollywallet](https://github.com/kalepail/pollywallet)**
by Tyler van der Hoeven — a passkey-secured smart-wallet demo on Stellar that deploys
OpenZeppelin smart-account contracts on Soroban and submits through an OZ Channels relayer
(in the lineage of [`passkey-kit`](https://github.com/kalepail/passkey-kit) and the
WebAuthn smart-wallet work).

Stated plainly:

- **Adopts** — OpenZeppelin's Stellar smart-account model (context rules + policies) and
  Soroban's account-abstraction primitives that pollywallet demonstrates.
- **Extends** — pollywallet shows how to _create and operate_ a smart wallet; policywright
  adds the missing step of _deriving the least-privilege authorization from a transaction
  the user already performed_, plus an offline dry-run to verify it before installing.
- **Replaces** — nothing in pollywallet. This is a complementary authoring/verification
  tool, not a wallet; it does not sign, deploy, or relay user transactions — the only
  on-chain action in the repo is the opt-in, testnet-only deployment of the generated
  policy contract itself ([scripts/deploy-testnet.sh](scripts/deploy-testnet.sh)).
