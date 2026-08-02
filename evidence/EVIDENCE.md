# EVIDENCE

What has been delivered → how a reviewer verifies it independently → the exact
links, paths, and hashes.

Every row is checkable without trusting this document. Where a claim cannot be
verified from the repository, it says so instead of claiming completion.

**Scope note.** This is Tranche 1. T1 is **in progress**, not complete — see
[Not yet delivered](#not-yet-delivered). Nothing here has been deployed on-chain;
no contract IDs in this repository are real deployments
([FACTS.md §3](../docs/FACTS.md)).

Last updated 2026-08-03.

---

## How to verify everything at once

```bash
git clone https://github.com/kunal-drall/policywright && cd policywright
npm ci
npm run lint && npm run format:check && npm run typecheck && npm test && npm run demo
```

`npm run demo` is a self-checking smoke test: it asserts each dry-run scenario
matches its expected decision and exits non-zero on any deviation. It requires no
network access and no secrets. CI runs exactly this sequence on every push and
pull request ([ci.yml](../.github/workflows/ci.yml),
[runs](https://github.com/kunal-drall/policywright/actions/workflows/ci.yml)).

---

## Delivered

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
[FACTS.md §3](../docs/FACTS.md) and stated in the fixture's own `note` field.

### D1.1 — Hardened recording layer (multi-hash, simulated path, typed errors)

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

**Delivered.** Three artefacts per run: `spec.json`, `summary.txt`, and an
illustrative Rust policy. A committed example run is checked in under
[examples/](../examples/) so a reviewer can read the output without running
anything.

SHA-256 of the committed artefacts as of 2026-08-03:

```
95f5b616de3229edfd4927bbd068faddbdffeba63c87be2170dc411881133147  examples/FrequencyLimitPolicy.rs
f3e2121fbd567242d99bee6f7dcca392cd14adeaacd07f7e17c6ef4b0ad67c41  examples/spec.json
157e92b83d7b892452281c681197f0abec1de9265983f7443d49f14fe2ea403b  examples/summary.txt
77740e716cde4432c73a3e00d70e86ef2647344cca156bfd25d7e0f7fced5947  examples/simulation-report.md
0dd46d1d48664534f0324c4a606f1f2ba5e8ce0da0ec2c5723424372f85131aa  fixtures/recorded-tx.json
```

Reproduce with `npm run demo && shasum -a 256 out/*` — `out/` should match
`examples/` byte for byte.

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

**Honest limit.** The generated Rust has **never been compiled**, tested
on-chain, or audited. It carries this banner verbatim, on every generated file:

> Generated contracts are illustrative and unaudited — not for production
> deployment until the Audit Bank audit.

Check it survives: `npm run demo && head -12 out/FrequencyLimitPolicy.rs`.

### D5 — Offline dry-run harness

**Delivered.** Six scenarios — one permit, four denies, one flag — each with a
machine-checked expected decision.

```
$ npm run demo
| replay recorded flow              | ✅ permit (permit)            |
| over the spend cap                | ⛔ deny (spending-limit)      |
| call to an unseen function        | ⛔ deny (scope)               |
| call after rule expiry            | ⛔ deny (lifetime)            |
| over the frequency limit          | ⛔ deny (frequency-limit)     |
| route through an unobserved token | ⚠️ flag (argument-constraint) |
All 6 dry-run scenarios behaved as expected.
```

Source: [src/simulate.ts](../src/simulate.ts). Report:
[examples/simulation-report.md](../examples/simulation-report.md).

**Honest limit.** The `lifetime` deny case models Unix time. OZ compares
`valid_until` against a **ledger sequence**, so this scenario is internally
consistent but does not model on-chain expiry — see
[FACTS.md §4.1](../docs/FACTS.md).

### D6 — CLI, tests, and CI

**Delivered.**

| Item                | Evidence                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI                 | [src/cli.ts](../src/cli.ts) — `synth`, `simulate`, `record`, with synthesis knobs as flags                                                     |
| Test suite          | 58 tests across 3 files — `npm test` (22 of them run every decoder against the committed raw captures, network-free)                           |
| Coverage thresholds | `synthesizer.ts` 97.38% lines, `simulate.ts` 90.47% lines; both gated ≥90 in [vitest.config.ts](../vitest.config.ts) — `npm run test:coverage` |
| CI                  | lint → format:check → typecheck → test → demo, plus a docs-site build ([ci.yml](../.github/workflows/ci.yml))                                  |

### D7 — Documentation site

**Delivered.** Astro + Starlight, fully static, under [site/](../site/), built in
CI on every push. Published at <https://policywright.lemmalabs.space>. The
required unaudited banner is a fixed component
([UnauditedBanner.astro](../site/src/components/UnauditedBanner.astro)).

### D8 — Verified-facts record

**Delivered.** [docs/FACTS.md](../docs/FACTS.md) records every external fact the
code depends on, each with the pinned source and the date it was checked,
including two verified divergences between policywright's emitted spec and the
OZ shapes it targets (§4.1, §4.2). Both are open and are stated as open in the
README rather than papered over.

---

## Not yet delivered

Stated plainly so no reviewer has to infer it.

| Item                                                  | Tranche | Status                                           |
| ----------------------------------------------------- | ------- | ------------------------------------------------ |
| Simulated-transaction recording path                  | T1      | **Delivered** (D1.1, 2026-08-03)                 |
| Compile the generated policy                          | T1      | Not started — the Rust has never been built      |
| Deploy a generated policy to testnet                  | T1      | Not started — no contract IDs exist              |
| Resolve `valid_until` ledger-sequence mismatch (§4.1) | T1      | Open, documented                                 |
| Resolve context-rule scope granularity (§4.2)         | T1      | Open, documented                                 |
| MCP server, Claude skill, wallet integration          | T2      | Not started ([T2-NOTES.md](../docs/T2-NOTES.md)) |
| Net-new policy codegen with storage segregation       | T2      | Not started                                      |
| Argument-level scope                                  | T2      | Landed early, off by default                     |
| Audit, mainnet, OZ validation, walkthroughs           | T3      | Not started                                      |

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

| Date       | Change                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-03 | File created. Recorded D1–D8 with reproduction steps and artefact hashes. Added the "Not yet delivered" table after correcting the README's Tranche 2 completion claim.                                                                                                                                                                     |
| 2026-08-03 | D1.1 delivered: multi-hash recording of the real claim→swap sequence (committed output + reconciliation table above), simulated-path ingestion with a committed real `simulateTransaction` exchange, typed error taxonomy, capture-driven decoder tests (58 total). Superseded D1's "live path untested / simulated path not built" limits. |
