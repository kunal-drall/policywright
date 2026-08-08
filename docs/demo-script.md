# Demo script — the recordable Tranche 1 demo (final)

Five beats, ≤5:00 total. Every `[EXPECT]` block below is real output produced
by running the command shown, against the freshly executed on-chain flow of
2026-08-08: a Blend pool `claim` moving 2.1394095 BLND
(`9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6`) and a
Soroswap router swap of that BLND into 1.0516011 USDC
(`ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46`), both
verified SUCCESS on the public testnet RPC. Raw captures and the merged
recording are committed under [examples/live/](../examples/live/).

**Record within a few days:** the two hashes leave the RPC's ~7-day
retention window around 2026-08-15; after that Beat 2 returns the typed
`TX_NOT_FOUND` and the committed captures are the reproduction path.

Prep (off camera): `git clone https://github.com/kunal-drall/policywright &&
cd policywright && npm ci`. Also on the machine: `jq` and `stellar`
(stellar-cli v27.1.0). No secrets and no `.env` are needed for any beat.

---

## Beat 1 — what this is (0:00–0:40)

**[SAY]** "This is Policywright — Tranche 1 of our SCF #44 Build Award. It
turns a transaction you've already performed into the least-privilege
OpenZeppelin smart-account authorization that permits exactly that flow.
Public repo, MIT, CI green: lint, typecheck, the full test suite, the offline
demo, and a reproducible Rust build."

