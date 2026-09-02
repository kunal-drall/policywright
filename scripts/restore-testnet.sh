#!/usr/bin/env bash
# Restore (and extend) archived TESTNET ledger entries for a deployed contract:
# the contract instance and, optionally, its wasm code entry.
#
#   scripts/restore-testnet.sh <contract-id> [wasm-hash] [ledgers-to-extend]
#
# Testnet archives persistent entries after minPersistentTTL (120960 ledgers ≈
# 7 days — FACTS.md §7.2); the D1.3 frequency-policy instance and its code
# entry are archived (FACTS §11.2). `stellar contract restore` is the
# human-initiated, signed step that brings them back; `extend` pushes the TTL
# out so they stay live for the T2 demo window. Appends a row to
# evidence/EVIDENCE.md. TESTNET only; the secret is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTRACT_ID="${1:?usage: restore-testnet.sh <contract-id> [wasm-hash] [ledgers-to-extend]}"
WASM_HASH="${2:-}"
EXTEND="${3:-518400}"   # 30 days at ~5 s/ledger

if [[ ! -f .env ]]; then echo "error: .env not found" >&2; exit 1; fi
set -a
# shellcheck disable=SC1091
source .env
set +a
: "${STELLAR_SECRET_KEY:?error: STELLAR_SECRET_KEY missing from .env}"
NETWORK="${STELLAR_NETWORK:-testnet}"
[[ "$NETWORK" == "testnet" ]] || { echo "error: testnet only" >&2; exit 1; }
export STELLAR_ACCOUNT="$STELLAR_SECRET_KEY"
unset STELLAR_RPC_URL STELLAR_NETWORK STELLAR_NETWORK_PASSPHRASE

ROWS=()
if [[ -n "$WASM_HASH" ]]; then
  echo "==> restoring wasm code entry $WASM_HASH"
  TTL=$(stellar contract restore --wasm-hash "$WASM_HASH" --network "$NETWORK" --ledgers-to-extend "$EXTEND" --ttl-ledger-only 2>&1 | tail -1)
  echo "    live until ledger: $TTL"
  ROWS+=("| wasm code \`$WASM_HASH\` | restored + extended by $EXTEND ledgers → live until ledger $TTL |")
fi
echo "==> restoring contract instance $CONTRACT_ID"
TTL=$(stellar contract restore --id "$CONTRACT_ID" --network "$NETWORK" --ledgers-to-extend "$EXTEND" --ttl-ledger-only 2>&1 | tail -1)
echo "    live until ledger: $TTL"
ROWS+=("| instance \`$CONTRACT_ID\` | restored + extended by $EXTEND ledgers → live until ledger $TTL |")

DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  echo ''
  echo "### $DATE_UTC — restore $CONTRACT_ID"
  echo ''
  echo "| Entry | Result |"
  echo "| --- | --- |"
  for r in "${ROWS[@]}"; do echo "$r"; done
  echo "| Signer | \`${STELLAR_PUBLIC_KEY:-unknown}\` (human-initiated \`stellar contract restore\`, testnet) |"
} >> evidence/EVIDENCE.md
echo "==> appended to evidence/EVIDENCE.md"
