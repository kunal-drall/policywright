# Installing a synthesised rule set into an OpenZeppelin smart account

This is the **code-first, deploy-second** half of policywright: everything up
to here produced files for review; this page is the explicit, human-initiated
step that puts them on a testnet smart account, and the read-only step that
proves what is installed matches what was emitted. Nothing on this page is
reachable from the MCP server — by design, not by omission
([architecture](architecture.md); RECONCILIATION-T2 row 47).

## The flow

```
                    (1) account:create            (2) synth --signer/--policy-address   (3) install            (4) verify
 .env key G ──▶ scripts/deploy-account.sh ──▶ examples/live/fresh/context-rule.json ──▶ 3 × add_context_rule ──▶ on-chain rules
                 OZ multisig-account wasm         schema v2, installable as-is           simulate → sign → submit   ≟ artifact
                 Default rule 0: Delegated(G)     (E1–E5 fixed)                          local-fallback signer      PASS / FAIL
```

1. **`account:create`** — [scripts/deploy-account.sh](../scripts/deploy-account.sh)
   builds OZ's own example smart account
   ([contracts/multisig-account](../contracts/multisig-account), vendored
   verbatim from `stellar-contracts` v0.7.2 — the `stellar-accounts` crate is a
   library and ships no deployable account, FACTS §8.1), uploads and deploys it
   with `stellar contract deploy … -- --signers '[{"Delegated":"G…"}]'
--policies '{}'`, fetches the on-chain wasm back and hard-fails on a hash
   mismatch, then writes `examples/live/testnet/account.json` and appends the
   deploy row to [evidence/EVIDENCE.md](../evidence/EVIDENCE.md). The
   constructor creates the account's **admin rule** — `Default`, id `0`, one
   `Delegated(G)` signer where `G` is the `.env` public key.
2. **Emit an installable artifact** — `synth` takes the deploy-time facts as
   inputs so the artifact carries them (RECONCILIATION-T2 emitter fixes E1–E5,
   [schema v2](context-rule-schema.md)):
   ```bash
   npm run cli -- synth --input examples/live/recorded-claim-swap-fresh.json --out examples/live/fresh \
     --signer=delegated:G… \
     --policy-address=custom:FrequencyLimitPolicy=C… \
     --policy-address=stock:spending_limit=C…
   ```
   The exact flags used for the committed artifact are pinned in
   [examples/live/fresh/synth.args](../examples/live/fresh/synth.args) (CI
   re-emits with them and diffs). The policy addresses are real deployments:
   the D1.3 generated `FrequencyLimitPolicy` instance (restored with
   [scripts/restore-testnet.sh](../scripts/restore-testnet.sh) — it had been
   archived, FACTS §11.2) and OZ's stock `spending_limit` wrapper
   ([contracts/spending-limit-policy](../contracts/spending-limit-policy),
   deployed with `scripts/deploy-testnet.sh spending-limit-policy`).
3. **`install`** — [scripts/install-testnet.sh](../scripts/install-testnet.sh)
   sources `.env` into the environment and runs
   `npm run cli -- install --artifact … --account … [--dry-run]`.
   [src/install.ts](../src/install.ts) consumes the artifact **unmodified**
   through [src/install-shape.ts](../src/install-shape.ts): every field is
   validated against the checks the real contracts perform (each citing its OZ
   source line) and refused if it would not install as-is — a signer-less
   `spending_limit` rule, a null policy address, a past `valid_until`, more than
   5 policies or 15 signers, a duplicate policy address. The only value the
   installer computes is `valid_until = ledger head + lifetimeLedgers` when the
   artifact carries the relative lifetime (E1). One transaction per rule;
   always **simulated twice before signing** (below); `--dry-run` stops after
   the enforcing simulation and submits nothing. Output and the machine-readable
   install log carry the signing mode and why; secrets appear nowhere.
4. **`verify`** — `npm run cli -- verify --artifact … --account … [--install-log …]`
   ([src/verify.ts](../src/verify.ts), a library function with a thin CLI
   wrapper — the shape of the future MCP `verify` tool) reads the account's
   `get_context_rules_count` / `get_context_rule(id)` and each policy's stored
   params (`get_spending_limit_data`, `get_frequency_limit_data`) via
   simulated getters, diffs them against the artifact, and prints PASS/FAIL with
   the row-by-row diff. Read-only; nothing signed.

## How an install transaction authorizes (and why simulation alone is not enough)

Every `add_context_rule` calls `require_auth` on the account's **own**
C-address (mod.rs:246). The transaction therefore carries one
`SorobanAuthorizationEntry` with address credentials for the account, whose
`signature` is the `AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids:
[0] }` — selecting the admin rule (FACTS §8.3). Signers do not sign the host's
`signature_payload`; OZ binds the selected rule ids into
`auth_digest = sha256(signature_payload ‖ xdr(context_rule_ids))`
(storage.rs:492-495), which stops rule-selection downgrades.

