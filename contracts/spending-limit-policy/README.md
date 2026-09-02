# spending-limit-policy (vendored from OpenZeppelin)

`src/contract.rs` is copied **verbatim** from `OpenZeppelin/stellar-contracts`
tag `v0.7.2` (commit `a9c42169000638da937577f592ebf61a7a3c94ca`),
`examples/multisig-smart-account/spending-limit-policy/src/contract.rs` — MIT
licensed (Copyright (c) 2024 OpenZeppelin). Only this `Cargo.toml` and
`lib.rs` are policywright's (crates.io pins instead of OZ workspace paths;
built with this workspace's toolchain).

Why it exists here: the stock `spending_limit` policy ships as a **library
module** (`stellar_accounts::policies::spending_limit` — docs/FACTS.md §2.4),
not as a deployable contract. This thin `#[contract]` delegates `install` /
`enforce` / `uninstall` to that module unchanged; it is the on-chain form of
the **composed** `stock:spending_limit` binding in `context-rule.json`, so
composing a stock policy still means deploying OZ's own wrapper — no
policywright-generated enforcement logic is involved
(docs/compose-vs-generate.md). TESTNET only (`scripts/deploy-policy.sh`).
