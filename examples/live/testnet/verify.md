# policywright verify — PASS

Account: CBQ6H7ILH54ADWTVS7FCK36W7FY2RJJOWR4VGLZG7D4PZUG5FSA7QHDT (testnet); read at ledger 4464624.

| Rule | Field | Expected (artifact) | Actual (on-chain) | OK |
| --- | --- | --- | --- | --- |
| pw:claim | rule | CallContract(CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW) "pw:claim" | installed as rule id 1 | ✅ |
| pw:claim | signers | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | ✅ |
| pw:claim | policies | CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP | CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP | ✅ |
| pw:claim | custom:FrequencyLimitPolicy params | {"window_secs":86400,"max_calls":5} | {"window_secs":"86400","max_calls":5} | ✅ |
| pw:claim | valid_until | 4983015 (install log) | 4983015 | ✅ |
| pw:swap | rule | CallContract(CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD) "pw:swap" | installed as rule id 2 | ✅ |
| pw:swap | signers | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | ✅ |
| pw:swap | policies | CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP | CDSVPSTSKMJ2EEP4FOJ3NNIJZY5DKVA3VV5BM453AOYIWCLD4NMG2ZPP | ✅ |
| pw:swap | custom:FrequencyLimitPolicy params | {"window_secs":86400,"max_calls":5} | {"window_secs":"86400","max_calls":5} | ✅ |
| pw:swap | valid_until | 4983015 (install log) | 4983015 | ✅ |
| pw:xfer:BLND | rule | CallContract(CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF) "pw:xfer:BLND" | installed as rule id 3 | ✅ |
| pw:xfer:BLND | signers | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | Delegated:GATUKCIMLZTQHNW3IFRNJWJZ5YDT5S2VFSTYMW3EXCKNPYVAYQCKKS3W | ✅ |
| pw:xfer:BLND | policies | CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E | CCOQPGEYKZVNDRIUFMP6IQRDUONOURWWDJTXP22SJZ7NICJX7VGS4W4E | ✅ |
| pw:xfer:BLND | stock:spending_limit params | {"spending_limit":"23533505","period_ledgers":17280} | {"spending_limit":"23533505","period_ledgers":17280} | ✅ |
| pw:xfer:BLND | valid_until | 4983015 (install log) | 4983015 | ✅ |

Installed rules not described by the artifact (informational):
- id 0: Default "multisig", 1 signer(s), 0 policies, valid_until None

