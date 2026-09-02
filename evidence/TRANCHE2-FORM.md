# SCF Build Tranche Completion Form — Tranche 2 (paste-ready)

Every link, hash, contract ID, rule id, CI run, test count, and version below
was verified on 2026-09-02 (files read, commands run, URLs fetched publicly,
transactions re-fetched from the public testnet RPC — `docs/FACTS.md` §17).
Each numbered section contains only the final paste-ready text for that form
field; paragraphs are single lines so they paste cleanly. Outstanding items
appear as literal `[BLOCKER: …]` tokens and are listed in
[BLOCKERS](#blockers) at the end — resolve them before submitting. They are
exactly the three human recordings.

The field list mirrors the Tranche 1 form (`evidence/TRANCHE1-FORM.md`, an
internal document); the SCF Handbook does not publish the form's field names
or dropdown options (FACTS §17.5), so where a field is a dropdown the answer
below is the selection to make.

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

Selection note (not paste text): the Tranche 1 form selected
"Pre-Launch #1 - MVP". The dropdown's options are not public; if the live
form offers a Tranche 2 / testnet stage (the handbook calls Tranche #2
"Testnet Expansion"), select that one instead — the project is still
pre-launch (testnet only, no mainnet deployment).

## 5. Telegram Username

```text
kunaldrall
```

## 6. Tranche Deliverables

```text
All five approved Tranche 2 deliverables are built and evidenced; each is listed with its approved completion criterion, what shipped, and proof. Three human recordings are attached separately (fields 7 and 8). Evidence pack with the verbatim criterion, what shipped, and the exact verification commands per deliverable: https://github.com/kunal-drall/policywright/blob/main/evidence/EVIDENCE.md#delivered--tranche-2

1. MCP server. Criterion: "The server runs locally and an agent calls each tool end to end; a reference session is recorded." Shipped: npm run mcp serves exactly four tools over stdio — record, synthesize, simulate, verify — on @modelcontextprotocol/server 2.0.0; there is no install/deploy/sign/submit tool by design and the server never reads a secret; versioned JSON Schemas committed and drift-checked in CI; typed error envelope; the unaudited banner on every generated-code output; Claude Code registration from the committed .mcp.json (claude mcp list → Connected). Proof: source https://github.com/kunal-drall/policywright/tree/main/src/mcp ; schemas https://github.com/kunal-drall/policywright/tree/main/schemas/mcp ; design, determinism map and reuse audit https://github.com/kunal-drall/policywright/blob/main/docs/mcp-server.md ; the real server driven end to end over stdio by the test suite (31 tests) https://github.com/kunal-drall/policywright/blob/main/test/mcp.test.ts ; the reference session script with the expected tool call and result per turn https://github.com/kunal-drall/policywright/blob/main/docs/mcp-reference-session.md — its six tool calls were made live from Claude Code 2.0.76 on 2026-09-02 with the expected results (quoted in https://github.com/kunal-drall/policywright/blob/main/docs/demo-script-t2.md ); site reference https://policywright.lemmalabs.space/reference/mcp-tools/

2. Claude skill. Criterion: "Skill packaged; a demo shows 'grant permission to do X from this transaction' producing a reviewed policy." Shipped: the policywright-grant skill packaged in the agentskills.io format (six spec fields, allowed-tools = the four MCP tools) with clarification triggers written first (spend cap, lifetime, multi-asset, route constraint, scope-changing warnings, assumed subject) and guardrails written in verbatim (never install/deploy/sign/submit, always dry-run before "reviewed", always the unaudited banner, never invent a hash/address/amount/window); validated by the reference validator (skills-ref) in CI; a machine walkthrough executes every expected tool call of the demo script against the real server. Proof: package https://github.com/kunal-drall/policywright/tree/main/.claude/skills/policywright-grant ; demo script https://github.com/kunal-drall/policywright/blob/main/docs/skill-demo-script.md ; tests https://github.com/kunal-drall/policywright/blob/main/test/skill.test.ts ; the demo's tool calls were made live from Claude Code on 2026-09-02 and the policy they produced (installable as-is after the clarification answers, dry run 1 permit / 5 deny / 0 flag, zero deviations) was installed into the testnet smart account and verified on-chain (deliverable 5); site page https://policywright.lemmalabs.space/reference/skill/

3. Dry-run harness + argument-level scope. Criterion: "The harness outputs a permit/deny/flag report for a generated policy including an argument-constrained case (BLND→XLM denied when enabled); tests green." Shipped: six standard scenarios (1 permit, 4 denies, the argument case) evaluated on the REAL recorded testnet claim→swap sequence; the swap re-routed through the network's native XLM contract is flagged by default (permitted, scope gap named) and denied with --constrain-arguments, with reasons naming the rule, argument, allow-set and offending token; self-describing reports with an Enforced-by column. Proof: both committed reports, regenerated and diffed by CI on every run — https://github.com/kunal-drall/policywright/blob/main/examples/live/simulation-report.md and https://github.com/kunal-drall/policywright/blob/main/examples/live/simulation-report.constrained.md ; tests https://github.com/kunal-drall/policywright/blob/main/test/harness.test.ts ; site page https://policywright.lemmalabs.space/reference/dry-run-harness/

4. Composed configuration + generated stateful policy. Criterion: "Generates both a composed-policy configuration and a net-new stateful policy contract; both compile and pass simulation." Shipped: one command emits both side by side — the composed stock OpenZeppelin spending_limit configuration (validated field-by-field against the OZ v0.7.2 install signature and encoded to the exact ScMap the contract decodes) and the generated FrequencyLimitPolicy.rs (byte-identical to the compiled crate: 25 Rust tests, reproducible wasm hash 42227f2b6150c95a7084bb7c5ff2e7a40793eae39bf0c5dc95bd752d18ee6eed equal to the deployed one, state keyed per (account, rule) with isolation tests); the dry-run report attributes each deny to the artifact that realises it; the compose-vs-generate boundary is documented and asserted. Proof: artifacts https://github.com/kunal-drall/policywright/tree/main/examples/live/fresh ; boundary https://github.com/kunal-drall/policywright/blob/main/docs/compose-vs-generate.md ; tests https://github.com/kunal-drall/policywright/blob/main/test/compose-boundary.test.ts ; crate https://github.com/kunal-drall/policywright/tree/main/contracts/frequency-limit-policy

5. Testnet smart account with an installed generated policy. Criterion: "A testnet smart account with an installed generated policy; end-to-end demo recorded." Shipped: OpenZeppelin's example smart account (vendored from stellar-contracts v0.7.2, built from source, hash-verified) deployed on testnet as CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT; the emitted context-rule.json consumed unmodified by the CLI install — validated against the OZ install signature, simulated twice (the second time in enforcing mode with the account's AuthPayload entry and the Delegated signer's nested __check_auth entry), signed client-side, submitted — then read back on-chain by verify to a 15/15 PASS. Installed twice: rule ids 1–3 (30-day artifact, txs 2bd245b67925e688a183be50e6d6c75d3d7b4eb98b0be02d23693611f44b8a6e, 065bf20b3d6e3b8b3cd9a8e408f009a61c347e0dfaaa4a5bda40b2199aa33dfa, 6593a5a0440b02e8679e9f87b7031d915b35b85a6873eb23b18016e827771a9a) and rule ids 4–6 (the 7-day route-enforced artifact from the skill demo, txs 6fee5fc8ab46cd221c6b807ee22c12e216d1d072e2179b4f6964c6c646e22ed6, 7763c0f6a30a3e9a24944d685b5faaab2b4360e5b1a136f2f0386b5d2bb9007a, cdb5266d038768a7a7bf9e3130e5c6efdcdaf04a3e1a574e6d13e34eb459893d). The generated FrequencyLimitPolicy is bound at CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP and OpenZeppelin's stock spending_limit at CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E. Signing ran on the labelled local-key fallback (no SEP-43 wallet can sign an OpenZeppelin External digest; the Freighter/wallets-kit page that signs the same transaction is the open cohort-wallet track). Proof: explorer https://stellar.expert/explorer/testnet/contract/CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT ; install logs and verify outputs https://github.com/kunal-drall/policywright/tree/main/examples/live/testnet ; flow and signing hierarchy https://github.com/kunal-drall/policywright/blob/main/docs/smart-account-install.md ; site page https://policywright.lemmalabs.space/reference/smart-account-install/ ; the end-to-end demo is the video in field 7.

Stated plainly: everything is testnet-only and unaudited until the Tranche 3 Audit Bank audit; the wallet signing page and an on-chain argument-scoping policy are not built (tracked in docs/T2-NOTES.md); CI runs are dispatched manually on this fork and cited per deliverable in the evidence pack.
```

## 7. Deliverable Verification - Video

```text
[BLOCKER: record the Tranche 2 demo video — script with real outputs at every beat: https://github.com/kunal-drall/policywright/blob/main/docs/demo-script-t2.md — then paste the public link here]

The video (≤ 5:00) shows an agent calling the four MCP tools live against testnet, the policywright-grant skill turning "grant permission to claim my Blend yield and swap it to USDC" into a reviewed policy with a clarification turn, the BLND→XLM argument-scope case flagged by default and denied when enforced, the install of that policy into the testnet OpenZeppelin smart account with the client-side signing moment, and the on-chain verify passing 15 for 15 with the transactions on the explorer.
```

## 8. Additional Deliverable Verification

```text
Evidence pack (criterion → what shipped → how to verify, per deliverable): https://github.com/kunal-drall/policywright/blob/main/evidence/EVIDENCE.md

MCP server: source https://github.com/kunal-drall/policywright/tree/main/src/mcp ; committed schemas https://github.com/kunal-drall/policywright/tree/main/schemas/mcp ; registration https://github.com/kunal-drall/policywright/blob/main/.mcp.json ; design https://github.com/kunal-drall/policywright/blob/main/docs/mcp-server.md ; reference session script https://github.com/kunal-drall/policywright/blob/main/docs/mcp-reference-session.md ; [BLOCKER: link the saved reference-session transcript (evidence/sessions/mcp-reference-session-<date>.md) once recorded]

Claude skill: package https://github.com/kunal-drall/policywright/tree/main/.claude/skills/policywright-grant ; demo script https://github.com/kunal-drall/policywright/blob/main/docs/skill-demo-script.md ; [BLOCKER: link the saved skill-demo transcript (evidence/sessions/skill-demo-<date>.md) once recorded]

Testnet smart account, install logs, verify outputs: https://github.com/kunal-drall/policywright/tree/main/examples/live/testnet ; account on the explorer https://stellar.expert/explorer/testnet/contract/CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT ; generated policy https://stellar.expert/explorer/testnet/contract/CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP ; stock spending-limit wrapper https://stellar.expert/explorer/testnet/contract/CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E ; an install transaction with both authorization entries https://stellar.expert/explorer/testnet/tx/6fee5fc8ab46cd221c6b807ee22c12e216d1d072e2179b4f6964c6c646e22ed6

Dry-run harness reports for the real recorded sequence: https://github.com/kunal-drall/policywright/tree/main/examples/live ; composed configuration and generated policy side by side: https://github.com/kunal-drall/policywright/tree/main/examples/live/fresh ; the artifact installed by the demo: https://github.com/kunal-drall/policywright/tree/main/examples/live/demo

Green CI runs (lint, format, typecheck, 215 Vitest tests incl. the stdio MCP suite and the skill walkthrough, MCP schema drift check, skill validator, tsc build, offline demo, committed reports and artifacts regenerated and diffed; docs-site build; Rust fmt/clippy/tests and three wasm builds asserted against the deployed hashes): https://github.com/kunal-drall/policywright/actions/runs/33647377983 and https://github.com/kunal-drall/policywright/actions/runs/33631174115 and https://github.com/kunal-drall/policywright/actions/runs/33622880981 and https://github.com/kunal-drall/policywright/actions/runs/33618871930 and https://github.com/kunal-drall/policywright/actions/runs/33561221471

Docs site: roadmap with per-deliverable status https://policywright.lemmalabs.space/roadmap/ ; MCP tools https://policywright.lemmalabs.space/reference/mcp-tools/ ; the skill https://policywright.lemmalabs.space/reference/skill/ ; smart-account install https://policywright.lemmalabs.space/reference/smart-account-install/ ; dry-run harness https://policywright.lemmalabs.space/reference/dry-run-harness/

Verified facts with dates and sources (toolchain, OpenZeppelin shapes, chain state, retention re-checks): https://github.com/kunal-drall/policywright/blob/main/docs/FACTS.md ; assumption-vs-reality log: https://github.com/kunal-drall/policywright/blob/main/docs/RECONCILIATION-T2.md
```

## 9. Support Needed

```text
One intro would help most as we move into Tranche 3: the OpenZeppelin accounts-package contact consulted for this RFP, to set up the technical-reviewer relationship our Tranche 3 plan commits to — the OpenZeppelin validation pass of the generated policy code and of the compose-first install mapping (context rules, stock spending_limit parameters, the Delegated-signer authorization path) before the Audit Bank submission. Secondarily, the cohort-wallet track is still open: a C-Address Tooling cohort wallet team willing to sign our install transaction through SEP-43 signTransaction would close the primary signing mode that the local-key fallback stands in for today.
```

## 10. Product Testing

```text
Policywright is a developer CLI plus an MCP server and a Claude skill — no credentials or accounts are needed to test any of it. Node 22+: git clone https://github.com/kunal-drall/policywright && cd policywright && npm ci && npm test && npm run demo runs the full pipeline offline and self-verifies (215 tests, including the MCP server driven over stdio and the skill demo walked through against it; re-verified from a fresh clone on 2026-09-02). Agent surface: from the repository root, claude mcp list shows the policywright server connected, and https://github.com/kunal-drall/policywright/blob/main/docs/mcp-reference-session.md is the conversation to run; the skill activates on "grant permission to do X from this transaction" (https://github.com/kunal-drall/policywright/blob/main/docs/skill-demo-script.md). On-chain, read-only: npm run cli -- verify --artifact examples/live/fresh/context-rule.json --account CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT --install-log examples/live/testnet/install-20260902T105742Z.json reads the installed rules back from testnet and passes while the rules are live (until ledger 4983015, about 2026-10-02). The live record path works with any contract-invoking testnet transaction hash inside the public RPC's ~7-day retention window. Docs: https://policywright.lemmalabs.space . Feedback via pull requests on the repository or Telegram @kunaldrall.
```

---

## BLOCKERS

Three human recordings stand between this file and submission. Everything
else in the file is verified and final; none of these needs code.

1. **The Tranche 2 demo video** (field 7). Record
   [docs/demo-script-t2.md](../docs/demo-script-t2.md) — five beats, ≤ 5:00,
   each `[SAY]`/`[DO]`/`[EXPECT]` with the real output it produces. Needs the
   `.env` testnet key (present on the author's machine), Claude Code with the
   project server connected, and ~0.04 XLM of testnet fees (the install
   appends the next three rule ids to the account; verify selects them through
   the install log). Optional for the live-hash path: within 7 days before
   recording, perform a fresh Blend claim → Soroswap swap from `GBMWJIAD…` as
   on 2026-08-08 (the committed hashes are past the node's retention window).
   Upload public (Loom or YouTube), open the link in an incognito window,
   replace the `[BLOCKER…]` token in field 7 with it.
2. **The MCP reference-session transcript** (field 8). Beat 1 of the same
   recording session: run
   [docs/mcp-reference-session.md](../docs/mcp-reference-session.md) in
   Claude Code from the repository root, save the unedited transcript as
   `evidence/sessions/mcp-reference-session-<YYYY-MM-DD>.md` (client version
   and date at the top), commit, link it from EVIDENCE.md § D2.1, and replace
   the token in field 8 with its GitHub URL. Turn 2 returns `TX_NOT_FOUND`
   today, as the script says.
3. **The skill demo transcript** (field 8). Beat 2 of the same session: run
   [docs/skill-demo-script.md](../docs/skill-demo-script.md) (say Turn 1
   verbatim; on `TX_NOT_FOUND` answer with the committed recording; answer
   Turn 3 verbatim; check the skill asked T1, T2, T4 and T5, showed the dry-run
   table and the banner, and answered "just install it" with no tool call),
   save the unedited transcript as `evidence/sessions/skill-demo-<YYYY-MM-DD>.md`,
   commit, link it from EVIDENCE.md § D2.2, and replace the token in field 8.

Recorded but not blocking: GitHub Issues remain disabled on the repository
(field 10 names pull requests and Telegram instead; enable with
`gh api -X PATCH repos/kunal-drall/policywright -f has_issues=true` if you
prefer issues) and push-triggered CI still does not fire on this fork (every
cited run is a manual dispatch, as the repository discloses — the form never
claims otherwise).

Once resolved: open every URL in this file in an incognito window, top to
bottom, then submit.
