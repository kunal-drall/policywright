# policywright dry-run report

Recording: testnet, from fixture, tx 3389e9f0f1a32b9c7c1cf3b8a2e5d4c6b7a8901234567890abcdef123456789a; subject CABJN4UUYDTF6C2G3WQJCWLG4KNQS2EVLCORKPWMIMSKYPU3FVNFCBS2.
Generated policy set (context rule `pw:claim+swap`, 2 enforced policies):
- spending-limit: BLND <= 1357.95 per 86400s (observed gross out 1234.5) — dry-run harness only — no on-chain artifact yet
- frequency-limit: <= 5 call(s) per 86400s — generated: custom:FrequencyLimitPolicy { window_secs: 86400, max_calls: 5 } on rules pw:claim, pw:swap
Argument constraints (`constrainArguments: false`): advisory (default) — a violation is permitted and flagged as a scope gap; `--constrain-arguments` enforces it.
- argument-constraint (swap-path): swap_exact_tokens_for_tokens arg[2] (path) restricted to 2 observed token(s): CBG4EBVOIT77IWCNJOL4BVAAOIVAH7W7YSLK5UI4N6SGNFSHGSEXMA2W, CCTTMGGQKRAV7HB7OQXVHPA6WXCW2KGSOKVAEKAS6P4MVBBG7RHA6JM7

Decisions: ✅ permit — every check passed; ⛔ deny — the named check failed; ⚠️ flag — every enforced check passed (the call would be permitted) but an advisory argument constraint was violated. "Enforced by" names the artifact that realises the deciding check: a composed stock OZ policy, the generated policy contract, the context rule itself, or the offline harness alone.

| Scenario | Decision | Enforced by | Reason |
| --- | --- | --- | --- |
| replay recorded flow | ✅ permit (permit) | — | within scope, lifetime, argument, spend cap, and frequency limits |
| over the spend cap | ⛔ deny (spending-limit) | dry-run harness only — no on-chain artifact yet | outflow of 1357.9500001 BLND exceeds the 1357.95 cap per 86400s |
| call to an unseen function | ⛔ deny (scope) | context rule scope — CallContract(contract) on-chain; the function-level narrowing is the harness model (a generated policy would be needed on-chain) | set_admin @ CBGAPUV74GVQYQYBHMIN4LF5ZEHYIMM4L5VBGUBB4IJXM5D4RQ7275J7 is outside the context rule's scope |
| call after rule expiry | ⛔ deny (lifetime) | context rule valid_until — a ledger sequence on-chain (storage.rs:282); seconds in the harness | call at 1751414401 is after the rule expires at 1751414400 |
| over the frequency limit | ⛔ deny (frequency-limit) | generated custom:FrequencyLimitPolicy (FrequencyLimitPolicy.rs) on rules pw:claim, pw:swap | this would be call 6 within 86400s, over the cap of 5 |
| BLND→XLM swap (route through unobserved XLM) | ⚠️ flag (argument-constraint) | dry-run harness only — advisory, no on-chain artifact | permitted with a scope gap (constrainArguments is off, so this constraint is advisory): swap_exact_tokens_for_tokens arg[2] path (rule swap-path) must stay within the observed token set {BLND CBG4EBVOIT77IWCNJOL4BVAAOIVAH7W7YSLK5UI4N6SGNFSHGSEXMA2W, USDC CCTTMGGQKRAV7HB7OQXVHPA6WXCW2KGSOKVAEKAS6P4MVBBG7RHA6JM7}; candidate routes through unobserved XLM CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC; enable --constrain-arguments to deny it |

Tokens:
- BLND = CBG4EBVOIT77IWCNJOL4BVAAOIVAH7W7YSLK5UI4N6SGNFSHGSEXMA2W
- USDC = CCTTMGGQKRAV7HB7OQXVHPA6WXCW2KGSOKVAEKAS6P4MVBBG7RHA6JM7
- XLM = CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC — native XLM Stellar Asset Contract on testnet, derived from the network passphrase (Asset.native().contractId)
