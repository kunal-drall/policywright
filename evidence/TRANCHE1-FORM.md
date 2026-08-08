# SCF Build Tranche Completion Form — Tranche 1 (paste-ready)

Every link, hash, contract ID, CI run, test count, and version below was
verified 2026-08-06 – 2026-08-08 (files read, commands run, URLs fetched
publicly). The fresh claim→swap flow was executed and verified on
2026-08-08. Each numbered section contains only the final paste-ready text
for that form field; paragraphs are single lines so they paste cleanly.
Outstanding items appear as literal `[BLOCKER: …]` tokens and are listed in
[BLOCKERS](#blockers) at the end — resolve them before submitting.

---

## 1. Select your submission

```text
Policywright
```

## 2. Round

```text
SCF #44
```

## 3. Are you ready to submit your next tranche of deliverables?

```text
Yes
```

## 4. Project Stage

```text
Pre-Launch #1 - MVP
```

## 5. Telegram Username

```text
kunaldrall
```

## 6. Tranche Deliverables

```text
All four approved Tranche 1 deliverables are complete. Each is listed with its approved completion criterion and proof.

1. Hardened recording layer (live + simulated) — $5,000. Criterion: "CLI ingests a real testnet Blend claim → swap transaction by hash and outputs a structured RecordedTx; short demo recorded." Shipped: record <txHash>... --account --network fetches live transactions via Soroban RPC, decodes InvokeContract calls and CAP-67/SEP-41 token events (SAC symbol/decimals resolution with explicit fallbacks), merges multi-hash sequences into one RecordedTx, and ingests saved simulateTransaction exchanges; typed, actionable errors for not-found/retention, network, and decode failures. Proof: committed raw captures of the real testnet Blend claim → Soroswap swap (https://github.com/kunal-drall/policywright/tree/main/examples/live) and the merged RecordedTx produced from them (https://github.com/kunal-drall/policywright/blob/main/examples/live/recorded-claim-swap.json); network-free decoder tests against those captures (https://github.com/kunal-drall/policywright/blob/main/test/recorder.test.ts); demonstrated in the video with freshly executed on-chain hashes: 9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6 (Blend pool claim, 2.1394095 BLND) and ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46 (Soroswap router swap, BLND→USDC) — raw captures and the merged recording committed under examples/live/.

2. Least-privilege synthesizer — $6,000. Criterion: "from the recorded tx, emits context-rule.json + composed spending_limit params; unit tests for scope, gross-vs-net, and inflow-only cases pass in CI." Shipped: exact (contract, function) scope binding; gross-outflow spend caps (an asset received then sent nets to ~zero but is capped on its gross outflow); minimal-permission rule (received-only assets get no cap); frequency limits; installable OpenZeppelin context rules emitted with the real stock spending_limit install parameters ({spending_limit: i128, period_ledgers: u32}), unit-converted to the ledger basis, each shape carrying its OZ source citation. Proof: emitted context-rule.json from the real recorded sequence (https://github.com/kunal-drall/policywright/blob/main/examples/live/context-rule.json) with its source recording committed alongside (https://github.com/kunal-drall/policywright/blob/main/examples/live/recorded-claim-swap.json); the named unit tests green in CI (https://github.com/kunal-drall/policywright/actions/runs/30765581963); schema doc (https://github.com/kunal-drall/policywright/blob/main/docs/context-rule-schema.md).

3. Policy compilation + testnet deployment — $3,500. Criterion: "generated policy compiles and is deployed to testnet (contract ID shared)." Shipped: FrequencyLimitPolicy implementing OpenZeppelin's real Policy trait (install/enforce/uninstall, stellar-accounts 0.7.2), 25 Rust tests, emitter output locked byte-identical to the compiled crate; reproducible build — macOS hash == Linux CI hash == deployed on-chain wasm, enforced as a hard CI assert. Testnet contract ID: CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP (https://stellar.expert/explorer/testnet/contract/CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP) — deployment log and hash-verification trail in evidence/EVIDENCE.md (https://github.com/kunal-drall/policywright/blob/main/evidence/EVIDENCE.md#deployment-log). Testnet-only and unaudited by design; the Audit Bank audit is a Tranche 3 deliverable.

4. Open-source CLI, repo, and CI — $2,000. Criterion: "public repo with green CI; npm run demo produces artifacts." Shipped: public MIT repo; CI running lint, format, typecheck, 90 Vitest tests, and the offline demo, plus Rust fmt/clippy/25 tests and a pinned stellar-cli v27.1.0 wasm build; npm run demo produces all artifacts offline and exits non-zero on any deviation. Proof: repo (https://github.com/kunal-drall/policywright); green CI runs (https://github.com/kunal-drall/policywright/actions/runs/30839470749 and https://github.com/kunal-drall/policywright/actions/runs/30839117017); evidence/EVIDENCE.md maps every criterion to its proof (https://github.com/kunal-drall/policywright/blob/main/evidence/EVIDENCE.md).

Note: two Tranche 2 items landed early during T1 (the offline dry-run harness and config-gated argument-level scope, off by default). They are documented as T2 scope in the repo and are not counted toward this tranche.
```

## 7. Deliverable Verification - Video

```text
[BLOCKER: demo video not recorded yet — see BLOCKERS #1]

The video shows the full Tranche 1 pipeline live: two freshly executed testnet transactions (a Blend emissions claim and a Soroswap BLND→USDC swap) recorded by hash into one merged RecordedTx, synthesized into least-privilege OpenZeppelin context rules with the real stock spending_limit install parameters, and dry-run verified — the recorded flow permitted, over-cap and out-of-scope calls denied. It closes on the generated policy contract deployed on testnet, with the on-chain wasm hash matching the reproducible local build, an equality CI asserts on every run.
```

## 8. Additional Deliverable Verification

```text
Evidence pack (criterion → proof map): https://github.com/kunal-drall/policywright/blob/main/evidence/EVIDENCE.md

Committed raw captures + recorder/synthesizer output from the real testnet claim→swap sequence: https://github.com/kunal-drall/policywright/tree/main/examples/live

Deployed generated policy on the testnet explorer: https://stellar.expert/explorer/testnet/contract/CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP

Green CI runs (lint, typecheck, 90 Vitest tests, offline demo, docs build, Rust fmt/clippy/25 tests, reproducible-wasm-hash assert): https://github.com/kunal-drall/policywright/actions/runs/30839470749 and https://github.com/kunal-drall/policywright/actions/runs/30839117017 and https://github.com/kunal-drall/policywright/actions/runs/30787953610 and https://github.com/kunal-drall/policywright/actions/runs/30765581963

Architecture, on the docs site: https://policywright.lemmalabs.space/architecture/

Reproducible-build record (macOS == Linux CI == on-chain wasm hash): https://github.com/kunal-drall/policywright/blob/main/docs/FACTS.md#15-the-d13-build-command-and-its-reproducibility-verified-2026-08-03
```

## 9. Support Needed

```text
Two intros would help as we start Tranche 2: (1) a C-Address Tooling cohort wallet team open to being our reference integration for the record → generate → simulate → sign → install flow (deliverable D2.5), and (2) the OpenZeppelin accounts-package contact consulted for this RFP, to set up the technical-reviewer relationship our Tranche 3 plan commits to.
```

## 10. Product Testing

```text
Policywright is a developer CLI — no credentials or accounts needed. Testers need Node 22+: git clone https://github.com/kunal-drall/policywright && cd policywright && npm ci && npm run demo runs the full pipeline offline and self-verifies (re-verified from a fresh clone on 2026-08-06). The live path (npm run record -- <txHash> --network testnet) works with any contract-invoking testnet transaction hash inside the RPC's ~7-day retention window (re-verified live on 2026-08-06). Docs: https://policywright.lemmalabs.space. Feedback via GitHub issues. [BLOCKER: Issues are disabled on the repo — see BLOCKERS #3]
```

---

## BLOCKERS

Three human steps stand between this file and submission. Every `[BLOCKER]`
token above maps to exactly one item here.

_Resolved 2026-08-08: the fresh claim→swap hashes (formerly blocker #1) were
executed, verified SUCCESS on RPC, captured, and committed under
[examples/live/](../examples/live/); field 6.1 and the demo-script `[EXPECT]`
blocks now carry the real values._

1. **Demo video** (field 7; also "short demo recorded" in field 6.1's
   criterion). Record following [docs/demo-script.md](../docs/demo-script.md)
   **before ~2026-08-15**, while the fresh hashes are inside the RPC's
   ~7-day retention window. Upload public (YouTube or Loom), test the link
   in a logged-out/incognito window, then paste the URL into field 7 and
   into the "Recorded demo" row of [EVIDENCE.md](EVIDENCE.md).

2. **Push-triggered CI (fork consolidation).** Verified 2026-08-06: an
   empty-commit push (`e3dc054`) triggered no workflow run, although the
   workflow state is "active" and manual dispatches succeed — every green run
   cited in fields 6/8 is a manual dispatch of the committed workflow, as the
   repo itself discloses. Do not claim "CI runs on push" anywhere until fixed.
   Steps: open <https://github.com/kunal-drall/policywright/actions> in a
   browser and click the enable-workflows banner if one is shown; if there is
   none, use Settings → General → Danger Zone → "Leave fork network" to
   detach the repository from its parent, then push any commit and confirm a
   run with event `push` appears.

3. **GitHub issues are disabled** (field 10's feedback sentence). Enable via
   repo Settings → General → Features → Issues (one checkbox), or
   `gh api -X PATCH repos/kunal-drall/policywright -f has_issues=true`, then
   delete the `[BLOCKER]` token in field 10.

Once all four are resolved: open every URL in this file in an incognito
window, top to bottom, then submit.
