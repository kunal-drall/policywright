# multisig-account (vendored from OpenZeppelin)

`src/contract.rs` and `src/test.rs` are copied **verbatim** from
`OpenZeppelin/stellar-contracts` tag `v0.7.2`
(commit `a9c42169000638da937577f592ebf61a7a3c94ca`),
`examples/multisig-smart-account/account/src/{contract.rs,test.rs}` — MIT
licensed (Copyright (c) 2024 OpenZeppelin). Only this `Cargo.toml` and
`lib.rs` are policywright's: the dependencies are the crates.io releases
pinned in the workspace (`soroban-sdk =26.1.0`, `stellar-accounts =0.7.2`,
`stellar-contract-utils =0.7.2`) instead of the OZ workspace paths, and the
crate is built with this workspace's `rustfmt`/toolchain
(`contracts/rust-toolchain.toml`).

This is **not** a policywright-generated contract. It is the official
deployable smart account OZ v0.7.2 ships as an example (the `stellar-accounts`
crate is a library — docs/FACTS.md §8.1): `__constructor(signers, policies)`
creates the `Default` admin rule, `__check_auth` delegates to
`smart_account::do_check_auth`, and `SmartAccount` / `ExecutionEntryPoint` /
`Upgradeable` come from the library traits. policywright deploys it to
TESTNET only (`scripts/deploy-account.sh`) as the account its synthesised rules
are installed into (D2.5).
