# EVIDENCE

What has been delivered → how a reviewer verifies it independently → the exact
links, paths, and hashes.

Every row is checkable without trusting this document. Where a claim cannot be
verified from the repository, it says so instead of claiming completion.

**Scope note.** Tranche 1 (D1.1–D1.4 below) was delivered on 2026-08-03 and is
closed. Tranche 2: D2.3 (dry-run harness + argument-level scope), D2.4
(composed configuration + generated stateful policy), D2.5 (testnet smart
account with the installed generated policy — fallback signing path), D2.1
(the MCP server) and D2.2 (the Claude skill) are built and evidenced as of
2026-09-02 — see [Delivered — Tranche 2](#delivered--tranche-2). What each
criterion still needs is a **human recording**: the MCP reference-session
transcript (D2.1), the skill demo transcript (D2.2), and the end-to-end video
(D2.5) — the three BLOCKERS below, all scripted with real outputs in
[docs/demo-script-t2.md](../docs/demo-script-t2.md) so one recording session
yields all three ([Tranche 2 close-out](#tranche-2-close-out--truthfulness-pass-demo-script-form)).
The remaining T2 items are listed under [Not yet delivered](#not-yet-delivered).
Since D1.3 exactly one real testnet deployment exists — the generated
frequency-limit policy contract (see [Deployment log](#deployment-log)); D2.5
restored it and added two more testnet deployments — OpenZeppelin's example
smart account and stock spending-limit wrapper, built from vendored pinned
source ([FACTS.md §14](../docs/FACTS.md)) — and the account now carries two
installs of the synthesised rules (ids 1–3 and 4–6). Every address inside the
committed fixture remains synthetic ([FACTS.md §5](../docs/FACTS.md)).

**Where the completion criteria come from.** The public SCF project page
([SCF #44 — "Record-to-Policy MCP + Agent skill"](https://communityfund.stellar.org/project/policywright-j8x),
checked 2026-08-03) shows the award but does not expose per-deliverable
completion criteria. The "Criterion" line under each D1.x below therefore
quotes the funded tranche plan as recorded in this repository (the T1
deliverable list in the [README](../README.md#deliverables) and
[roadmap](https://policywright.lemmalabs.space/roadmap/)) — it is not a quote
of hidden portal text.

Last updated 2026-09-02.

---

## How to verify everything at once

```bash
git clone https://github.com/kunal-drall/policywright && cd policywright
npm ci
npm run lint && npm run format:check && npm run typecheck && npm test && npm run demo
(cd contracts && cargo test --locked)   # Rust policy crate; toolchain per contracts/rust-toolchain.toml
# D2.3 — the real recorded claim→swap sequence through the harness, both ways:
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json --constrain-arguments
# D2.4/D2.5 — both artifacts for that sequence, emitted with the pinned deploy-time facts:
npm run cli -- synth --input examples/live/recorded-claim-swap-fresh.json --out /tmp/fresh $(cat examples/live/fresh/synth.args)
cp examples/live/fresh/synth.args /tmp/fresh/ && diff -r /tmp/fresh examples/live/fresh
# D2.5 — what is installed on the testnet smart account vs. the artifact (read-only, no key needed):
npm run cli -- verify --artifact examples/live/fresh/context-rule.json \
  --account CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT \
  --install-log examples/live/testnet/install-20260902T105742Z.json
# D2.1 — the MCP server: every tool over stdio against committed fixtures (in `npm test`),
# the committed schemas, and the live registration:
npx vitest run test/mcp.test.ts
npm run mcp:schemas -- --check
claude mcp list          # → policywright … ✓ Connected (from the committed .mcp.json)
# D2.2 — the skill package and the machine walkthrough of its demo script (in `npm test`):
npx vitest run test/skill.test.ts
npx --yes skills-ref@0.1.5 validate .claude/skills/policywright-grant
# Close-out — the demo-script artifact (7-day, route enforced) regenerates from its pinned flags,
# and its install (rule ids 4-6) verifies on-chain through its own install log (read-only):
npm run cli -- synth --input examples/live/recorded-claim-swap-fresh.json --out /tmp/demo $(cat examples/live/demo/synth.args)
cp examples/live/demo/synth.args /tmp/demo/ && diff -r /tmp/demo examples/live/demo
npm run cli -- verify --artifact examples/live/demo/context-rule.json \
  --account CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT \
  --install-log examples/live/testnet/install-20260902T153356Z.json
npm run build           # the CLI, library and MCP server compile under the build config (dist/)
```

`npm run demo` is a self-checking smoke test: it asserts each dry-run scenario
matches its expected decision and exits non-zero on any deviation. It requires no
network access and no secrets. CI runs exactly this sequence
([ci.yml](../.github/workflows/ci.yml),
[runs](https://github.com/kunal-drall/policywright/actions/workflows/ci.yml));
because this repository is a GitHub fork, runs are dispatched manually and one
is cited per deliverable below (see the D1.2 CI-trigger note).

---

## Delivered — Tranche 1

### D1 — Recording layer

**Delivered.** A `RecordedTx` can be produced from the committed offline fixture
or from a live Soroban RPC node by transaction hash.

| Verify                                     | How                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Offline path                               | `npm run cli -- synth` — reads [fixtures/recorded-tx.json](../fixtures/recorded-tx.json) |
| Live path exists and is typed              | [src/sources/rpc.ts](../src/sources/rpc.ts)                                              |
| Live path shape (SAC metadata, `resolved`) | [src/types.ts](../src/types.ts) `TokenRef.resolved`                                      |

~~**Honest limits.** The live path is not exercised by the demo or the test
suite … The simulated-transaction recording path in the T1 plan is not
built.~~ **Superseded by D1.1 below** (2026-08-03): the decoders are now
exercised network-free against committed raw captures of real testnet
transactions, and the simulated path is built and fixture-tested.

The fixture's addresses are well-formed but synthetic; its `hash` is a synthetic
64-hex-character placeholder. Both facts are recorded in
[FACTS.md §5](../docs/FACTS.md) and stated in the fixture's own `note` field.

### D1.1 — Hardened recording layer (multi-hash, simulated path, typed errors)

**Criterion (T1 plan):** "Recording layer (live + simulated)."

**Delivered 2026-08-03.** The CLI ingests a real testnet Blend-claim → swap
transaction sequence by hash and outputs one structured, merged `RecordedTx`.

The exact command that produced the committed output, run against the live
public testnet RPC:

```bash
npm run record -- \
  acf256a0688e7f9c36520f4fc20cfa924d1b2e593033d85b0e443ce770b2d452 \
  2dcff6618ff12fb629700cab627b3870afa3f0dd000becf88b2eb7826d0b2c1b \
  --network testnet \
  --account CCW6R5ZKEIJJ75YT54TEHMRUYTP4XQGUI6H63EE3W65H4P4FAUICXP3Q \
  > examples/live/recorded-claim-swap.json
```

| Item                                                                 | Value                                                                                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim tx (Blend TestnetV2 pool `claim` event, via wrapper `harvest`) | `acf256a0688e7f9c36520f4fc20cfa924d1b2e593033d85b0e443ce770b2d452` — [stellar.expert](https://stellar.expert/explorer/testnet/tx/acf256a0688e7f9c36520f4fc20cfa924d1b2e593033d85b0e443ce770b2d452) |
| Swap tx (Soroswap router `swap_exact_tokens_for_tokens`)             | `2dcff6618ff12fb629700cab627b3870afa3f0dd000becf88b2eb7826d0b2c1b` — [stellar.expert](https://stellar.expert/explorer/testnet/tx/2dcff6618ff12fb629700cab627b3870afa3f0dd000becf88b2eb7826d0b2c1b) |
| Committed output                                                     | [examples/live/recorded-claim-swap.json](../examples/live/recorded-claim-swap.json)                                                                                                                |
| Raw captures (ground truth)                                          | [examples/live/](../examples/live/) `<hash>.json` — verbatim `getTransaction` exchanges                                                                                                            |

**Subject choice, stated plainly.** These are third-party transactions (the
user's own claim→swap flow has not been executed yet — FACTS §3.1). The swap's
economic actor is the smart-wallet contract account `CCW6R5ZK…` (it authorizes
via `__check_auth` and both transfer events name it), so `--account` uses it;
the claim moved 0 tokens (the only claim in the retention window), so it
contributes calls but no flows. When the human runs their own flow with one
`G...` account, the identical command applies with that account.

**Movement reconciliation** (spot-check of every amount against the raw
events; also asserted exactly in the test suite):

| Flow in `recorded-claim-swap.json`     | Raw event it reconciles against                                          |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `out 10000000` of `CDLZFC3S…` (native) | `2dcff6…` ev[0]: SAC `transfer` `CCW6R5ZK… → pair`, data `i128 10000000` |
| `in 308600` of `CB3TLW74…`             | `2dcff6…` ev[1]: token `transfer` `pair → CCW6R5ZK…`, data `i128 308600` |
| (no claim flows)                       | `acf256…` emits zero token-movement events (claimed amount was 0)        |

**What D1.1 added**, each verifiable in the named file:

| Capability                                                                                                                                                                              | Evidence                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Multi-hash sequence recording, merged in ledger-close-time order, per-invocation `sourceHash`                                                                                           | [src/sources/rpc.ts](../src/sources/rpc.ts), [src/sources/decode.ts](../src/sources/decode.ts); order test in [test/recorder.test.ts](../test/recorder.test.ts)                                                                                              |
| Decoders rewritten to the FACTS §3 protocol-27 shapes: fee-bump envelopes, authorization-entry trees, both `transfer` topic shapes, CAP-67 muxed map data, SAC `mint`/`burn`/`clawback` | [src/sources/decode.ts](../src/sources/decode.ts); every decoder runs against the committed captures in [test/recorder.test.ts](../test/recorder.test.ts) — no network                                                                                       |
| Explicit `--account <G\|C>` subject (the tx source is often NOT the economic actor — RECONCILIATION row 27)                                                                             | [src/sources/rpc.ts](../src/sources/rpc.ts); default-subject warning test                                                                                                                                                                                    |
| Simulated-path ingestion: `record --from-simulation <file>` → `RecordedTx` with `source: "simulation"`                                                                                  | [src/sources/simulation.ts](../src/sources/simulation.ts); committed real exchange [examples/live/simulated-soroswap-swap.json](../examples/live/simulated-soroswap-swap.json) captured by [scripts/capture-simulation.ts](../scripts/capture-simulation.ts) |
| Typed error taxonomy `BAD_INPUT` / `TX_NOT_FOUND` (with retention explanation) / `NETWORK` / `DECODE_FAILED` (naming the XDR section); no silent catches                                | [src/sources/errors.ts](../src/sources/errors.ts); taxonomy tests                                                                                                                                                                                            |
| Unresolved token metadata falls back to the FULL contract id + `resolved: false` + a warning — never a sliced pseudo-symbol                                                             | [src/sources/decode.ts](../src/sources/decode.ts) `fallbackToken`; fallback test                                                                                                                                                                             |
| `@stellar/stellar-sdk` pinned exact `15.1.0` per FACTS §1.1                                                                                                                             | [package.json](../package.json)                                                                                                                                                                                                                              |

**Honest limits.** (1) The two real hashes were ~4–6 h from leaving the ~7-day
RPC retention window at delivery time; after expiry the live command above
returns `TX_NOT_FOUND` (with exactly that explanation) and the committed raw
captures + tests are the reproduction path — the explorer links keep working.
(2) The `acf256…` claim is _nested_ (top-level fn is `harvest` on a wrapper):
its authorization tree carries no sub-invocations, so the pool-level `claim`
is visible in the recording's events/flows but not as a scoped call —
documented in RECONCILIATION row 20 as a T1 limitation. (3) Recording a
FAILED transaction is rejected as `BAD_INPUT` by design.

### D1.2 — Installable OZ context rules with composed stock-policy params

**Criterion (T1 plan):** "Least-privilege synthesizer (scope + composed
policies + minimal permission)."

**Delivered 2026-08-03.** The synthesizer consumes the merged multi-transaction
`RecordedTx` sequence and emits `context-rule.json`: installable OpenZeppelin
context rules using the REAL v0.7.2 install shapes — one `CallContract` rule
per called contract, plus a rule for the token whose direct `transfer` the
subject authorized inside the swap, which is where the stock `spending_limit`
composes with its real parameters.

The committed artifact from the real recorded sequence, and the exact command
that produces it (offline — the input is the committed D1.1 recorder output):

```bash
npm run cli -- synth --input examples/live/recorded-claim-swap.json
# committed: examples/live/context-rule.json
```

| Item                                | Value                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Committed emitted artifact          | [examples/live/context-rule.json](../examples/live/context-rule.json) (schema: [docs/context-rule-schema.md](../docs/context-rule-schema.md); emitted at `schemaVersion: 1` for D1.2, regenerated as v2 by D2.5 — same rules and params, plus `lifetimeLedgers`, empty `signers`, null addresses and an `installTargets` echo) |
| Its source recording                | [examples/live/recorded-claim-swap.json](../examples/live/recorded-claim-swap.json) — both original tx hashes are carried in the artifact's `source.sourceHashes`                                                                                                                                                              |
| Stock params emitted                | `stock:spending_limit { spending_limit: "11000000", period_ledgers: 17280 }` on the `CallContract(native XLM SAC)` rule — 11000000 = ceil(observed gross out 10000000 × 1.1); 17280 ledgers = the configured 86400 s window at ~5 s/ledger, equal to OZ's own `DAY_IN_LEDGERS`                                                 |
| Verified install surface it targets | `add_context_rule(context_type, name, valid_until, signers, policies: Map<Address, Val>)` — [FACTS.md §2.5](../docs/FACTS.md)                                                                                                                                                                                                  |

**Field-by-field cross-check against the OZ source** (every citation is at tag
`v0.7.2`, commit `a9c4216…`, re-verified against a fresh clone on 2026-08-03):

| Emitted                                 | OZ source it satisfies                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `spending_limit` (i128, decimal string) | `SpendingLimitAccountParams.spending_limit: i128` — `spending_limit.rs:88-94`; positive, so passes `:380-382`          |
| `period_ledgers` (u32, > 0)             | `SpendingLimitAccountParams.period_ledgers: u32` — `spending_limit.rs:88-94`; nonzero, so passes `:380-382`            |
| Rule type `CallContract`                | install panics `OnlyCallContractAllowed` otherwise — `spending_limit.rs:376-378`                                       |
| Bound only to a `transfer` context      | `enforce` meters only `fn_name == "transfer"`, amount at `args[2]`; anything else panics — `spending_limit.rs:222-294` |
| Rule names ≤ 20 bytes                   | `MAX_NAME_SIZE = 20` bytes — `smart_account/mod.rs:522-530`                                                            |
| ≥ 1 policy per emitted rule             | rules must carry a signer or policy — `smart_account/mod.rs:20-21`                                                     |
| `valid_until` as ledger sequence        | compared against `e.ledger().sequence()` — `storage.rs:282`                                                            |

This cross-check is **committed as a CI-run test**, not just asserted here:
`test/oz-context-rules.test.ts` → _"committed examples/live/context-rule.json
satisfies the OZ install signature"_ validates the artifact file itself.

**CI run for this deliverable:**
[run 30765581963](https://github.com/kunal-drall/policywright/actions/runs/30765581963)
— all jobs green (`build`: lint → format → typecheck → 86 tests → demo;
`site`: docs build) on commit `e30c468`.

**Honest limit (CI trigger).** This repository is a GitHub fork, and GitHub
does not fire push-triggered workflows on forks until workflows are enabled
from the repo's Actions tab — which is why no CI runs existed before D1.2
despite the workflow being configured. `workflow_dispatch` was added to
[ci.yml](../.github/workflows/ci.yml) and the runs above were dispatched
manually; enabling workflows in the Actions tab UI makes every future push
run automatically. (This session also fixed the docs-site lockfile, which
was missing the wasm-runtime chain npm drops from macOS-generated locks —
the first real CI runs caught it immediately.)

**Why a token rule exists at all** (the load-bearing verified fact):
`__check_auth` receives one `Context` per `require_auth` call, so the nested
XLM `transfer` the subject authorized inside the router swap needs its own
matching rule — and that rule is the only place the stock spending limit can
meter the outflow ([FACTS.md §2.5](../docs/FACTS.md)).

**Deltas recorded, not papered over.** Where the stock primitive cannot express
what was observed, the artifact says so in `notes` instead of emitting
parameters the real contract would reject: the fixture-derived artifact
([examples/context-rule.json](../examples/context-rule.json)) records its BLND
cap as a `DELTA` note because the fixture carries no authorization trees;
seconds→ledgers conversions and the install-time `valid_until` recomputation
obligation are stated in every artifact.

**Tests** (all network-free; `npm test`, wired into CI like everything else):
28 in [test/oz-context-rules.test.ts](../test/oz-context-rules.test.ts) —
`secsToLedgers` conversion (day → exactly 17280; ceil rounding), per-contract
rule split and fn dedup, token-rule derivation from the authorization tree,
real-param composition (`spending_limit`/`period_ledgers` exact values),
gross-vs-net regression at the OZ-binding level, inflow-only assets get no
rule and no cap, DELTA note instead of rejectable params, no token rules
without a subject, `validUntilLedger` computation and null + compute-at-install
note, 20-byte name cap with multibyte symbols, deterministic name
disambiguation, schema version, the merged two-hash live sequence end-to-end,
and the committed-artifact install-signature validation above. The
gross-vs-net, inflow-only, exact-scope, and >5-policy warning regressions also
remain in [test/synthesizer.test.ts](../test/synthesizer.test.ts).

### D1.3 — Generated policy compiled, tested, and deployed to testnet

**Criterion (T1 plan):** "Generated-policy compile + testnet deploy."

**Delivered 2026-08-03.** The generated `FrequencyLimitPolicy` exists as a
compiled Rust crate implementing the real OpenZeppelin `Policy` trait, its
wasm builds reproducibly, and one instance is deployed on testnet with the
on-chain wasm hash verified equal to the local build.

| Item                   | Value                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crate                  | [contracts/frequency-limit-policy](../contracts/frequency-limit-policy) — `stellar-accounts = "=0.7.2"`, `soroban-sdk = "=26.1.0"`, toolchain pinned in [rust-toolchain.toml](../contracts/rust-toolchain.toml)                                                                |
| Rust tests             | 25 (`cd contracts && cargo test --locked`): window rollover both sides of the boundary, count limit, per-(account, rule) isolation in both directions, uninstall lifecycle + fresh reinstall, install/uninstall/enforce auth guards, install-param guards, genesis-edge window |
| Emitter equality       | `renderFrequencyLimitPolicy` output is byte-identical to the crate source — locked in CI by [test/rust-policy.test.ts](../test/rust-policy.test.ts)                                                                                                                            |
| Reproducible build     | Two clean builds → identical SHA-256 `42227f2b6150c95a7084bb7c5ff2e7a40793eae39bf0c5dc95bd752d18ee6eed` (12,639 bytes; exact command in [FACTS.md §1.5](../docs/FACTS.md))                                                                                                     |
| **Contract ID**        | [`CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP`](https://stellar.expert/explorer/testnet/contract/CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP)                                                                                                        |
| Wasm upload tx         | [`5ac3320d…c082e2c`](https://stellar.expert/explorer/testnet/tx/5ac3320d84e3b2952d641f159e497a76b76c0aca74162dbcf901ecb39c082e2c) (submitted by the first script run — see the honest limits below)                                                                            |
| Deploy tx              | [`35ddaeaa…236af0`](https://stellar.expert/explorer/testnet/tx/35ddaeaa935af7233dbee577942edfcea2abda1ab12c1cd37d51b4c432236af0)                                                                                                                                               |
| Deployer               | `GATUKCIM…KS3W` (testnet-only identity from the gitignored `.env`)                                                                                                                                                                                                             |
| On-chain == local wasm | [scripts/deploy-testnet.sh](../scripts/deploy-testnet.sh) fetches the on-chain wasm back (`stellar contract fetch --id … --network testnet`) and hard-fails on any SHA-256 mismatch; full record in the [Deployment log](#deployment-log)                                      |

**How a reviewer verifies it end to end:**

```bash
cd contracts && cargo test --locked && cd ..                        # 25 Rust tests
npm test                                                            # incl. the byte-equality lock
(cd contracts && rm -rf target && stellar contract build --package frequency-limit-policy)
shasum -a 256 contracts/target/wasm32v1-none/release/frequency_limit_policy.wasm
# → 42227f2b6150c95a7084bb7c5ff2e7a40793eae39bf0c5dc95bd752d18ee6eed
stellar contract fetch --id CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP \
  --network testnet -o /tmp/onchain.wasm && shasum -a 256 /tmp/onchain.wasm   # → same hash
```

**CI run for this deliverable:**
[run 30787953610](https://github.com/kunal-drall/policywright/actions/runs/30787953610)
— dispatched manually (fork; see the D1.2 CI-trigger note) on commit
`b669d06`, all three jobs green: `build` (lint → format → typecheck → 90
Vitest tests → demo), `site` (docs build), and the new `contracts` job
(`cargo fmt --check` → `clippy -D warnings` → 25 tests, on the pinned
1.97.1 toolchain).

**Honest limits.** (1) The contract is **unaudited** — the banner stays on
every generated file and the audit is a Tranche 3 deliverable. (2) A second
instance `CBZHVZJF…4BHS` (same wasm hash) exists from an interrupted first run
of the deploy script — it died between deploying and hash-verifying because
it grepped for a stderr line stellar-cli 27.1.0 does not print
([FACTS.md §5](../docs/FACTS.md) records both instances; the evidence cites
the fully verified one). (3) The deployed policy has not been **installed
into a smart account on-chain** — `enforce` has run only in the unit tests;
installing rules + policies on a live smart account is wallet-integration
work, deferred with T2 ([T2-NOTES.md](../docs/T2-NOTES.md)).

### D1.4 — Public MIT repo, green CI, evidence pack

**Criterion (T1 plan):** "Open-source CLI + CI" — specifically: public MIT
repo, green CI, `npm run demo` produces artifacts, plus the tranche evidence
pack that makes review trivial.

**Delivered 2026-08-03.**

| Item           | Value                                                                                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public repo    | <https://github.com/kunal-drall/policywright> (public; description + topics set — `gh repo view kunal-drall/policywright --json isPrivate,description,repositoryTopics`)                                                                                                                                     |
| License        | MIT — [LICENSE](../LICENSE), `license` field in [package.json](../package.json). The repo was Apache-2.0 until 2026-08-03 and was switched to MIT per the funded plan; every commit is by the project author (both git identities — `git shortlog -sne --all`), so no third-party consent was needed         |
| CI             | lint → format:check → typecheck → test → demo → live dry-run report diff (both modes) → side-by-side artefact diff (with `synth.args`), plus a docs-site build and the contracts job (fmt → clippy → tests → three wasm builds asserted against the deployed hashes) ([ci.yml](../.github/workflows/ci.yml)) |
| Demo artifacts | `npm run demo` writes `spec.json`, `context-rule.json`, `summary.txt`, `simulation-report.md`, `FrequencyLimitPolicy.rs` to `out/` and exits non-zero unless all 6 dry-run scenarios behave as expected (byte-identical committed copies under [examples/](../examples/) — hashes in D3)                     |
| Evidence pack  | This file — one section per deliverable with its criterion, what was delivered, and the exact reproduction commands                                                                                                                                                                                          |
| Demo script    | Maintained as an internal team document (not tracked in this repository); every expected-output block in it is produced by really running the command shown                                                                                                                                                  |
| Housekeeping   | [.env.example](../.env.example) (no secrets; documents the `STELLAR_RPC_URL` pitfall from FACTS §1.6), [CONTRIBUTING.md](../CONTRIBUTING.md), `.gitignore` covers `.env` and `out/` (see [Secrets hygiene](#secrets-hygiene))                                                                                |
| Recorded demo  | [Loom, 4:35](https://www.loom.com/share/c5d5dea5fab8498fb31c1044ed3cf3a7) — the five-beat demo: fresh claim→swap recording by hash, synthesis with real OZ install params, dry-run, and the deployed contract's on-chain wasm hash verified live (public link verified 2026-08-09)                           |

**How a reviewer verifies it end to end (no secrets needed):**

```bash
git clone https://github.com/kunal-drall/policywright && cd policywright
head -3 LICENSE                                       # MIT License
npm ci
npm run lint && npm run format:check && npm run typecheck && npm test   # 90 tests
npm run demo && ls out/                               # 5 artifacts, exit 0
(cd contracts && cargo test --locked)                 # 25 Rust tests
```

**CI run for this deliverable:**
[run 30839117017](https://github.com/kunal-drall/policywright/actions/runs/30839117017)
— dispatched manually (fork; see the D1.2 CI-trigger note) on commit
`99fc1b2`, all three jobs green: `build` (lint → format → typecheck → 90
Vitest tests → demo), `site` (docs build), and `contracts` (fmt → clippy `-D
warnings` → 25 Rust tests → `stellar contract build`, whose Linux-built wasm
hashed **identically** to the macOS-recorded reproducible hash
`42227f2b…6eed` — cross-platform reproducibility now recorded in
[FACTS.md §1.5](../docs/FACTS.md) and asserted by CI since).

**Corrections this deliverable made while removing unprovable claims:** the
README claimed the project was "Stellar SCF #43 ('OZ accounts policy
builder')" — the public SCF portal (checked 2026-08-03) lists policywright
under **SCF #44** with submission title **"Record-to-Policy MCP + Agent
skill"** ("OZ accounts policy builder" is a different SCF #44 project, by
Gateway.fm); the README CI badge pointed at the stale parent repository
instead of this one, where CI actually runs.

**Honest limits.** (1) Push-triggered CI still does not fire on this fork
until workflows are enabled from the Actions tab (D1.2 note); every cited run
is a manual dispatch of exactly the committed workflow. (2) The cited run
executed the wasm-hash step in its original _report_ form; the hash matched,
so the step was tightened to a hard assert immediately after — the assert
form is exercised by every subsequent dispatched run. (3) GitHub's license
auto-detection may lag the LICENSE file change briefly.

### D2 — Least-privilege synthesizer

**Delivered.** [src/synthesizer.ts](../src/synthesizer.ts) turns a `RecordedTx`
into a `SmartAccountSpec`.

| Property                                                     | Verify                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Scope binds to exactly the observed `(contract, fn)` pairs   | `npm run cli -- synth`; [test/synthesizer.test.ts](../test/synthesizer.test.ts) |
| Spend caps derive from **gross** outflow, not net            | BLND is claimed then swapped (nets ~0) yet is still capped — see the summary    |
| Assets that only flow **in** get no cap (minimal permission) | USDC receives no spending-limit policy in `spec.json`                           |
| Policy count is checked against OZ's `MAX_POLICIES`          | [src/synthesizer.ts](../src/synthesizer.ts) emits a warning past 5              |

`MAX_POLICIES = 5` is verified against OZ source, not assumed
([FACTS.md §2.3](../docs/FACTS.md)).

### D3 — Emitter

**Delivered.** Four artefacts per run: `spec.json`, `context-rule.json` (since
D1.2), `summary.txt`, and an illustrative Rust policy. A committed example run
is checked in under [examples/](../examples/) so a reviewer can read the output
without running anything.

SHA-256 of the committed artefacts as of 2026-09-02 (post-D2.5; the fixture
and the Rust are unchanged since D1.3. Schema v2 (emitter fixes E1–E5) changed
every `context-rule.json`: relative `lifetimeLedgers`, `signers` in the real
`Signer` shape, deployed policy `address`es, an `installTargets` echo. The
`examples/live/fresh/` set is the installable artifact — emitted with the
flags in `synth.args` — that D2.5 installed on testnet):

```
8f91c68ef1fd16aba90f9a76b9491ed702e5bef7ab9e8ec892ef79888351db5e  examples/FrequencyLimitPolicy.rs
0dec4d4e1945d590e464e6fbe920c1467bd2bc9b1ed0b1765fbb58dd3941f762  examples/spec.json
fe669eaf38ab4448755e3b20e267cfccbf3f054f5f16484b766dc8e7615c2fd5  examples/summary.txt
7265e0669c37cfa6905c82edbda461e7a0ac2e86c10a2aa6f65656e8fedfec44  examples/simulation-report.md
cbfc72ed398d93e5bc22893de7c0d0076a7ceb269c06d965ff0c9d816631f236  examples/context-rule.json
d5321addfb8a11f8d32828c0da5a92902bc5e3897db362eaa13b2360256a903e  examples/live/context-rule.json
360c71478d091ab0d98055eb5840f115ec720eb0685de44a186a54b8693efd31  examples/live/simulation-report.md
cb71f71ede75858ba702cef99d80aa0fc2627f2314aed17f12ee3f5fa3040253  examples/live/simulation-report.constrained.md
230d7686a6098b427432cc00a2d7e4a30e6b18021d5ba678d6970faaf0666a50  examples/live/fresh/spec.json
391a4330f8bcc33fdc2815ff41c4d062e2e6c8541d5933b5a08f3dd4c0df111b  examples/live/fresh/summary.txt
b74574fcecf25131b48ee95591283074ddd77c4f23fd277ec4b8cf70795a0017  examples/live/fresh/context-rule.json
8f91c68ef1fd16aba90f9a76b9491ed702e5bef7ab9e8ec892ef79888351db5e  examples/live/fresh/FrequencyLimitPolicy.rs
a6a038b6a596da71ac4912c43545e0a4b06df5f0a192c721f7df3ebacdad9ecc  examples/live/fresh/synth.args
0dd46d1d48664534f0324c4a606f1f2ba5e8ce0da0ec2c5723424372f85131aa  fixtures/recorded-tx.json
```

Reproduce with `npm run demo && shasum -a 256 out/*` — `out/` should match
`examples/` byte for byte; the two `examples/live/simulation-report*.md` files
are reproduced by the D2.3 commands above and `examples/live/fresh/` by the
D2.4 `synth --out` command (CI diffs all of them on every run).

### D4 — Generated Rust conforms to the real OZ `Policy` trait

**Delivered, and verified against source.** The emitted contract implements
`install` / `enforce` / `uninstall` with signatures matching
`OpenZeppelin/stellar-contracts` at tag `v0.7.2`. There is no `can_enforce`
hook and `enforce` rejects by panicking — both confirmed from the trait
definition, not from memory.

| Verify                     | How                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| The trait's real shape     | [FACTS.md §2.1](../docs/FACTS.md) quotes the pinned source + link                                   |
| What policywright emits    | [examples/FrequencyLimitPolicy.rs](../examples/FrequencyLimitPolicy.rs)                             |
| Why it is generated at all | OZ ships no stock frequency policy ([FACTS.md §2.4](../docs/FACTS.md)) — compose-first is satisfied |

**Honest limit, updated by D1.3.** The generated Rust now compiles and passes
25 unit tests against the real trait as the crate
[contracts/frequency-limit-policy](../contracts/frequency-limit-policy)
(emitter output byte-identical — [test/rust-policy.test.ts](../test/rust-policy.test.ts);
reproducible wasm build — [FACTS.md §1.5](../docs/FACTS.md)), and one instance
is deployed to testnet ([Deployment log](#deployment-log)). It has still
**never been audited**. It carries this banner verbatim, on every generated
file:

> Generated contracts are illustrative and unaudited — not for production
> deployment until the Audit Bank audit.

Check it survives: `npm run demo && head -12 out/FrequencyLimitPolicy.rs`.

### D5 — Offline dry-run harness

**Delivered.** Six scenarios — one permit, four denies, one flag — each with a
machine-checked expected decision. (Since D2.3 the unobserved-route scenario is
the recorded swap re-routed through the network's native XLM asset contract,
and every report carries a provenance header — see
[D2.3](#d23--dry-run-harness--argument-level-scope).)

```
$ npm run demo
| replay recorded flow                         | ✅ permit (permit)            |
| over the spend cap                           | ⛔ deny (spending-limit)      |
| call to an unseen function                   | ⛔ deny (scope)               |
| call after rule expiry                       | ⛔ deny (lifetime)            |
| over the frequency limit                     | ⛔ deny (frequency-limit)     |
| BLND→XLM swap (route through unobserved XLM) | ⚠️ flag (argument-constraint) |
All 6 dry-run scenarios behaved as expected.
```

Source: [src/simulate.ts](../src/simulate.ts). Report:
[examples/simulation-report.md](../examples/simulation-report.md).

**Honest limit.** The `lifetime` deny case models Unix time. OZ compares
`valid_until` against a **ledger sequence**, so this scenario is internally
consistent but does not model on-chain expiry. Since D1.2 the _emitted_
`context-rule.json` carries `valid_until` as a ledger sequence with the
conversion basis stated; the offline simulator still reasons in seconds.

### D6 — CLI, tests, and CI

**Delivered.**

| Item                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI                 | [src/cli.ts](../src/cli.ts) — `synth`, `simulate`, `record`, with synthesis knobs as flags                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Test suite          | 174 Vitest tests across 8 files — `npm test` (23 run every decoder against the committed raw captures, including the fresh claim→swap re-assembly; 28 cover the D1.2 OZ context rules; 24 cover the D2.3 harness on the real sequence; 30 cover the D2.4 compose/generate boundary, install-shape validation and ScVal encoding; 29 cover the D2.5 artifact→call-args mapping, AuthPayload/digest, emitter fixes E1–E5 and the verify diff; 4 lock the emitted Rust byte-identical to the compiled crate — all network-free) — plus 25 Rust tests in [contracts/](../contracts/) (`cargo test --locked`; the vendored OZ account adds its own 2) |
| Coverage thresholds | `synthesizer.ts` 95.66% lines, `simulate.ts` 99.47% lines (re-run 2026-09-02 after D2.5); both gated ≥90 in [vitest.config.ts](../vitest.config.ts) — `npm run test:coverage`. The install/verify RPC layers are exercised on testnet (D2.5), not by unit coverage                                                                                                                                                                                                                                                                                                                                                                               |
| CI                  | lint → format:check → typecheck → test → demo → live dry-run report diff (both modes) → side-by-side artefact diff (with `synth.args`), plus a docs-site build and the contracts job (fmt → clippy → tests → three wasm builds asserted against the deployed hashes) ([ci.yml](../.github/workflows/ci.yml))                                                                                                                                                                                                                                                                                                                                     |

### D7 — Documentation site

**Delivered.** Astro + Starlight, fully static, under [site/](../site/), built in
CI on every push. Published at <https://policywright.lemmalabs.space>. The
required unaudited banner is a fixed component
([UnauditedBanner.astro](../site/src/components/UnauditedBanner.astro)).

### D8 — Verified-facts record

**Delivered.** [docs/FACTS.md](../docs/FACTS.md) records every external fact the
code depends on, each with the pinned source and the date it was checked. The
two divergences it recorded between policywright's emitted spec and the OZ
shapes it targets (`valid_until` units; context-rule scope granularity) were
**closed by D1.2**: the emitted `context-rule.json` now uses the real shapes,
and [docs/RECONCILIATION.md](../docs/RECONCILIATION.md) rows 11–15 carry the
delivered status with test references.

---

## Delivered — Tranche 2

### D2.3 — Dry-run harness + argument-level scope

**Criterion (approved, verbatim):** "The harness outputs a permit/deny/flag
report for a generated policy including an argument-constrained case (BLND→XLM
denied when enabled); tests green."

**Delivered 2026-09-02.** Argument-level scope is promoted from the T1-era
"landed early, off by default" footnote to supported T2 scope: config-gated,
**default off** (constraints are an opt-in tightening), with the derivation
rule stated explicitly and its limits written down. The harness runs against
the **real** recorded claim→swap sequence and reports the criterion case both
ways.

**The two commands and the two committed reports** (offline; the input is the
D1.4 recorder output, proven byte-identical to its raw captures by
`test/recorder.test.ts`):

```bash
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json
# committed: examples/live/simulation-report.md          (constrainArguments: false)
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json --constrain-arguments
# committed: examples/live/simulation-report.constrained.md  (constrainArguments: true)
```

The criterion row from each committed report, verbatim:

| Mode                      | Row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| disabled (default) → flag | `\| BLND→XLM swap (route through unobserved XLM) \| ⚠️ flag (argument-constraint) \| dry-run harness only — advisory, no on-chain artifact \| permitted with a scope gap (constrainArguments is off, so this constraint is advisory): swap_exact_tokens_for_tokens arg[2] path (rule swap-path) must stay within the observed token set {BLND CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF, USDC CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}; candidate routes through unobserved XLM CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC; enable --constrain-arguments to deny it \|` |
| enabled → **deny**        | `\| BLND→XLM swap (route through unobserved XLM) \| ⛔ deny (argument-constraint) \| dry-run harness only — no on-chain artifact yet \| argument constraint violated: swap_exact_tokens_for_tokens arg[2] path (rule swap-path) must stay within the observed token set {BLND CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF, USDC CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}; candidate routes through unobserved XLM CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \|`                                                                                                          |

Each report is self-describing: it states the recording (tx `9fff676c…` Blend
claim + `ae943f99…` Soroswap swap, subject `GBMWJIAD…`), the **generated
policy set** it was evaluated against (context rule `pw:claim+swap`; the BLND
spending limit, the frequency limit, and — when enabled — the argument
constraint, each annotated with how it is realised on-chain), the mode, a
decision legend, an **Enforced by** column per row, and the token addresses.

**How each word of the criterion is met**

| Criterion words             | What shipped                                                                                                                                                                                                                                                                  | Verify                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| "permit/deny/flag report"   | Six scenarios: 1 permit, 4 denies (spend cap, scope, lifetime, frequency), and the argument case as flag or deny; Markdown report with provenance header and legend                                                                                                           | both committed reports; `renderReport` in [src/simulate.ts](../src/simulate.ts)                                                           |
| "for a generated policy"    | The report header lists the synthesised policy set (`pw:claim+swap`: spending-limit BLND ≤ 2.3533505/86400 s, frequency-limit ≤ 5/86400 s, argument-constraint `swap-path` when enabled)                                                                                      | header lines of both reports                                                                                                              |
| "argument-constrained case" | Derived from the real swap by the explicit `swap-path` rule: `swap_exact_tokens_for_tokens arg[2] path ⊆ {BLND, USDC}`                                                                                                                                                        | `spec.argumentScopes` via `npm run cli -- synth --input examples/live/recorded-claim-swap-fresh.json`; [FACTS.md §12.3](../docs/FACTS.md) |
| "BLND→XLM"                  | The recorded swap (same `amount_in`, `amount_out_min`, `to`, `deadline`, same BLND outflow) with `path` redirected to `[BLND, XLM]`, XLM being the testnet native Stellar Asset Contract `CDLZFC3S…` — derived from the network passphrase and never present in the recording | [FACTS.md §12.1–12.2](../docs/FACTS.md); `test/harness.test.ts` "the fresh recording never touched XLM…"                                  |
| "denied when enabled"       | `--constrain-arguments` → `⛔ deny (argument-constraint)` with the reason naming rule, call, argument index, allow-set, and offending token; default → `⚠️ flag`, permitted with the scope gap named                                                                          | the two rows above; CI diff step                                                                                                          |
| "tests green"               | 115 Vitest tests (24 new in `test/harness.test.ts`, 1 new in `test/recorder.test.ts`), `npm run demo`, lint, format, typecheck — all green locally and in CI                                                                                                                  | `npm test`; CI run below                                                                                                                  |

**Derivation rules and limits** (documented in the README section
[Argument-level scope](../README.md#argument-level-scope---constrain-arguments)
and [docs/architecture.md](../docs/architecture.md)): the exported rule table
`ARGUMENT_DERIVATION_RULES` has one rule, `swap-path` — every call whose name
contains `swap`, first argument that is a non-empty vector of
contract-address-shaped strings, set of observed tokens. Limits stated:
set semantics only (no ordering, hop count, amounts); `swap-path` is the only
rule; address check is a StrKey shape check, not a checksum; **enforcement is
offline-only** — no stock OZ policy expresses argument scoping, so
`context-rule.json` records it as a DELTA note and on-chain enforcement is the
remaining T2 policy-codegen deliverable (not built; not claimed here).

**Tests** (`npm test`, network-free, wired into CI) —
[test/harness.test.ts](../test/harness.test.ts): _native XLM Stellar Asset
Contract_ (testnet address equals the recorder's live-resolved `native`; distinct
contract-shaped address per network; the fresh recording never touched XLM);
_argument-constraint derivation on the real sequence_ (rule table is exactly
`swap-path`; derives `{BLND, USDC}` at arg[2]; claim's `Vec<u32>` is not a route;
derived in both modes, enforced only when enabled; DELTA note wording);
_criterion: BLND→XLM denied when enabled, flagged (permitted) when disabled_
(both modes on the real args; observed BLND→USDC permitted in both; no-route
candidate unaffected); _probe token_ (native SAC default; synthetic fallback when
XLM was observed — the older `2dcff6…` recording; override accepted, non-address
rejected); _buildScenarios on the real sequence_ (all six scenarios behave as
expected in both modes; criterion scenario built from the REAL call with only the
path changed; `--probe-token` honoured); _report rendering_ (provenance header,
enforced/advisory legends, deny and flag rows, bare table without context);
_committed reports are reproducible_ (both files byte-equal to the harness
output). [test/recorder.test.ts](../test/recorder.test.ts): _fresh claim → swap
sequence from committed captures_ re-assembles byte-for-byte into the committed
recording. CI additionally regenerates both reports with the CLI and `diff`s them
([ci.yml](../.github/workflows/ci.yml), step "Live dry-run reports (both modes)
match the committed copies").

**CI run for this deliverable:**
[run 33561221471](https://github.com/kunal-drall/policywright/actions/runs/33561221471)
— all three jobs green on commit `82e9fd9` (`build`: lint → format → typecheck
→ 115 tests → demo → both live reports diffed against the committed copies;
`site`: docs build; `contracts`: fmt → clippy → 25 Rust tests → wasm hash
`42227f2b…`). Dispatched manually (fork — see the D1.2 CI-trigger note). The
report rows quoted above include the **Enforced by** column added by D2.4 the
same day; the D2.4 run below covers that state.

**Honest limits.** (1) Enforcement is offline: the installed OZ rule would
permit BLND→XLM until an argument-checking policy exists (T2 codegen). (2) Set
semantics: a route through only-observed tokens is allowed in any order or hop
count. (3) The probe is XLM by construction; a route through any other
unobserved token is equally denied/flagged (`--probe-token` demonstrates it) but
only the XLM case is committed. (4) The recording's subject is a G-account, not
a smart account; the harness reasons about the synthesised rule, not about an
installed one — installation is D2.5.

---

### D2.4 — Composed configuration + generated stateful policy

**Criterion (approved, verbatim):** "Generates both a composed-policy
configuration and a net-new stateful policy contract; both compile and pass
simulation."

**Delivered 2026-09-02.** From the real recorded claim→swap sequence, one
command emits both artifacts side by side; the compose-first decision that
puts each constraint on one side or the other is now an explicit, documented,
tested boundary ([docs/compose-vs-generate.md](../docs/compose-vs-generate.md)).

```bash
npm run cli -- synth --input examples/live/recorded-claim-swap-fresh.json --out examples/live/fresh
# examples/live/fresh/context-rule.json       — the COMPOSED configuration: stock:spending_limit on rule pw:xfer:BLND
# examples/live/fresh/FrequencyLimitPolicy.rs — the GENERATED stateful policy: byte-identical to contracts/frequency-limit-policy/src/lib.rs
# examples/live/fresh/spec.json, summary.txt  — the spec both were derived from
```

| Artifact                                                                                                      | Compiles                                                                                                                                                                                                                                                                                                                                         | Passes simulation                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Composed** — [examples/live/fresh/context-rule.json](../examples/live/fresh/context-rule.json)              | Validates field-by-field against the OZ v0.7.2 install signature ([src/install-shape.ts](../src/install-shape.ts), every check citing its OZ line — table below) with **zero violations**, and its params encode to the exact sorted `ScMap` the contract's `AccountParams` decodes (XDR pinned in the test; [FACTS.md §13.1](../docs/FACTS.md)) | `over the spend cap` → `⛔ deny (spending-limit)`, **Enforced by** `composed stock:spending_limit on rule pw:xfer:BLND`; `replay recorded flow` → `✅ permit`                                                                       |
| **Generated** — [examples/live/fresh/FrequencyLimitPolicy.rs](../examples/live/fresh/FrequencyLimitPolicy.rs) | `cargo test --locked` → 25 Rust tests pass; `stellar contract build` → wasm SHA-256 `42227f2b6150c95a7084bb7c5ff2e7a40793eae39bf0c5dc95bd752d18ee6eed` (= the D1.3 deployed hash, re-run 2026-09-02, [FACTS.md §13.2](../docs/FACTS.md)); the emitted file is byte-identical to the crate (`cmp`, and locked in the test)                        | `over the frequency limit` → `⛔ deny (frequency-limit)`, **Enforced by** `generated custom:FrequencyLimitPolicy (FrequencyLimitPolicy.rs) on rules pw:claim, pw:swap`; the Rust tests exercise the same rolling window on-contract |

**The composed params, field by field** (emitted value → the OZ check it passes):

| Emitted (`pw:xfer:BLND`)                            | OZ install signature                                                                                         | Check                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `spending_limit: "23533505"` = ⌈21394095 × 1.1⌉     | `SpendingLimitAccountParams.spending_limit: i128` — `spending_limit.rs:88-94`                                | `> 0` → passes the `InvalidLimitOrPeriod` guard `:380-382`                                                                 |
| `period_ledgers: 17280`                             | `SpendingLimitAccountParams.period_ledgers: u32` — `:88-94`                                                  | `> 0` → passes `:380-382`; = 86400 s at 5 s/ledger = OZ `DAY_IN_LEDGERS`                                                   |
| exactly those two fields                            | struct decode via `FromVal`                                                                                  | no extra or missing field                                                                                                  |
| rule type `CallContract(CB22KRA3… BLND)`            | `OnlyCallContractAllowed` — `:376-378`                                                                       | CallContract ✓                                                                                                             |
| `observedFns: ["transfer"]`                         | `enforce` meters `fn_name == "transfer"`, amount `args[2]` — `:222-294`                                      | bound to a transfer rule ✓                                                                                                 |
| `name: "pw:xfer:BLND"` (12 bytes)                   | `MAX_NAME_SIZE = 20` bytes — `smart_account/mod.rs:522-530`                                                  | ✓                                                                                                                          |
| 1 policy, 1 signer `Delegated(GATUKCIM…KS3W)`       | ≥ 1 signer or policy — `mod.rs:20-21`; `spending_limit::enforce` needs ≥ 1 authenticated signer — `:232-234` | ✓ (schema v2, D2.5: the signer is emitted, not attached by hand)                                                           |
| `lifetimeLedgers: 518400`, `validUntilLedger: null` | `valid_until: Option<u32>` — `storage.rs:282`                                                                | u32 ✓ — the installer adds the live head (E1, schema v2); installed as 4983015 = 4464615 + 518400 (D2.5)                   |
| encoded `Val`                                       | sorted `ScMap { period_ledgers: u32, spending_limit: i128 }`                                                 | `AAAAEQAAAAEAAAACAAAADwAAAA5wZXJpb2RfbGVkZ2VycwAAAAAAAwAAQ4AAAAAPAAAADnNwZW5kaW5nX2xpbWl0AAAAAAAKAAAAAAAAAAAAAAAAAWcXwQ==` |

**The generated contract is stateful and segregated.** All state lives under
`FrequencyLimitStorageKey::AccountContext(smart_account, context_rule_id)` in
persistent storage (the stock-policy pattern, [FACTS.md §2.4](../docs/FACTS.md));
the Rust tests `state_is_isolated_per_smart_account`,
`state_is_isolated_per_context_rule`,
`exhausted_account_still_denied_while_other_account_passes`,
`exhausted_rule_still_denied_while_other_rule_passes`, and
`uninstall_of_one_pair_leaves_others_intact` prove the segregation in both
directions ([contracts/frequency-limit-policy/tests/frequency_limit.rs](../contracts/frequency-limit-policy/tests/frequency_limit.rs)).

**Both through the harness on the same context rule** — the three rows from
[examples/live/simulation-report.md](../examples/live/simulation-report.md),
verbatim:

```
| replay recorded flow | ✅ permit (permit) | — | within scope, lifetime, argument, spend cap, and frequency limits |
| over the spend cap | ⛔ deny (spending-limit) | composed stock:spending_limit on rule pw:xfer:BLND | outflow of 2.3533506 BLND exceeds the 2.3533505 cap per 86400s |
| over the frequency limit | ⛔ deny (frequency-limit) | generated custom:FrequencyLimitPolicy (FrequencyLimitPolicy.rs) on rules pw:claim, pw:swap | this would be call 6 within 86400s, over the cap of 5 |
```

**The decision boundary, as implemented and tested.** `realisePolicies`
([src/synthesizer.ts](../src/synthesizer.ts)) classifies every synthesised
policy: spend cap on a token the subject directly `transfer`red → **composed**
(never generated); spend cap without such a transfer → **offline-only** (DELTA
note); frequency → **generated**; argument constraints → **offline-only**.
Tests ([test/compose-boundary.test.ts](../test/compose-boundary.test.ts),
network-free, in CI): _decision boundary — realisePolicies on the real recorded
sequence_ (composes the BLND cap onto the token rule as stock spending*limit;
generates the frequency limit bound to every called-contract rule; nothing
offline-only by default and the argument constraint offline-only when enabled;
holds the compose-first invariant); \_fixture and mixed input* (fixture: BLND cap
offline-only, frequency still generated; mixed input partitions correctly into
composed + offline-only caps and a generated frequency limit; never generates a
stock-expressible constraint across synthetic single-asset specs); _composed
configuration — validates field-by-field against the OZ install signature_
(the committed artifact would install as-is; stock params on the BLND rule;
generated params on the called-contract rules; ten negative cases each
rejected with the error the real install would raise — `InvalidLimitOrPeriod`,
`FromVal`, `OnlyCallContractAllowed`, `NameTooLong`, `NoSignersOrPolicies`,
`NotAllowed`, `InvalidWindowOrLimit`, schema; ScVal encoding of both structs;
refusal to encode invalid params); _generated contract — side by side_
(byte-identical to the crate; artifacts exactly what `synth --out` emits;
banner verbatim); _both artifacts pass simulation on the same context rule_
(permit / over-cap attributed to the composed policy / repeat-within-window
attributed to the generated policy / the committed report carries both
attributions). The compose-first invariant asserted in every case: a spending
limit is never `generated`; a frequency limit is never `composed`; every binding
is `stock:*` or `custom:FrequencyLimitPolicy`; the generated Rust contains no
spend-cap code.

**CI run for this deliverable:**
[run 33618871930](https://github.com/kunal-drall/policywright/actions/runs/33618871930)
— all three jobs green on commit `4efafc0` (`build`: lint → format → typecheck
→ 145 tests → demo → both live reports and the side-by-side artefacts diffed
against the committed copies; `site`: docs build; `contracts`: fmt → clippy →
25 Rust tests → wasm hash `42227f2b…`). Dispatched manually (fork).

**Honest limits.** (1) A configuration has no compiler: "compiles" here means
it validates against every install check the real contracts perform and
encodes to the exact `Val` they decode — the D2.5 install consumes it through
that same module and nothing else. (2) The harness approximates
`spending_limit`: it caps a candidate's outflow within a seconds window,
whereas the stock policy meters `transfer` amounts per ledger window and
rejects non-`transfer` contexts; equivalent for the single-call over-cap
scenario ([RECONCILIATION-T2 row 69](../docs/RECONCILIATION-T2.md)). (3) The
frequency binding sits on the called-contract rules, not on the token rule
that carries the composed cap (row 70). (4) `validUntilLedger` in the
artifact is already in the past and must be recomputed at install (E1); the
deployed testnet instance of the generated policy is archived and must be
restored before an install ([FACTS.md §11.2](../docs/FACTS.md)) — both are
D2.5 work.

---

### D2.5 — Testnet smart account with the installed generated policy (fallback path)

**Criterion (approved, verbatim):** "A testnet smart account with an installed
generated policy; end-to-end demo recorded."

**Delivered 2026-09-02 — fallback signing path; the cohort-wallet track
remains open.** Everything below ran non-interactively in one session with the
`.env` testnet key; the human steps that remain are the BLOCKERS at the end
(the demo recording is the criterion's second clause and is still to do).

**The smart account.** OpenZeppelin ships no deployable account — the
`stellar-accounts` crate is a library ([FACTS.md §8.1](../docs/FACTS.md)) — so
the account is OZ's own example contract, vendored verbatim from
`stellar-contracts` v0.7.2 into
[contracts/multisig-account](../contracts/multisig-account), built with the
pinned toolchain, and deployed by
[scripts/deploy-account.sh](../scripts/deploy-account.sh) (`account:create`)
with the `.env` public key as its `Delegated` signer and no policies — the
constructor's `Default` admin rule, id 0.

| Item                                                         | Value                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Smart account (C-address)**                                | [`CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT`](https://stellar.expert/explorer/testnet/contract/CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT)                                                                                                                                                                                                                           |
| Account deploy tx                                            | [`89cec37e…fab458`](https://stellar.expert/explorer/testnet/tx/89cec37e9b2d10f12ebaac094c622dc0255af6f16da37bbd7764873d2bfab458) — wasm `1815dda1b96ea6d23865be8a16ffcbe0b8336d15fc0d3d5ada776c06cb17afde` (= local build), ctor `--signers '[{"Delegated":"GATUKCIM…KS3W"}]' --policies '{}'`                                                                                                    |
| Admin rule                                                   | id 0, `Default "multisig"`, 1 signer `Delegated(GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W)`, 0 policies (read back by `verify`)                                                                                                                                                                                                                                                    |
| Stock spending-limit policy (OZ wrapper, vendored)           | [`CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E`](https://stellar.expert/explorer/testnet/contract/CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E) — deploy tx [`83062a25…bb2204`](https://stellar.expert/explorer/testnet/tx/83062a259699aa45191f992f3b9639efc7146eb880a99fd95f7fe904c8bb2204), wasm `5a45420db383bfc6166519780bdf54cda976f869e441e1a4d98666e4726cbec4`     |
| Generated FrequencyLimitPolicy (D1.3 instance, **restored**) | [`CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP`](https://stellar.expert/explorer/testnet/contract/CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP) — `stellar contract restore` + extend 518400 ledgers: code entry live until ledger 4982933, instance 4982936 ([scripts/restore-testnet.sh](../scripts/restore-testnet.sh); rows in the [Deployment log](#deployment-log)) |
| Deployer / signer                                            | `GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W` — the funded testnet identity from the gitignored `.env`; the secret was never printed                                                                                                                                                                                                                                                 |

**The installed generated policy — three rules, one transaction each.** The
artifact [examples/live/fresh/context-rule.json](../examples/live/fresh/context-rule.json)
(schema v2, emitted from the real recorded claim→swap sequence with the flags in
[synth.args](../examples/live/fresh/synth.args)) was consumed **unmodified** by
`npm run cli -- install` ([src/install.ts](../src/install.ts)) — validated
against the OZ install signature first ([src/install-shape.ts](../src/install-shape.ts)),
dry-run simulated in enforcing mode
([install-dry-run-20260902T105702Z.json](../examples/live/testnet/install-dry-run-20260902T105702Z.json)),
then signed client-side and submitted
([install-20260902T105742Z.json](../examples/live/testnet/install-20260902T105742Z.json)):

| Rule (artifact) | Context                                   | Policy bound (address)                                                                       | On-chain rule id | Install tx                                                                                                                       | Ledger  | `valid_until`                   |
| --------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------- |
| `pw:claim`      | `CallContract(CAPBMXIQ… Blend pool)`      | `custom:FrequencyLimitPolicy { window_secs: 86400, max_calls: 5 }` @ `CDSVPSTS…2ZPP`         | 1                | [`2bd245b6…4b8a6e`](https://stellar.expert/explorer/testnet/tx/2bd245b67925e688a183be50e6d6c75d3d7b4eb98b0be02d23693611f44b8a6e) | 4464616 | 4983015 = head 4464615 + 518400 |
| `pw:swap`       | `CallContract(CCJUD55A… Soroswap router)` | `custom:FrequencyLimitPolicy { 86400, 5 }` @ `CDSVPSTS…2ZPP`                                 | 2                | [`065bf20b…a33dfa`](https://stellar.expert/explorer/testnet/tx/065bf20b3d6e3b8b3cd9a8e408f009a61c347e0dfaaa4a5bda40b2199aa33dfa) | 4464617 | 4983015                         |
| `pw:xfer:BLND`  | `CallContract(CB22KRA3… BLND token)`      | `stock:spending_limit { spending_limit: 23533505, period_ledgers: 17280 }` @ `CCOQPGEY…4W4E` | 3                | [`6593a5a0…771a9a`](https://stellar.expert/explorer/testnet/tx/6593a5a0440b02e8679e9f87b7031d915b35b85a6873eb23b18016e827771a9a) | 4464618 | 4983015                         |

Every rule carries the signer `Delegated(GATUKCIM…KS3W)`. The generated
`FrequencyLimitPolicy` is installed on rules 1 and 2 through **one** instance
(state keyed on `(account, rule id)` — reuse per (account, rule), RECONCILIATION-T2
row 52 confirmed on-chain); the composed stock `spending_limit` is installed on
rule 3 with the exact params D2.4 validated field-by-field.

**Verify output** ([examples/live/testnet/verify.md](../examples/live/testnet/verify.md),
`npm run cli -- verify … --install-log …`, read at ledger 4464624) — **PASS**, 15/15
rows: each rule found by `(CallContract contract, name)` as ids 1–3; signers
`Delegated:GATUKCIM…` = on-chain; policy address sets equal; params read back
from the policy contracts (`get_frequency_limit_data`: `{ window_secs: 86400,
max_calls: 5 }`; `get_spending_limit_data`: `{ spending_limit: 23533505,
period_ledgers: 17280 }`) equal the artifact; `valid_until` 4983015 equals the
install log for all three. The only installed rule not in the artifact is the
constructor's admin rule (id 0, `Default "multisig"`), listed as informational.

**Signing mode and why.** `local-fallback` — printed in every install output and
recorded in the install log: the `.env` key acts as the `Delegated(G)` rule
signer and the transaction source, so the account's authorization is proven by
`G`'s nested `__check_auth(auth_digest)` entry with `SourceAccount` credentials,
covered by the ordinary transaction signature. The primary mode — a wallets-kit +
Freighter page signing **the same transaction** via SEP-43 `signTransaction` —
was not built this session (no human with a wallet present); it is the open
cohort-wallet track and replaces only the `SigningSurface` implementation.
The recorded unsupported thing stands ([FACTS.md §8.4](../docs/FACTS.md)): no
SEP-43 wallet can sign an OZ `External` digest (`sha256(payload ‖ rule_ids)`),
which is why the `Delegated(G)` model is the wallet-compatible one.

**What the run proves that was previously unproven.** The `Delegated(G)`
nested-entry construction (RECONCILIATION-T2 row 39, "source-supported,
unproven") passed enforcing simulation and three submitted transactions with
two authorization entries each — the account's `AuthPayload` entry (fresh nonce,
expiration head + 120, `context_rule_ids: [0]`) and the hand-built
`SourceAccount` entry over `account.__check_auth(auth_digest)`. The digest math
reproduces the independent [FACTS.md §8.3](../docs/FACTS.md) vector exactly
(`test/install.test.ts`). Details: [docs/smart-account-install.md](../docs/smart-account-install.md);
facts: [FACTS.md §14](../docs/FACTS.md); rows 71–78 in
[RECONCILIATION-T2.md](../docs/RECONCILIATION-T2.md).

**Emitted artifacts install as-is (Gate 3).** The emitter fixes E1–E5 are
closed by schema v2 ([docs/context-rule-schema.md](../docs/context-rule-schema.md)):
relative `lifetimeLedgers` (the installer adds the live head — the only value
it computes); signers in the real `Signer` shape from `--signer`; deployed
policy addresses from `--policy-address`; a duplicate-address guard; corrected
notes. The install gate refuses anything else with the OZ error it would raise
(`validateContextRuleDocument(…, { forInstall: true })`). No hand-crafted
install argument exists in the flow.

**Tests** (network-free, `npm test`, in CI) — [test/install.test.ts](../test/install.test.ts):
_emitter fixes E1–E5 (schema v2)_ (version bump + `installTargets` echo;
lifetimeLedgers always and absolute only from a head; signers on every rule;
addresses or null-with-note; duplicate address caught; notes wording; malformed
targets rejected); _install-shape v2 — the installable-as-is gate_ (fresh
artifact accepted; design artifact refused naming each gap; MAX*SIGNERS and
signer shape); \_artifact → add_context_rule arguments* (Signer / ContextRuleType /
Option<u32> encodings; policies `Map<Address, Val>` with exact params; key order
by address; the five arguments in signature order; `planInstall` adds only head +
lifetime, refuses a design artifact and a stale `valid_until`); _OZ authorization
payload_ (the FACTS §8.3 vector; `AuthPayload` as the sorted `ScMap` with the
recorded XDR prefix; External signature as the 64-byte value; the Delegated
nested entry; the labelled fallback signer exposes no secret); _verify_
(`ContextRule` decoding; PASS on a matching install; install-log `valid_until`;
FAIL on a missing rule, wrong param, wrong signer, expired rule). Plus the
E1 tests in [test/oz-context-rules.test.ts](../test/oz-context-rules.test.ts)
and the D2.4 boundary tests now reading `synth.args`. Rust: the vendored
account's own 2 OZ tests run in `cargo test`; CI builds all three wasms and
asserts their hashes against the deployed ones.

**CI run for this deliverable:**
[run 33622880981](https://github.com/kunal-drall/policywright/actions/runs/33622880981)
— all three jobs green on commit `7ac99cf` (`build`: lint → format → typecheck
→ 174 tests → demo → live reports and side-by-side artefacts diffed with
`synth.args`; `site`: docs build; `contracts`: fmt → clippy → 27 Rust tests →
three wasm builds asserted against the deployed hashes `42227f2b…`,
`1815dda1…`, `5a45420d…`). Dispatched manually (fork).

**BLOCKERS — human steps (exact instructions).**

1. **Record the end-to-end demo** (the criterion's second clause). The
   script is [docs/demo-script-t2.md](../docs/demo-script-t2.md) — five
   beats ≤ 5:00, every `[EXPECT]` block a real output of 2026-09-02: the
   agent's live tool calls, the skill conversation with its clarification,
   the BLND→XLM case both ways, the install with the client-side signing
   moment, and the verify. Its install step was executed for real while
   writing it (rule ids 4–6, txs `6fee5fc8…`, `7763c0f6…`, `cdb5266d…`;
   see the [close-out section](#tranche-2-close-out--truthfulness-pass-demo-script-form));
   each recording appends the next three ids and verifies them through its
   own install log. Needs the `.env` key (present on the author's machine)
   and ~0.04 XLM of testnet fees per run. Link the recording here when done.
2. **Freighter setup for the primary signing mode** (optional for the criterion;
   required to close the cohort-wallet track without a partner): install
   Freighter 5.47+, switch it to Testnet, fund its account via friendbot
   (`https://friendbot.stellar.org?addr=<G…>`), then create an account whose
   admin signer is that wallet's `G` (`scripts/deploy-account.sh` reads the signer
   from `.env` — pass the wallet's public key by setting `STELLAR_PUBLIC_KEY` to
   it for that run, still paying fees with the `.env` secret). The install
   transaction must then be signed by Freighter (`signTransaction`) as source:
   this needs the not-yet-built wallets-kit page — the `SigningSurface`
   interface in `src/install.ts` is where it plugs in.
3. **The signing approval** — in the primary mode, the human approves the
   install transaction in Freighter; in the fallback mode used here there is no
   interactive approval (the `.env` key signs).
4. **Funding** — the `.env` identity held 9 996 XLM before this run; the three
   installs cost ~0.08 XLM in resource fees. Refund via friendbot if it drops
   below ~10 XLM.

**Not done (stated plainly).** (1) The wallet signing page (primary mode) — see
BLOCKER 2. (2) The **stretch** post-install enforcement demo (an in-scope swap
through the account succeeding, an over-cap transfer rejected on-chain): not
attempted, so as not to endanger the core flow; it needs the account's
`execute` entry point and a `__check_auth` payload selecting rules 1–3 per
context. (3) The three rules expire at ledger 4983015 (≈ 30 days) and the demo-script
run's rules 4–6 at 4588890 (≈ 2026-09-09); the restored policy entries at
4982933/4982936 — re-run `scripts/restore-testnet.sh` before a later demo if
they lapse. (4) `valid_until` for the rules was computed by the
installer from the live head (E1); the artifact itself carries the relative
lifetime — the install log is the record of the absolute value.

---

### D2.1 — MCP server

**Criterion (approved, verbatim):** "The server runs locally and an agent
calls each tool end to end; a reference session is recorded."

**Delivered 2026-09-02 — the server, the four tools, the schemas, the
network-free end-to-end suite, the registration, and the reference-session
script.** The human step that remains — running the reference session in
Claude Code and saving the transcript — is the BLOCKER at the end.

**What shipped.**

| Item               | Where                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server (stdio)     | [src/mcp/server.ts](../src/mcp/server.ts) — `npm run mcp`; `@modelcontextprotocol/server` **2.0.0** (spec `2026-07-28`, dual-era `serveStdio`), `zod` **4.5.4**, both pinned exactly ([FACTS.md §15](../docs/FACTS.md))                                                                                                                           |
| Exactly four tools | `record`, `synthesize`, `simulate`, `verify` — [src/mcp/tools.ts](../src/mcp/tools.ts). **No install/deploy/sign/submit tool** (structural rule 5); the server never signs and needs no secret                                                                                                                                                    |
| Structured I/O     | [src/mcp/schemas.ts](../src/mcp/schemas.ts) — versioned (`schemaVersion: 1`; embedded `contextRule` keeps schema v2); JSON Schemas committed under [schemas/mcp/](../schemas/mcp/) and drift-checked in CI; error envelope `{ ok: false, error: { code, message, source } }` with codes mapped from the existing taxonomies                       |
| Banner             | every `synthesize` output carries `unauditedBanner` and `rustPolicy.banner` verbatim: "Generated contracts are illustrative and unaudited — not for production deployment until the Audit Bank audit."                                                                                                                                            |
| Agent-friendliness | tool descriptions say what/when/what-next; `synthesize` returns `notes`, `warnings`, `recordingWarnings`, `scopeNotes` (minimal-permission decisions, scope gaps) and `installable` (would the CLI install it as-is, with the OZ violations otherwise); `simulate` takes the candidate-call format and returns the permit/deny/flag table as data |
| Config             | `POLICYWRIGHT_NETWORK`, `POLICYWRIGHT_RPC_URL`, `POLICYWRIGHT_ROOT` (env), per-call `network`/`rpcUrl` overrides; nothing hardcoded, no secret ever read ([docs/mcp-server.md](../docs/mcp-server.md#configuration))                                                                                                                              |
| Determinism map    | written before the code — [docs/mcp-server.md](../docs/mcp-server.md#determinism-map): `synthesize`/`simulate` pure; `record`/`verify` deterministic per (input, chain state)                                                                                                                                                                     |
| Reuse audit        | [docs/mcp-server.md](../docs/mcp-server.md#reuse-audit--what-each-tool-wraps): every tool wraps library entry points; three CLI-only compositions moved into the library (`verifyArtifact`, `recordedTxToJson`, `evaluateScenarios` — RECONCILIATION-T2 rows 79–81)                                                                               |
| Registration       | [`.mcp.json`](../.mcp.json) (Claude Code project scope; `claude mcp list` → `✓ Connected`, observed with Claude Code 2.0.76); `claude mcp add` and Claude Desktop forms in the docs                                                                                                                                                               |
| Reference session  | [docs/mcp-reference-session.md](../docs/mcp-reference-session.md) — seven turns exercising all four tools on the real recorded data and the live testnet account, with the expected tool call and result at each turn                                                                                                                             |

**How to run the server.**

```bash
npm ci
npm run mcp                        # stdio; logs to stderr only
claude mcp list                    # from the repo root: policywright … ✓ Connected
```

**Tests (network-free, `npm test`, in CI)** — [test/mcp.test.ts](../test/mcp.test.ts),
31 tests: the REAL server process is spawned over stdio (`node_modules/tsx` on
`src/mcp/server.ts`, cwd deliberately outside the repo, a fake
`STELLAR_SECRET_KEY` in its environment) and driven through
`@modelcontextprotocol/client` against a local stub RPC
([test/stub-rpc.ts](../test/stub-rpc.ts)) that replays the committed raw
`getTransaction` captures of the real claim→swap sequence, answers the SEP-41
metadata getters, and serves the testnet smart account's installed rules and
policy parameters exactly as recorded in `examples/live/testnet/`. Asserted:
the tool list is exactly the four (no install/deploy/sign/submit); the
advertised schemas equal the committed files; `record` reproduces
[recorded-claim-swap-fresh.json](../examples/live/recorded-claim-swap-fresh.json)
byte-for-byte and ingests the committed real simulation exchange; `synthesize`
reproduces every file in [examples/live/fresh/](../examples/live/fresh/) and
reports the install verdict (four violations for a design artifact, none with
the pinned targets); `simulate` reproduces both committed reports and evaluates
caller-supplied candidates; `verify` reproduces
[testnet/verify.md](../examples/live/testnet/verify.md) (PASS, 15 rows) and
FAILs correctly against an account with only its admin rule; every error code
(`BAD_INPUT`, `TX_NOT_FOUND`, `NETWORK`, `SHAPE_INVALID`, the SDK-formatted
schema error, the unknown-tool protocol error), always as a text-only
envelope (Claude Code's client validates any `structuredContent` —
[FACTS.md §15.2](../docs/FACTS.md)); the banner; `now` = the recording
timestamp; existing output files are never replaced without `overwrite`;
RPC URLs are redacted; no output contains the fake secret; environment files
are refused and non-JSON files are not echoed. Suite total: 205 tests.

**CI run for this deliverable:**
[run 33631174115](https://github.com/kunal-drall/policywright/actions/runs/33631174115)
— all three jobs green on commit `98f9271` (`build`: lint → format → typecheck
→ 205 tests incl. the 31 stdio MCP tests → MCP schema drift check → demo →
live reports and side-by-side artefacts diffed; `site`: docs build;
`contracts`: fmt → clippy → Rust tests → three wasm builds asserted against
the deployed hashes). Dispatched manually (fork).

**BLOCKER — human step (exact instructions).** The six tool calls of the
session were made from Claude Code 2.0.76 on 2026-09-02 and returned the
expected results ([FACTS.md §17.6](../docs/FACTS.md); quoted in
[docs/demo-script-t2.md](../docs/demo-script-t2.md) Beat 1); the criterion's
"recorded" clause needs the human-saved transcript. Run
[docs/mcp-reference-session.md](../docs/mcp-reference-session.md) in Claude
Code from the repository root (`npm ci`; `claude`; approve the project server),
save the unedited transcript as
`evidence/sessions/mcp-reference-session-<YYYY-MM-DD>.md` (or a screen
recording for Claude Desktop), note the client version and date, and link it
here. Turn 2 is expected to return `TX_NOT_FOUND` today (the D2.3 hashes are
past the node's ~7-day retention window — [FACTS.md §15.4](../docs/FACTS.md));
a fresh claim→swap gives the success path. Turn 6 reads the live testnet
account and passes while the D2.5 rules are live (until ledger 4 983 015,
≈ 2026-10-02).

**Not done (stated plainly).** (1) The reference session has not been run by a
human yet — the criterion's second clause. (2) The server serves the legacy
protocol era to Claude Code 2.0.76 (which speaks it to stdio servers by
default) and the `2026-07-28` era to modern clients; only the legacy handshake
was observed end to end on this machine (the client library in the tests and
the probe). (3) `record` by hash is proven against replayed captures, not a
live node, in the test suite — the live path is the reference session's
Turn 2 (and Turn 1's live token-metadata resolution).

---

### D2.2 — Claude skill

**Criterion (approved, verbatim):** "Skill packaged; a demo shows 'grant
permission to do X from this transaction' producing a reviewed policy."

**Delivered 2026-09-02 — the packaged skill, its demo script, and a
machine-executed walkthrough of that script.** The human recording of the
demo conversation is the BLOCKER at the end.

**Package.** [.claude/skills/policywright-grant/](../.claude/skills/policywright-grant/)
— `SKILL.md` (frontmatter with the six spec fields only: `name`,
`description`, `license`, `compatibility`, `metadata`, `allowed-tools`;
195-line body) plus `references/clarifications.md` (the trigger list and
question templates, written before the skill — pre-flight gate 3) and
`references/tool-io.md` (the tool I/O cheat-sheet and CLI-flag mapping).
Format per [FACTS.md §10](../docs/FACTS.md) (agentskills.io +
Anthropic's rules, fetched 2026-09-02) and §16; loadable by the installed
Claude Code (2.0.76 carries the `.claude/skills` / `SKILL.md` loader and the
`allowed-tools` handling — [FACTS.md §16](../docs/FACTS.md)).

```bash
npx --yes skills-ref@0.1.5 validate .claude/skills/policywright-grant   # → Valid skill: …
npx --yes skills-ref@0.1.5 read-properties .claude/skills/policywright-grant
```

**What the skill does.** Conversational entry point over the four MCP
tools: the user describes the delegation and supplies hashes → `record` →
`synthesize` with defaults → the rule in plain language (scope, caps,
lifetime, warnings, installable-as-is) → the clarification questions →
re-`synthesize` with the chosen config and install targets → `simulate` and
the permit/deny/flag table → hand-over of the reviewable artifacts and the
one human install command; `verify` only after the human installed.

**Clarification triggers (must ask, never assume).** T1 ambiguous cap (the
funded plan's own example: "this transferred 50 USDC — cap at 50, or allow
up to 100 over a week?"), T2 ambiguous lifetime, T3 multi-asset outflows,
T4 argument-constraint on/off, T5 any synthesize warning / `DELTA` note /
not-installable verdict, T6 assumed subject —
[docs/skill-demo-script.md § 1](../docs/skill-demo-script.md) and the
skill's `references/clarifications.md`.

**Guardrails written into the skill.** Never install, deploy, sign, or
submit (the human step is handed over verbatim); always dry-run before
"reviewed" and require `deviations: 0`; always show the unaudited banner
with generated code; never invent hashes, addresses, amounts, or windows;
surface every warning, note, and scope note; testnet only.

**Demo script.** [docs/skill-demo-script.md](../docs/skill-demo-script.md)
— "grant permission to claim my Blend yield and swap it to USDC, here are
the transactions" → the plain-language rule → clarifications T1/T2/T4/T5 →
the re-synthesis with the answers (10 % headroom over a week, 7-day
lifetime, route enforced, the D2.5 signer and policy addresses) → the dry
run (1 permit / 5 deny / 0 flag, `deviations: 0`) → hand-over → "just
install it" answered with no tool call. Expected tool calls at every turn,
with the honest live-vs-replay note for Turn 1 (the hashes are past the
node's retention window today; the script branches to the committed
recording).

**Tests (network-free, `npm test`, in CI)** —
[test/skill.test.ts](../test/skill.test.ts), 9 tests: the package structure
(name = directory, `[a-z0-9-]`, ≤ 64, no reserved words; description ≤ 1024,
no XML, says what and when; only the six spec fields; references one level
deep; body < 500 lines), `allowed-tools` = exactly the four MCP tools and no
install/deploy/sign/submit reference, the four tools driven in order, every
guardrail phrase and the banner verbatim, all six triggers with the cap first
and the funded plan's example; then the **scripted walkthrough**: every
"Expected tool call" block in the demo script and in
docs/mcp-reference-session.md is validated against the committed input
schemas and executed, in order, against the real MCP server over stdio
(shared harness [test/mcp-harness.ts](../test/mcp-harness.ts), stub RPC
replaying the committed captures) — the demo hits record → synthesize →
synthesize → simulate, is not installable before the answers and installable
after, writes the four artifacts, and ends with the dry-run table; the
reference session's six calls all succeed (record from the real simulation
exchange, synthesize, both simulations, verify PASS). Suite total: 214 tests.

**CI run for this deliverable:**
[run 33647377983](https://github.com/kunal-drall/policywright/actions/runs/33647377983)
— all three jobs green on commit `0d46381` (`build`: lint → format → typecheck
→ 214 tests incl. the 9 skill tests and the machine walkthrough → MCP schema
drift check → `skills-ref validate` → demo → live reports and side-by-side
artefacts diffed; `site`: docs build; `contracts`: fmt → clippy → Rust tests
→ three wasm builds asserted against the deployed hashes). Dispatched
manually (fork).

**BLOCKER — human step (exact instructions).** The demo's tool calls were
made from Claude Code 2.0.76 on 2026-09-02 with the expected results, and the
artifact they produced was installed into the testnet account as rule ids
4–6 and verified ([FACTS.md §17.2, §17.6](../docs/FACTS.md);
[docs/demo-script-t2.md](../docs/demo-script-t2.md) Beat 2); the criterion's
"a demo shows" clause needs the human-saved conversation. Run
[docs/skill-demo-script.md](../docs/skill-demo-script.md) in Claude Code
from the repository root (`npm ci`; `claude`; approve the project MCP
server; say Turn 1 verbatim — the skill activates on it). Expect Turn 1 to
return `TX_NOT_FOUND` today and answer with the committed recording as the
script says (or perform a fresh claim→swap on testnet first for the live
path). Check the skill asks at least T1 (cap), T2, T4 and T5 before
re-synthesizing, shows the dry-run table, shows the banner, and answers
"just install it" with the human command and no tool call. Save the
unedited transcript as `evidence/sessions/skill-demo-<YYYY-MM-DD>.md`, note
the Claude Code version and date, and link it here.

**Not done (stated plainly).** (1) The demo conversation has not been run
by a human yet — the criterion's "a demo shows" clause. (2) Whether Claude
Code 2.0.76 loads the project skill was verified statically (the loader
markers in its bundle) and by the reference validator, not by an
interactive run; the human demo is that run. (3) The skill cannot express a
cap in a different asset, a per-function cap, or differing per-asset
ceilings in one run (T3 says so and offers separate delegations).

---

### Tranche 2 close-out — truthfulness pass, demo script, form

**Not a numbered deliverable; the supporting work of 2026-09-02** that puts
the five T2 sections above in front of a reviewer honestly and makes the
three human recordings a single scripted session.

| Item                       | What shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Verify                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Truthfulness pass          | README and the docs site say in present tense what T2 shipped, with proof links, and keep T3 under Planned: the site overview no longer says "there is no MCP server, Claude skill, or wallet integration yet"; the roadmap carries a per-deliverable D2.1–D2.5 table (status, open item, evidence link) and a "Planned — Tranche 3" section; three new site pages — [the skill](https://policywright.lemmalabs.space/reference/skill/), [smart-account install](https://policywright.lemmalabs.space/reference/smart-account-install/), [dry-run harness](https://policywright.lemmalabs.space/reference/dry-run-harness/); the security page and README no longer claim the policy deploy is the only on-chain action; the on-chain argument-scoping policy is called what it is — not built, not an approved criterion (RECONCILIATION-T2 rows 102, 104)                                                                                                                                                                                                                                                                                                                                                                                                                     | `git grep -n "no MCP server\|planned — Tranche 2\|T2-early" README.md docs site/src` → nothing; the site builds (`site` CI job)                                              |
| Demo script from real runs | [docs/demo-script-t2.md](../docs/demo-script-t2.md): five beats ≤ 5:00, each `[SAY]`/`[DO]`/`[EXPECT]` with the real output of 2026-09-02 — six live MCP calls from Claude Code ([FACTS.md §17.6](../docs/FACTS.md)), the skill's clarification turn, both harness modes, the install dry run and the install itself, the verify. The install was executed: artifact [examples/live/demo/](../examples/live/demo/) (7-day lifetime and spend window, route enforced; flags in `synth.args`, diffed in CI) → rule ids **4–6**, txs [`6fee5fc8…`](https://stellar.expert/explorer/testnet/tx/6fee5fc8ab46cd221c6b807ee22c12e216d1d072e2179b4f6964c6c646e22ed6) (ledger 4467932), [`7763c0f6…`](https://stellar.expert/explorer/testnet/tx/7763c0f6a30a3e9a24944d685b5faaab2b4360e5b1a136f2f0386b5d2bb9007a) (4467933), [`cdb5266d…`](https://stellar.expert/explorer/testnet/tx/cdb5266d038768a7a7bf9e3130e5c6efdcdaf04a3e1a574e6d13e34eb459893d) (4467934), `valid_until` 4588890, `local-fallback`, 2 auth entries each — [install log](../examples/live/testnet/install-20260902T153356Z.json), [dry-run log](../examples/live/testnet/install-dry-run-20260902T153120Z.json), [verify PASS 15/15](../examples/live/testnet/verify-demo-20260902T153356Z.md) at ledger 4467941 | the "Close-out" lines of [How to verify everything at once](#how-to-verify-everything-at-once); the transaction links; `grep -c "\*\*\[EXPECT\]\*\*" docs/demo-script-t2.md` |
| `verify` re-install fix    | Installing the same artifact again appends rule ids with the same names; `verify` matched the first name hit, so the demo's verify with its own log would have failed. `findInstalledRule` ([src/verify.ts](../src/verify.ts)) now prefers the installed rule whose `valid_until` equals the install log's; proven live both ways (ids 4–6 with the new log, ids 1–3 with the D2.5 log — [FACTS.md §17.2–17.3](../docs/FACTS.md)); committed outputs unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `npx vitest run test/install.test.ts` — "matches a re-installed artifact through the install log, not the first name hit"; the two live verify commands above                |
| Retention re-check         | Every cited hash re-fetched from the public node ([FACTS.md §17.1](../docs/FACTS.md)): the T1 claim→swap hashes and the D1.3 deploy are past the ~7-day window (`TX_NOT_FOUND`); the D2.5 deploys/installs and the demo-run installs are live until ≈ 2026-09-09. The demo script records the committed real simulation exchange live and shows the honest `TX_NOT_FOUND`; a fresh claim→swap is an optional human sub-step of the video (RECONCILIATION-T2 row 103)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `curl` `getTransaction` per hash; the MCP `record` envelope quoted in the demo script                                                                                        |
| CI                         | `build` job gains `npm run build` (the MCP server entry compiles under the build config) and the demo-artifact diff; the MCP suite, the skill walkthrough, the schema drift check and `skills-ref validate` were already in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [ci.yml](../.github/workflows/ci.yml); the run cited below                                                                                                                   |
| Tranche 2 completion form  | `evidence/TRANCHE2-FORM.md` — every field's paste-ready answer with every link, hash and number verified in-session; `[BLOCKER: …]` tokens exactly where a human recording is missing; Support Needed asks for the OpenZeppelin accounts-package contact for the Tranche 3 technical-reviewer relationship                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `grep -c "\[BLOCKER" evidence/TRANCHE2-FORM.md`; `grep -n "\[link\]" evidence/TRANCHE2-FORM.md` → nothing                                                                    |

**CI run for this work:** dispatched after these commits land on `main`; cited here by the follow-up commit (fork — manual dispatch, see the D1.2 CI-trigger note).

**Not done (stated plainly).** The three human recordings (above); the
wallet signing page; the on-chain argument-scoping policy; the optional
post-install enforcement demo; GitHub Issues remain disabled on the
repository and push-triggered CI still does not fire on this fork
([FACTS.md §17.4](../docs/FACTS.md)).

---

## Not yet delivered

Stated plainly so no reviewer has to infer it.

| Item                                                             | Tranche | Status                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulated-transaction recording path                             | T1      | **Delivered** (D1.1, 2026-08-03)                                                                                                                                                                                                                                                                                                                                        |
| Compile the generated policy                                     | T1      | **Delivered** (D1.3, 2026-08-03)                                                                                                                                                                                                                                                                                                                                        |
| Deploy a generated policy to testnet                             | T1      | **Delivered** (D1.3, 2026-08-03)                                                                                                                                                                                                                                                                                                                                        |
| Resolve `valid_until` ledger-sequence mismatch                   | T1      | **Delivered** (D1.2, 2026-08-03)                                                                                                                                                                                                                                                                                                                                        |
| Resolve context-rule scope granularity                           | T1      | **Delivered** (D1.2, 2026-08-03)                                                                                                                                                                                                                                                                                                                                        |
| MCP server                                                       | T2      | **Built and evidenced** (D2.1, 2026-09-02); the human-saved reference-session transcript is the open blocker                                                                                                                                                                                                                                                            |
| Claude skill                                                     | T2      | **Built and evidenced** (D2.2, 2026-09-02); the human-saved demo-conversation transcript is the open blocker                                                                                                                                                                                                                                                            |
| Wallet integration (testnet, end-to-end)                         | T2      | **Built and evidenced — fallback path** (D2.5, 2026-09-02): OZ smart account on testnet, emitted rules installed as-is (twice) and verified on-chain, signed with the labelled local `.env` key; the end-to-end recording ([script](../docs/demo-script-t2.md)) is the open blocker; the Freighter/wallets-kit signing page is the open cohort-wallet track (not built) |
| Composed configuration + generated stateful policy, side by side | T2      | **Delivered** (D2.4, 2026-09-02)                                                                                                                                                                                                                                                                                                                                        |
| Net-new policy codegen with storage segregation                  | T2      | **Delivered** (D2.4, 2026-09-02)                                                                                                                                                                                                                                                                                                                                        |
| Dry-run harness + argument-level scope                           | T2      | **Delivered** (D2.3, 2026-09-02)                                                                                                                                                                                                                                                                                                                                        |
| Audit, mainnet, OZ validation, walkthroughs                      | T3      | Not started                                                                                                                                                                                                                                                                                                                                                             |

---

## Secrets hygiene

No secret has ever been committed. Testnet secret keys are read from a
gitignored `.env` only.

```bash
git ls-files | grep -E '^\.env' ; echo "exit=$?"   # no output — nothing tracked
git ls-files out/                                   # empty — no generated output tracked
grep -E '^\.env|^out/' .gitignore                   # both ignored
```

The live RPC adapter takes an RPC URL, not a key; the demo, tests, and CI run
with no credentials at all.

---

## Changelog

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-03 | File created. Recorded D1–D8 with reproduction steps and artefact hashes. Added the "Not yet delivered" table after correcting the README's Tranche 2 completion claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-03 | D1.1 delivered: multi-hash recording of the real claim→swap sequence (committed output + reconciliation table above), simulated-path ingestion with a committed real `simulateTransaction` exchange, typed error taxonomy, capture-driven decoder tests (58 total). Superseded D1's "live path untested / simulated path not built" limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-03 | D1.3 delivered: the generated policy as a compiled crate against the real OZ `Policy` trait (25 Rust tests; emitter byte-equality locked in CI), reproducible wasm build, and a hash-verified testnet deployment (`CDSVPSTS…2ZPP`); deploy script + deployment log added; FACTS §1.4–1.6 and §5 record the toolchain, CLI-surface, and deployment facts.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-03 | D1.2 delivered: versioned `context-rule.json` (schema v1) with installable OZ rules and real stock `spending_limit` params, emitted and committed for the real recorded sequence; field-by-field install-signature cross-check kept as a CI test; 28 new network-free tests (86 total). Closed the §4.1/§4.2 divergences.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-09-02 | Tranche 2 close-out: truthfulness pass over README and the docs site (per-deliverable T2 roadmap rows, three new reference pages, stale "planned" claims removed); `docs/demo-script-t2.md` with real outputs at every beat, including a second real install of the synthesised rules (ids 4–6, `examples/live/demo/`, install log, verify PASS); `verify` made re-install safe through the install log (`findInstalledRule`, +1 test → 215); CI gains `npm run build` and the demo-artifact diff; retention and URL re-checks recorded (FACTS §17); `evidence/TRANCHE2-FORM.md` drafted with the three human recordings as the only blockers.                                                                                                                                                         |
| 2026-09-02 | D2.2 delivered: the `policywright-grant` skill packaged in the verified format (`.claude/skills/policywright-grant/`, six spec fields, `allowed-tools` = the four MCP tools, references one level deep) with the clarification-trigger list written first, guardrails (never install/deploy, always dry-run, always the banner, never invent values), `docs/skill-demo-script.md` (the "grant permission to claim my Blend yield and swap it to USDC" conversation with expected tool calls per turn), `skills-ref validate` in CI, and `test/skill.test.ts` (structure, guardrails, triggers, and a machine walkthrough of the demo script and the reference session against the real server; shared `test/mcp-harness.ts`); 9 new tests (214 total).                                                 |
| 2026-09-02 | D2.1 delivered: the MCP server (`@modelcontextprotocol/server` 2.0.0, stdio, dual-era) with exactly four tools — `record`, `synthesize`, `simulate`, `verify` — wrapping the library; versioned Zod/JSON schemas (`schemas/mcp/`, drift-checked in CI); typed error envelope; unaudited banner on every generated-code output; `synthesize` notes/warnings/scope-notes/installable channel; env-only config, no secret; project-scope `.mcp.json`; `docs/mcp-server.md` (determinism map, reuse audit) and `docs/mcp-reference-session.md`; `verifyArtifact`, `recordedTxToJson`, `evaluateScenarios` extracted from the CLI; `verify` maps transport failures to `NETWORK` and rejects checksum-invalid accounts; 31 new stdio tests against a stub RPC replaying the committed captures (205 total). |
| 2026-09-02 | D2.5 delivered (fallback path): vendored OZ's example smart account and stock spending-limit wrapper (built from pinned source, hash-verified) and deployed both to testnet; restored the archived D1.3 policy; emitter fixes E1–E5 → `context-rule.json` schema v2 (relative lifetimes, real `Signer` shapes, deployed addresses, `installTargets`); `src/install-shape.ts` install gate; `src/install.ts` (simulate twice, hand-built `AuthPayload` + `Delegated(G)` nested entry, client-side signing, submit) and `src/verify.ts` (on-chain read-back diff) with CLI `install` / `verify`; three rules installed into `CBQ6H7IL…QHDT` (rule ids 1–3) and verified PASS; 29 new tests (174 total). The Delegated(G) path is proven end-to-end.                                                      |
| 2026-09-02 | D2.4 delivered: the compose-first boundary made explicit per policy (`realisePolicies`: composed / generated / offline-only) and documented in `docs/compose-vs-generate.md`; `src/install-shape.ts` validates `context-rule.json` field-by-field against the OZ install signature and encodes install params as the sorted `ScMap` the contracts decode; `synth --out <dir>`; both artifacts for the fresh recording committed side by side under `examples/live/fresh/` and diffed in CI; the dry-run report gains an **Enforced by** column attributing each decision to the artifact that realises it; 30 new tests (145 total); crate re-verified (25 Rust tests, wasm hash reproduced). D3 hashes refreshed.                                                                                     |
| 2026-09-02 | D2.3 delivered: argument-level scope promoted to supported T2 scope (explicit `swap-path` derivation rule, contract-address-shaped; default off); `simulate --input` and `--probe-token`; the unobserved-route scenario is the REAL recorded swap re-routed through the network's native XLM SAC; deny reasons name the violated constraint, flags say "permitted with a scope gap"; reports carry provenance; both reports for the fresh claim→swap recording committed and diffed in CI; 25 new tests (115 total). D3 hashes refreshed; `examples/live/context-rule.json` regenerated (DELTA note wording only). Scope note updated: T1 closed, T2 in progress.                                                                                                                                      |
| 2026-08-03 | D1.4 delivered: license switched Apache-2.0 → MIT per the funded plan; CI gains Rust caching and a pinned stellar-cli wasm build with hash reporting; README corrected (SCF #44 / "Record-to-Policy MCP + Agent skill" — the #43 / "OZ accounts policy builder" attribution was wrong — and the CI badge now points at this repo); completion criteria recorded per D1.x; demo script with really-executed expected outputs; `.env.example`, CONTRIBUTING.md, repo topics.                                                                                                                                                                                                                                                                                                                             |

## Deployment log

Auto-appended by [scripts/deploy-testnet.sh](../scripts/deploy-testnet.sh);
every row is re-checkable against the testnet explorer links.

### 2026-08-03T05:39:05Z — frequency-limit-policy

| Item                                          | Value                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract ID                                   | [`CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP`](https://stellar.expert/explorer/testnet/contract/CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP)           |
| Wasm hash (= local sha256, = on-chain sha256) | `42227f2b6150c95a7084bb7c5ff2e7a40793eae39bf0c5dc95bd752d18ee6eed`                                                                                                                |
| Upload tx                                     | (wasm already on-chain; no upload tx)                                                                                                                                             |
| Deploy tx                                     | [`35ddaeaa935af7233dbee577942edfcea2abda1ab12c1cd37d51b4c432236af0`](https://stellar.expert/explorer/testnet/tx/35ddaeaa935af7233dbee577942edfcea2abda1ab12c1cd37d51b4c432236af0) |
| Deployer                                      | `GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W`                                                                                                                        |

### 2026-09-02T10:51:07Z — restore CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP

| Entry                                                                        | Result                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| wasm code `42227f2b6150c95a7084bb7c5ff2e7a40793eae39bf0c5dc95bd752d18ee6eed` | restored + extended by 518400 ledgers → live until ledger New ttl ledger: 4982933                                |
| instance `CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP`          | restored + extended by 518400 ledgers → live until ledger New ttl ledger: 4982936                                |
| Signer                                                                       | `GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W` (human-initiated `stellar contract restore`, testnet) |

### 2026-09-02T10:51:48Z — spending-limit-policy

| Item                                          | Value                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract ID                                   | [`CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E`](https://stellar.expert/explorer/testnet/contract/CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E)           |
| Wasm hash (= local sha256, = on-chain sha256) | `5a45420db383bfc6166519780bdf54cda976f869e441e1a4d98666e4726cbec4`                                                                                                                |
| Upload tx                                     | (wasm already on-chain; no upload tx)                                                                                                                                             |
| Deploy tx                                     | [`83062a259699aa45191f992f3b9639efc7146eb880a99fd95f7fe904c8bb2204`](https://stellar.expert/explorer/testnet/tx/83062a259699aa45191f992f3b9639efc7146eb880a99fd95f7fe904c8bb2204) |
| Deployer                                      | `GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W`                                                                                                                        |

### 2026-09-02T10:53:50Z — multisig-account

| Item                                          | Value                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract ID                                   | [`CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT`](https://stellar.expert/explorer/testnet/contract/CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT)           |
| Wasm hash (= local sha256, = on-chain sha256) | `1815dda1b96ea6d23865be8a16ffcbe0b8336d15fc0d3d5ada776c06cb17afde`                                                                                                                |
| Upload tx                                     | (wasm already on-chain; no upload tx)                                                                                                                                             |
| Deploy tx                                     | [`89cec37e9b2d10f12ebaac094c622dc0255af6f16da37bbd7764873d2bfab458`](https://stellar.expert/explorer/testnet/tx/89cec37e9b2d10f12ebaac094c622dc0255af6f16da37bbd7764873d2bfab458) |
| Deployer                                      | `GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W`                                                                                                                        |
| Constructor args                              | `--signers [{"Delegated":"GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W"}] --policies {}`                                                                              |
