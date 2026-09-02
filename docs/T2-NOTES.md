# Tranche 2 notes

A parking lot. Work that belongs to **T2 — Testnet expansion** (target 15 Oct 2026) gets written down here and left alone, so Tranche 1 stays in scope and
nothing is lost.

T2 scope, per the funded plan: MCP server (`record` / `synthesize` / `simulate` /
`verify`), Claude skill, dry-run harness + argument-level scope, net-new policy
codegen with storage segregation, wallet integration (testnet, end-to-end).

**Nothing in this file is a commitment for Tranche 1.**

---

## Delivered

### D2.1 — MCP server (2026-09-02)

Criterion: _"The server runs locally and an agent calls each tool end to end;
a reference session is recorded."_ The server, the four tools, the versioned
schemas, the network-free stdio test suite, the Claude Code registration, and
the reference-session script are delivered
([EVIDENCE.md § D2.1](../evidence/EVIDENCE.md#d21--mcp-server); design and
determinism map in [mcp-server.md](mcp-server.md)). The human-recorded session
is the BLOCKER listed there. Three CLI-only compositions moved into the
library on the way (`verifyArtifact`, `recordedTxToJson`,
`evaluateScenarios`; RECONCILIATION-T2 rows 79–81). Not built, by rule: any
install/deploy tool.

### D2.5 — Testnet smart account with the installed generated policy (2026-09-02, fallback path)

Criterion: _"A testnet smart account with an installed generated policy;
end-to-end demo recorded."_ Everything but the human demo recording is done
([EVIDENCE.md § D2.5](../evidence/EVIDENCE.md#d25--testnet-smart-account-with-the-installed-generated-policy-fallback-path));
the recording and the Freighter approval are the BLOCKERS listed there.

### D2.3 — Dry-run harness + argument-level scope (2026-09-02)

Criterion: _"The harness outputs a permit/deny/flag report for a generated policy
including an argument-constrained case (BLND→XLM denied when enabled); tests
green."_ Delivered; evidence in
[EVIDENCE.md § D2.3](../evidence/EVIDENCE.md#d23--dry-run-harness--argument-level-scope).

What changed relative to the T1-era `--constrain-arguments` (commit `c076ff9`,
which this deliverable promotes from "landed early" to supported):

- the derivation is an explicit, documented rule table (`swap-path`, the only
  rule) that reads contract-address-shaped vectors only;
- `simulate` runs against a saved recording (`--input`) and probes the
  unobserved route with the network's native XLM SAC (`--probe-token` to
  override), so the criterion case runs on the REAL recorded claim→swap
  sequence rather than a placeholder address;
- deny reasons name the violated constraint (rule, call, argument, allow-set,
  route); the flag reason says the call is permitted and how to close the gap;
- reports carry their provenance (recording, policy set, mode, legend, token
  addresses); both reports for the real sequence are committed and diffed in CI.

Still true, and stated in the README: the constraint is a token **set** (no
ordering, hop count, or amounts); `swap-path` is the only rule; enforcement is
offline-only until the policy codegen below exists.

### D2.4 — Composed configuration + generated stateful policy (2026-09-02)

Criterion: _"Generates both a composed-policy configuration and a net-new
stateful policy contract; both compile and pass simulation."_ Delivered;
evidence in
[EVIDENCE.md § D2.4](../evidence/EVIDENCE.md#d24--composed-configuration--generated-stateful-policy).
The boundary is documented once in
[compose-vs-generate.md](compose-vs-generate.md) and asserted in
`test/compose-boundary.test.ts`; both artifacts for the real recording sit in
`examples/live/fresh/`; `src/install-shape.ts` is the configuration's
"compile" (OZ install-signature validation + `ScVal` encoding) and the
installer's only input path.

---

## Deferred to T2

### Function-level scope enforcement as a policy

Verified in [FACTS.md §2.2](FACTS.md): an OZ `ContextRule` binds to one contract
via `ContextRuleType::CallContract(Address)` and carries **no** function name.
Function-level narrowing has to live in a policy's `enforce`, which does receive
`ContractContext { contract, fn_name, args }`.

policywright's spec models `(contract, fnName)` pairs on the rule itself
([RECONCILIATION.md rows 13–14](RECONCILIATION.md);
[src/types.ts](../src/types.ts) `ContextRule.scopedCalls`). Making that
installable needs:

- one context rule per contract, and
- a generated policy that checks `context.fn_name` against the observed set.

That generated policy is also the natural home for argument-level constraints
(the `swap-path` allow-set D2.3 enforces offline), which is why the two are
grouped here; generalising derivation beyond `path` belongs with it. **The T1 decision was made in D1.2
(2026-08-03): the emitted shape is fixed** — `context-rule.json` emits one
`CallContract` rule per contract with observed function names carried as
advisory `observedFns` ([schema](context-rule-schema.md)). What remains here
for T2 is exactly the _policy codegen_ half: a generated policy whose
`enforce` checks `context.fn_name` against the observed set.

### Net-new policy codegen with storage segregation

Delivered as D2.4 for the one generated policy: `FrequencyLimitPolicy` keys all
state on `(smart_account, context_rule.id)` — the stock-policy pattern — with
isolation tests in both directions, and the compose/generate boundary is
documented and asserted ([compose-vs-generate.md](compose-vs-generate.md)).
What remains here is generalising the same segregation to any further generated
policy (the argument/function-scoping policy above).

### MCP server

Delivered as **D2.1** (2026-09-02) — see the Delivered section above. What
remains here is only the human-recorded reference session (the EVIDENCE
blocker) and the Claude skill that wraps the tools.

### Claude skill

Packaged agent skill over the MCP server. Not started.

### Wallet integration (testnet, end-to-end)

Delivered as **D2.5 — fallback path** (2026-09-02): an OZ smart account on
testnet (`CBQ6H7IL…QHDT`) with the emitted rules installed as-is and verified
on-chain ([smart-account-install.md](smart-account-install.md); EVIDENCE §
D2.5). The `valid_until` unit problem is closed by emitter fix E1 (relative
`lifetimeLedgers`; the installer adds the live head). What remains open is the
**primary signing mode**: a wallets-kit + Freighter page that signs the same
install transaction through SEP-43 `signTransaction` (the `Delegated(G)` model
needs nothing more — proven with the local key as `G`). The installer's
`SigningSurface` interface is the plug point; the cohort-wallet track replaces
only that row.

### Simulated-transaction recording path

~~Listed under T1 in the funded plan and not yet built; noted here only because
it is adjacent to the RPC adapter work. **It stays T1.**~~ Resolved by D1.1
(2026-08-03): built as [src/sources/simulation.ts](../src/sources/simulation.ts)
behind `record --from-simulation`, fixture-tested against the committed real
`simulateTransaction` capture
([examples/live/simulated-soroswap-swap.json](../examples/live/simulated-soroswap-swap.json)).

---

## Observations parked, not scheduled

- ~~`deriveRuleName` truncates on JS string length; OZ's `MAX_NAME_SIZE` is 20
  **bytes**. Equivalent for the ASCII Soroban symbols in play today
  ([FACTS.md §2.3](FACTS.md)). Only matters if a non-ASCII name source
  appears.~~ Resolved by D1.2 (`f64e472`): `deriveRuleName` truncates via
  `truncateToBytes` in [src/synthesizer.ts](../src/synthesizer.ts), with a
  multibyte-symbol test.
- ~~`use soroban_sdk::panic_with_error;` emitted at the bottom of the generated
  Rust~~ Resolved by the D1.3 template (2026-08-03): the import sits in the
  top-of-file `use soroban_sdk::{…}` block of
  [contracts/frequency-limit-policy/src/lib.rs](../contracts/frequency-limit-policy/src/lib.rs).
- OZ `v0.8.0-rc.3` exists. FACTS.md pins `v0.7.2` (latest stable). Re-verify the
  trait and `ContextRule` shapes when 0.8.0 goes stable.
