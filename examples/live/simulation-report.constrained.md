# policywright dry-run report

Recording: testnet, from rpc, tx 9fff676c46c5b00afb124cd4f59f63d76177c7b4585bde31a518acf923f0a0b6, ae943f998fd07dfd17536d8c25b714146f467ea222a6314f23cf7032cdc67c46; subject GBMWJIADBWN6FJUQPSVKWZE7ZFEPHEN2YBINQ7UVPHJ2WJW2SWI6WD4Q.
Generated policy set (context rule `pw:claim+swap`, 3 enforced policies):
- spending-limit: BLND <= 2.3533505 per 86400s (observed gross out 2.1394095) — composed: stock:spending_limit { spending_limit: 23533505, period_ledgers: 17280 } (caps BLND transfers) on rule pw:xfer:BLND
- frequency-limit: <= 5 call(s) per 86400s — generated: custom:FrequencyLimitPolicy { window_secs: 86400, max_calls: 5 } on rules pw:claim, pw:swap
- argument-constraint (swap-path): swap_exact_tokens_for_tokens arg[2] (path) restricted to 2 observed token(s) — dry-run harness only — no on-chain artifact yet
Argument constraints (`constrainArguments: true`): ENFORCED — a violation is denied.
- argument-constraint (swap-path): swap_exact_tokens_for_tokens arg[2] (path) restricted to 2 observed token(s): CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF, CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU

Decisions: ✅ permit — every check passed; ⛔ deny — the named check failed; ⚠️ flag — every enforced check passed (the call would be permitted) but an advisory argument constraint was violated. "Enforced by" names the artifact that realises the deciding check: a composed stock OZ policy, the generated policy contract, the context rule itself, or the offline harness alone.

| Scenario | Decision | Enforced by | Reason |
| --- | --- | --- | --- |
| replay recorded flow | ✅ permit (permit) | — | within scope, lifetime, argument, spend cap, and frequency limits |
| over the spend cap | ⛔ deny (spending-limit) | composed stock:spending_limit on rule pw:xfer:BLND | outflow of 2.3533506 BLND exceeds the 2.3533505 cap per 86400s |
| call to an unseen function | ⛔ deny (scope) | context rule scope — CallContract(contract) on-chain; the function-level narrowing is the harness model (a generated policy would be needed on-chain) | set_admin @ CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD is outside the context rule's scope |
| call after rule expiry | ⛔ deny (lifetime) | context rule valid_until — a ledger sequence on-chain (storage.rs:282); seconds in the harness | call at 1788758113 is after the rule expires at 1788758112 |
| over the frequency limit | ⛔ deny (frequency-limit) | generated custom:FrequencyLimitPolicy (FrequencyLimitPolicy.rs) on rules pw:claim, pw:swap | this would be call 6 within 86400s, over the cap of 5 |
| BLND→XLM swap (route through unobserved XLM) | ⛔ deny (argument-constraint) | dry-run harness only — no on-chain artifact yet | argument constraint violated: swap_exact_tokens_for_tokens arg[2] path (rule swap-path) must stay within the observed token set {BLND CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF, USDC CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}; candidate routes through unobserved XLM CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC |

Tokens:
- BLND = CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF
- USDC = CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU
- XLM = CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC — native XLM Stellar Asset Contract on testnet, derived from the network passphrase (Asset.native().contractId)

