#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

set -a
source ./.env
set +a
source ./scripts/lib/proxy-env.sh

if [[ -n "${PRIVATE_KEY:-}" && "${PRIVATE_KEY}" != 0x* ]]; then
  export PRIVATE_KEY="0x${PRIVATE_KEY}"
fi

cast wallet address --private-key "$PRIVATE_KEY"
