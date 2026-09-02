# Example output

These files are a committed sample run, so reviewers can see policywright's
output without executing anything. They were generated from the bundled fixture
([`fixtures/recorded-tx.json`](../fixtures/recorded-tx.json)) with the default
configuration:

```bash
npm run demo   # writes the same artefacts to out/
```

| File | What it is |
| --- | --- |
| `summary.txt` | Human-readable summary of the recording and synthesized spec. |
| `spec.json` | Machine-readable `SmartAccountSpec` (amounts as decimal strings). |
| `context-rule.json` | Installable OZ context rules + policy install params ([schema](../docs/context-rule-schema.md)). |
| `simulation-report.md` | Dry-run report for the standard scenarios. |
| `FrequencyLimitPolicy.rs` | The generated **illustrative, unaudited** Rust policy — byte-identical to the compiled-and-tested crate at [`contracts/frequency-limit-policy`](../contracts/frequency-limit-policy) at the demo defaults. |

The fixture carries no authorization trees, so its `context-rule.json` records the
BLND spend cap as a **delta note** (the stock spending-limit policy cannot fire
without a subject-authorized direct `transfer`). The committed artifact for the
**real** recorded testnet sequence — where the authorization tree is present and the
cap composes onto a token rule as stock `spending_limit` params — is
[`live/context-rule.json`](live/context-rule.json), regenerable with:

```bash
npm run cli -- synth --input examples/live/recorded-claim-swap.json
```

They reflect the default synthesis config (`constrainArguments` off), so the
unobserved-route scenario is **flagged** rather than denied. Running
`npm run cli -- simulate --constrain-arguments` enforces it as a denial instead.

The dry-run reports for the **real** recorded claim→swap sequence
([`live/recorded-claim-swap-fresh.json`](live/recorded-claim-swap-fresh.json): Blend
claim `9fff676c…` then Soroswap swap BLND→USDC `ae943f99…`, re-assembled byte-for-byte
from the raw captures beside it by `test/recorder.test.ts`) are committed in both modes
and regenerated + diffed by CI:

| File | Mode | BLND→XLM scenario |
| --- | --- | --- |
| [`live/simulation-report.md`](live/simulation-report.md) | default (`constrainArguments: false`) | ⚠️ flag — permitted with a scope gap |
| [`live/simulation-report.constrained.md`](live/simulation-report.constrained.md) | `--constrain-arguments` | ⛔ deny — argument constraint violated |

```bash
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json
npm run cli -- simulate --input examples/live/recorded-claim-swap-fresh.json --constrain-arguments
```

[`live/fresh/`](live/fresh/) holds the emitted artefacts for that same recording, side by
side — the **composed** configuration (`context-rule.json`: `stock:spending_limit` on the
BLND token rule with its real install params) and the **generated** stateful policy
(`FrequencyLimitPolicy.rs`, byte-identical to the compiled crate) plus `spec.json` and
`summary.txt` — regenerated and diffed by CI ([boundary](../docs/compose-vs-generate.md)):

```bash
npm run cli -- synth --input examples/live/recorded-claim-swap-fresh.json --out examples/live/fresh
```

These are generated artefacts and are intentionally excluded from Prettier so
they match the tool's raw output verbatim.
