#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

set -a
source ./.env
set +a
source ./scripts/lib/proxy-env.sh

cast chain-id --rpc-url "$SOMNIA_RPC_URL"
