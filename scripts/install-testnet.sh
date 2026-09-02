#!/usr/bin/env bash
# Install an emitted context-rule.json into the TESTNET smart account, signing
# client-side with the .env key (the labelled local-signer fallback).
#
#   scripts/install-testnet.sh <context-rule.json> [--dry-run] [extra install flags…]
#
# The account comes from examples/live/testnet/account.json (written by
# deploy-account.sh). The artifact is consumed UNMODIFIED: the installer
# validates it against the OZ install signature and refuses anything that would
# not install as-is. `--dry-run` simulates everything — including the
# hand-built authorization entries — and submits nothing. The secret is sourced
# from .env into the environment only; it is never an argument and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

ARTIFACT="${1:?usage: install-testnet.sh <context-rule.json> [--dry-run] [flags…]}"
shift
if [[ ! -f .env ]]; then echo "error: .env not found" >&2; exit 1; fi
set -a
# shellcheck disable=SC1091
source .env
set +a
: "${STELLAR_SECRET_KEY:?error: STELLAR_SECRET_KEY missing from .env}"
ACCOUNT=$(python3 -c 'import json;print(json.load(open("examples/live/testnet/account.json"))["account"])')
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="examples/live/testnet/install-${STAMP}.json"
if [[ " $* " == *" --dry-run "* ]]; then OUT="examples/live/testnet/install-dry-run-${STAMP}.json"; fi
npm run --silent cli -- install --artifact "$ARTIFACT" --account "$ACCOUNT" --network testnet --out "$OUT" "$@"