> Production note: the approved narration says "CI green on push" — do not
> say "on push" until push-triggered CI works
> ([TRANCHE1-FORM.md BLOCKERS #2](../evidence/TRANCHE1-FORM.md#blockers));
> today every green run is a manual dispatch, as the repo discloses.

**[DO]** Browser: <https://github.com/kunal-drall/policywright> → Actions tab
→ open the latest green run
(<https://github.com/kunal-drall/policywright/actions/runs/30839470749>) —
show the three green jobs: `build`, `site`, `contracts`.

**[EXPECT]** All three jobs green; the `contracts` job's final step reads
"hash matches the recorded reproducible build and the deployed on-chain
wasm".

## Beat 2 — recording (0:40–1:40)

**[SAY]** "Recording first. These are two real testnet transactions from
today — a Blend emissions claim, and a Soroswap swap of that BLND into USDC.
Soroban allows one contract invocation per transaction, so the recorder takes
both hashes and merges them into a single recorded sequence: the exact
contracts and functions called, decoded arguments, and every token movement."

**[DO]** (`npx tsx src/cli.ts` is the same entry point as `npm run record --`
with stdout kept clean of npm's script banner):

```bash
npx tsx src/cli.ts record \
  9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6 \
  ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46 \
  --network testnet \
  --account GBMWJIADBWN6FJUQPSVKWZE7ZFEPHEN2YBINQ7UVPHJ2WJW2SWI6WD4Q \
  > /tmp/recording.json
jq -r '.calls[] | "\(.fnName) @ \(.contract)  (tx \(.sourceHash[0:8])…)"' /tmp/recording.json
jq -r '.flows[] | "\(.direction)  \(.amount)  \(.asset.symbol)"' /tmp/recording.json
```

**[EXPECT]** (real output, run live 2026-08-08; committed copy:
[examples/live/recorded-claim-swap-fresh.json](../examples/live/recorded-claim-swap-fresh.json)):

```
claim @ CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW  (tx 9fff676c…)
swap_exact_tokens_for_tokens @ CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD  (tx ae943f99…)
in  21394095  BLND
out  21394095  BLND
in  10516011  USDC
```

Say over it: "2.1394095 BLND in from the claim, the same 2.1394095 back out
through the swap, 1.05 USDC in — one merged recording."

## Beat 3 — synthesis (1:40–3:00)

**[SAY]** "Synthesis. The context rule is scoped to exactly the
contract-function pairs observed — nothing else. BLND is capped on its gross
outflow: it netted to zero, but the delegate still moved it out, so gross is
what we cap. USDC only flowed in, so it gets no cap — minimal permission. A
frequency limit bounds repetition, and the stock OpenZeppelin spending_limit
is emitted with its real install parameters, converted to ledger units, with
the source citation."

**[DO]** (synth prints the summary, then the full `spec.json` and
`context-rule.json` to stdout; the second command slices out the emitted
rules with their install params):

```bash
npx tsx src/cli.ts synth --input /tmp/recording.json
npx tsx src/cli.ts synth --input /tmp/recording.json 2>/dev/null \
  | sed -n '/^--- context-rule.json ---$/,$p' | tail -n +2 \
  | jq '.contextRules[] | {name, contract: .contextType.contract,
        policies: [.policies[] | {policy, installParams}]}'
```

**[EXPECT]** (real output from the fresh recording, run 2026-08-08; the
"valid until" unix/ledger values are computed from the clock and ledger at
synth time, so those two numbers will differ on camera — everything else
reproduces):

```
policywright — synthesized smart-account authorization
======================================================

Source tx : 9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6
Network   : testnet (recorded from rpc)

Observed flow
-------------
  call claim @ CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW
  call swap_exact_tokens_for_tokens @ CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD
  in   2.1394095 BLND
  out  2.1394095 BLND
  in   1.0516011 USDC
...
Policies (2)
--------
  - spending-limit: BLND <= 2.3533505 per 86400s (observed gross out 2.1394095)
  - frequency-limit: <= 5 call(s) per 86400s
...
Installable OZ context rules (3) — see context-rule.json
----------------------------
  pw:claim  CallContract(CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW)
    valid until ledger 4547500; observed fns: claim
    - custom:FrequencyLimitPolicy { window_secs: 86400, max_calls: 5 }
  pw:swap  CallContract(CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD)
    valid until ledger 4547500; observed fns: swap_exact_tokens_for_tokens
    - custom:FrequencyLimitPolicy { window_secs: 86400, max_calls: 5 }
  pw:xfer:BLND  CallContract(CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF)
    valid until ledger 4547500; observed fns: transfer
    - stock:spending_limit { spending_limit: 23533505, period_ledgers: 17280 } (caps BLND transfers)

  6 composition note(s) in context-rule.json (unit conversions,
  deltas the stock policies cannot express).
```

and from the jq slice, the load-bearing rule:

```json
{
  "name": "pw:xfer:BLND",
  "contract": "CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF",
  "policies": [
    {
      "policy": "stock:spending_limit",
      "installParams": { "spending_limit": "23533505", "period_ledgers": 17280 }
    }
  ]
}
```

Say over it: "23533505 stroops is the observed 2.1394095 BLND gross outflow
times 1.1, and 17280 ledgers is one day at 5 seconds per ledger —
OpenZeppelin's own DAY_IN_LEDGERS. A CI test validates this shape against the
OZ v0.7.2 install signature."

## Beat 4 — the dry-run (3:00–3:50)

**[SAY]** "Before anything is installed, the dry-run: the original flow is
permitted; an over-cap spend is denied; an out-of-scope call is denied — each
with the reason."

**[DO]**

```bash
npm run cli -- simulate
```

**[EXPECT]** (real output, run 2026-08-06; deterministic — the scenarios run
against the committed offline fixture):

```
# policywright dry-run report

| Scenario | Decision | Reason |
| --- | --- | --- |
| replay recorded flow | ✅ permit (permit) | within scope, lifetime, argument, spend cap, and frequency limits |
| over the spend cap | ⛔ deny (spending-limit) | outflow of 1357.9500001 BLND exceeds the 1357.95 cap per 86400s |
| call to an unseen function | ⛔ deny (scope) | set_admin @ CBGAPUV74GVQYQYBHMIN4LF5ZEHYIMM4L5VBGUBB4IJXM5D4RQ7275J7 is outside the context rule's scope |
| call after rule expiry | ⛔ deny (lifetime) | call at 1751414401 is after the rule expires at 1751414400 |
| over the frequency limit | ⛔ deny (frequency-limit) | this would be call 6 within 86400s, over the cap of 5 |
| route through an unobserved token | ⚠️ flag (argument-constraint) | swap_exact_tokens_for_tokens path routes through unobserved token(s) CZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ; not enforced (constrainArguments is off) |
```

## Beat 5 — the deployed policy, hash-verified (3:50–4:40)

**[SAY]** "The generated policy is real: compiled with pinned stellar-cli, 25
Rust tests, deployed to testnet — here's the contract, and the on-chain wasm
hash equals the reproducible local build, asserted in CI. All four Tranche 1
criteria met, about three weeks ahead of target. Unaudited and testnet-only
until the Tranche 3 Audit Bank audit."

**[DO]** Browser:
<https://stellar.expert/explorer/testnet/contract/CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP>.
Terminal:

```bash
stellar contract fetch \
  --id CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP \
  --network testnet -o /tmp/onchain.wasm
shasum -a 256 /tmp/onchain.wasm
```

Then show the deployment-log row in
[evidence/EVIDENCE.md](../evidence/EVIDENCE.md#deployment-log): "Wasm hash
(= local sha256, = on-chain sha256)".

**[EXPECT]** (re-verified live 2026-08-06):

```
42227f2b6150c95a7084bb7c5ff2e7a40793eae39bf0c5dc95bd752d18ee6eed  /tmp/onchain.wasm
```

---

## Recording notes

- Terminal font ≥16pt, dark theme, 1080p or higher.
- Clean shell: minimal prompt, no secrets in env output (`env` never shown;
  no `.env` is needed for any beat).
- One full dry run of all five beats before recording; single take preferred.
- Record before ~2026-08-15, while the two fresh hashes are still inside the
  RPC retention window.
- Upload public (YouTube or Loom); test the link in a logged-out/incognito
  window before pasting it into the form.
