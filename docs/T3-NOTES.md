# Tranche 3 notes

A parking lot for **T3 — Audit prep, mainnet, production packaging** items
that surface while Tranche 2 is being built, so T2 stays in scope and nothing
is lost. **Nothing in this file is a commitment for Tranche 2.**

---

## Parked during the T2 pre-flight (2026-09-02)

- **Threat-model input — the rule-bound digest and the delegated nested
  entry.** OZ v0.7.2 binds `context_rule_ids` into the signed digest
  (`sha256(signature_payload ‖ context_rule_ids XDR)`) to stop rule-selection
  downgrades, and a `Delegated(G)` signer authorizes through a hand-built
  `account.__check_auth(auth_digest)` entry that simulation never returns
  ([RECONCILIATION-T2.md](RECONCILIATION-T2.md) rows 34, 39). Both belong in
  the T3 threat model (replay across accounts, expiration-ledger handling of
  the nested entry, source-account credentials). Not T2 work.
- **Mainnet verifier / policy addresses.** The OpenZeppelin Wizard tells
  deployers to take verifier and policy contracts "you trust from the Stellar
  Registry" (`https://stellar.rgstry.xyz` for mainnet). Vetting and pinning
  mainnet addresses is a T3 (mainnet) task; T2 stays testnet-only.
- **Dependency line upgrades tied to packaging.** `@stellar/stellar-sdk`
  17.x (required by wallets-kit 2.6.0), stellar-cli 28.x and any OZ 0.8
  (CAP-71-aware) adoption are recorded in [FACTS.md §7](FACTS.md); moving
  the repo's pins is versioned-packaging work, not a T2 gate.
