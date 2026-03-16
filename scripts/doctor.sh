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

echo "[1/4] Somnia RPC chain id"
cast chain-id --rpc-url "$SOMNIA_RPC_URL"

echo "[2/4] Polygon RPC chain id"
cast chain-id --rpc-url "$POLYGON_RPC_URL"

echo "[3/4] Gamma API"
curl -I --max-time 20 https://gamma-api.polymarket.com/markets

echo "[4/4] Relayer address"
cast wallet address --private-key "$PRIVATE_KEY"