A **`Delegated(G)`** signer is authenticated by `G.require_auth_for_args((auth_digest,))`
_inside_ `__check_auth` — an authorization entry for `G` over
`account.__check_auth(auth_digest)` that **simulation never returns**
(recording mode does not call `__check_auth` — FACTS §8.4, RECONCILIATION-T2
row 39). The installer builds it: when `G` is the transaction source it carries
`SourceAccount` credentials, so the ordinary transaction signature covers it.
The sequence is:

1. simulate in recording mode with no auth → the host returns the account's
   entry skeleton with the exact invocation tree it will check;
2. fill that entry's credentials — fresh nonce, expiration ledger = head + 120,
   `signature` = the `AuthPayload`; compute `signature_payload` and `auth_digest`;
3. add `G`'s nested `__check_auth(auth_digest)` entry (`SourceAccount`);
4. simulate again **in enforcing mode** with both entries — this runs
   `__check_auth`, the nested `require_auth_for_args`, and every policy `install`
   against live state; a wrong payload fails here, before anything is signed;
5. assemble (the SDK keeps the supplied entries), sign the transaction, submit,
   poll; decode the returned `ContextRule.id`.

**Proven on testnet 2026-09-02** (the first end-to-end proof of the Delegated
path; it had been source-supported but unproven): three rules installed with two
auth entries each — see EVIDENCE.md § D2.5 for the transaction hashes — and
again the same day by the demo-script run ([demo-script-t2.md](demo-script-t2.md)):
the 7-day, route-enforced artifact under [examples/live/demo/](../examples/live/demo/)
installed as rule ids 4–6 (install log
[install-20260902T153356Z.json](../examples/live/testnet/install-20260902T153356Z.json),
verify PASS [verify-demo-20260902T153356Z.md](../examples/live/testnet/verify-demo-20260902T153356Z.md)).

## Installing the same artifact twice

Every install appends new rule ids; the names repeat. `verify` matches an
artifact rule by (context type, contract, name) and, when an install log is
supplied, prefers the installed rule whose `valid_until` equals the one the
log recorded — so `verify --install-log <that install's log>` compares the
install you mean (`findInstalledRule` in [src/verify.ts](../src/verify.ts);
`test/install.test.ts` "matches a re-installed artifact through the install
log"). Without a log the earliest matching rule is compared, and an artifact
whose parameters differ from that earlier install fails honestly on the
params row. Pass the log.

## The signing hierarchy and its honest labelling

The verdict ([FACTS §8.4](FACTS.md), RECONCILIATION-T2 Gate 2):

| Mode                                               | What signs                                                                                                                                            | Status in this repo                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary — wallet (`Delegated(G)`)**              | The wallet's `G` is the rule signer and the transaction source; it signs **the same transaction** the installer builds, via SEP-43 `signTransaction`. | Not wired in this deliverable: the wallets-kit + Freighter page is the **cohort-wallet track (open)**; if a wallet engages it replaces only this row. The installer's `SigningSurface` interface is where it plugs in.                                                          |
| **Fallback — local `.env` key (`local-fallback`)** | `Keypair.fromSecret(STELLAR_SECRET_KEY)` acts as `G` (Delegated signer + transaction source) and could sign an `External` digest.                     | **Used for D2.5**, labelled `local-fallback` in every output and install log, with the reason: no SEP-43 wallet can sign an OZ `External` digest (`sha256(payload ‖ rule_ids)`) — Freighter signs `sha256(HashIdPreimage)` after parsing it — and the wallet page is not built. |
| Never                                              | MCP-driven signing or submission.                                                                                                                     | Structural rule; the MCP server has no install/deploy tool.                                                                                                                                                                                                                     |

The secret is read from the environment only (`scripts/install-testnet.sh`
sources the gitignored `.env`); it is never an argument, never logged, and the
install log records only the public key, nonce, expiration ledger, and digest.

## The one interactive human step

The demo recording — scripted beat by beat, with the real outputs of every
command, in [demo-script-t2.md](demo-script-t2.md). Everything above ran
non-interactively with the `.env` key; the human steps that remain are listed
as **BLOCKERS** in EVIDENCE.md § D2.5: recording the end-to-end demo, and —
for the primary signing mode — installing Freighter, funding its testnet
account, and approving the same transaction there.

## Post-install enforcement (not required by the criterion)

Invoking a scoped contract **through** the account (so the installed rules
authorize the call) requires the account's `execute` entry point and a
`__check_auth` payload selecting rule 1–3 per context — the same machinery the
installer uses, applied to a swap. It is the natural next demonstration (an
in-scope swap succeeds; an over-cap transfer is rejected on-chain by the
composed `spending_limit`), and it is deliberately not part of D2.5's proof
surface; see EVIDENCE.md § D2.5 "Not done".
