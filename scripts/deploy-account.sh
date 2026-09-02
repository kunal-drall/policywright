#!/usr/bin/env bash
# account:create — deploy + initialise the OpenZeppelin smart account on TESTNET
# with the .env ed25519 public key as its (Delegated) signer.
#
#   scripts/deploy-account.sh
#
# The account is OZ's own example contract (contracts/multisig-account, vendored
# verbatim from stellar-contracts v0.7.2). Its constructor
# `__constructor(signers: Vec<Signer>, policies: Map<Address, Val>)` creates the
# Default admin rule (id 0); we pass ONE `Delegated(G)` signer — the .env public
# key — and no policies (FACTS.md §8.1). Delegated needs no verifier contract.
#
# Prints the C-address, writes examples/live/testnet/account.json, and appends
# the deploy row to evidence/EVIDENCE.md (via deploy-testnet.sh). Human-initiated,
# signed with the .env key, TESTNET only. The secret is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "error: .env not found — create it with STELLAR_SECRET_KEY / STELLAR_PUBLIC_KEY" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
: "${STELLAR_PUBLIC_KEY:?error: STELLAR_PUBLIC_KEY missing from .env}"

SIGNERS_JSON="[{\"Delegated\":\"${STELLAR_PUBLIC_KEY}\"}]"
echo "==> smart account signer: Delegated(${STELLAR_PUBLIC_KEY})"

OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
scripts/deploy-testnet.sh multisig-account -- --signers "$SIGNERS_JSON" --policies '{}' | tee "$OUT"

CONTRACT_ID=$(grep -E '^contract id :' "$OUT" | awk '{print $NF}')
WASM_HASH=$(grep -E '^wasm hash   :' "$OUT" | awk '{print $NF}')
DEPLOY_TX=$(grep -E '^deploy tx   :' "$OUT" | awk '{print $NF}')
UPLOAD_TX=$(grep -E '^upload tx   :' "$OUT" | sed 's/^upload tx   : //')

mkdir -p examples/live/testnet
cat > examples/live/testnet/account.json <<JSON
{
  "network": "testnet",
  "account": "${CONTRACT_ID}",
  "wasmHash": "${WASM_HASH}",
  "deployTx": "${DEPLOY_TX}",
  "uploadTx": "${UPLOAD_TX}",
  "adminRuleId": 0,
  "adminSigners": [{ "type": "Delegated", "address": "${STELLAR_PUBLIC_KEY}" }],
  "deployer": "${STELLAR_PUBLIC_KEY}",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "contracts/multisig-account (OpenZeppelin stellar-contracts v0.7.2 examples/multisig-smart-account/account, vendored verbatim)"
}
JSON
echo ''
echo "smart account : $CONTRACT_ID"
echo "recorded in   : examples/live/testnet/account.json (and evidence/EVIDENCE.md deployment log)"
