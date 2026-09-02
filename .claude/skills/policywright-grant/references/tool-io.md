# Tool I/O cheat-sheet

The authoritative contracts are the server's advertised JSON Schemas
(committed under `schemas/mcp/`). This is the subset the skill uses. Every
input may carry `schemaVersion: 1`; every output does.

## `mcp__policywright__record`

Input (one of `hashes` / `simulation` / `simulationPath`):

| Field            | Notes                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `hashes`         | array of 64-hex transaction hashes; a multi-step flow is several         |
| `account`        | `G…` or `C…` the flows are attributed to — always pass it when known     |
| `simulationPath` | a saved `simulateTransaction` exchange (`.json`) instead of hashes       |
| `network`, `rpcUrl` | overrides; default testnet / server config                           |
| `outPath`        | also write the recording (`.json`); needs `overwrite: true` to replace   |

Output you present: `summary.calls[]` (`fnName`, `contract`), `summary.flows[]`
(`symbol`, `amountFormatted`, `direction`, `resolved`), `warnings[]`; pass
`recording` (or the written file as `recordingPath`) onward.

## `mcp__policywright__synthesize`

Input: `recording` **or** `recordingPath`; optional `config`,
`installTargets`, `now`, `outDir`, `overwrite`, `includeRustSource`.

`config` fields: `lifetimeSecs`, `spendWindowSecs`, `capMultiplier`,
`frequencyWindowSecs`, `frequencyMaxCalls`, `constrainArguments`.

`installTargets`: `signers: [{ type: "Delegated", address }]`,
`policyAddresses: { "custom:FrequencyLimitPolicy", "stock:spending_limit" }`,
`ledgerHead`.

Output you present: `scopeNotes[]`, `notes[]`, `warnings[]`,
`recordingWarnings[]`, `installable.asIs` + `installable.violations[]`,
`config`, `spec.contextRule.scopedCalls`, `spec.argumentScopes`,
`unauditedBanner`, `rustPolicy.banner` (+ `source` / `path`), `files[]`.
Hand over `contextRule`, `summary`, `spec`.

## `mcp__policywright__simulate`

Input: the same `recording`/`recordingPath` and the same `config`; optional
`probeToken`, `candidates[]` (`label`, `contract`, `fnName`, `args`,
`outflows: [{ contractId, amount }]`), `standardScenarios`.

Output you present: `results[]` (`label`, `decision`, `reasonCode`,
`reason`, `enforcedBy`), `counts`, `deviations` (must be 0), `warnings[]`,
`report` (Markdown).

## `mcp__policywright__verify`

Input: `artifact` **or** `artifactPath`; `account` (`C…`); optional
`installLog` / `installLogPath`, `network`, `rpcUrl`.

Output you present: `pass`, `rows[]` (`rule`, `field`, `expected`, `actual`,
`ok`), `extraRules[]`, `warnings[]`, `report`.

## Errors

`isError` results carry one text block that is the JSON envelope
`{ ok: false, error: { code, message, source } }` with `code` ∈
`BAD_INPUT | TX_NOT_FOUND | NETWORK | DECODE_FAILED | SHAPE_INVALID | INTERNAL`.
A text starting `Input validation error:` is the schema rejecting a field.

## CLI-flag mapping

Library messages may name CLI flags. Their tool-input equivalents:
`--account` → `account`; `--probe-token` → `probeToken`;
`--constrain-arguments` → `config.constrainArguments`; `--signer` →
`installTargets.signers`; `--policy-address` → `installTargets.policyAddresses`;
`--ledger-head` → `installTargets.ledgerHead`; `--lifetime` / `--spend-window`
/ `--cap-multiplier` / `--frequency-window` / `--frequency-max` → `config.*`;
`--input` → `recordingPath`; `--out` → `outDir`; `--install-log` →
`installLogPath`.
