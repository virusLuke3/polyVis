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

resolve_relayer() {
  if [[ -n "${RELAYER_ADDRESS:-}" && "${RELAYER_ADDRESS}" != "0x0000000000000000000000000000000000000000" ]]; then
    printf '%s\n' "$RELAYER_ADDRESS"
    return
  fi

  cast wallet address --private-key "$PRIVATE_KEY"
}

update_env_value() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" .env; then
    perl -0pi -e "s#^${key}=.*#${key}=${value}#m" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

deploy_contract() {
  local contract_id="$1"
  local gas_limit="$2"
  shift 2

  local output
  local -a args=(
    "$contract_id"
    --rpc-url "$SOMNIA_RPC_URL"
    --private-key "$PRIVATE_KEY"
    --broadcast
    --gas-limit "$gas_limit"
  )

  if [[ "${SOMNIA_USE_LEGACY_TX:-true}" == "true" ]]; then
    args+=(--legacy)
  fi

  if [[ -n "${SOMNIA_GAS_PRICE_WEI:-}" ]]; then
    args+=(--gas-price "$SOMNIA_GAS_PRICE_WEI")
  fi

  if [[ "$#" -gt 0 ]]; then
    args+=(--constructor-args "$@")
  fi

  output="$(forge create "${args[@]}" 2>&1)"
  printf '%s\n' "$output" >&2

  printf '%s\n' "$output" | awk '/Deployed to:/ { print $3 }' | tail -n 1
}

RELAYER="$(resolve_relayer)"
BRIDGE_GAS_LIMIT="${SOMNIA_DEPLOY_BRIDGE_GAS_LIMIT:-6000000}"
REACTIVE_GAS_LIMIT="${SOMNIA_DEPLOY_REACTIVE_GAS_LIMIT:-10000000}"
ACCESS_PASS_GAS_LIMIT="${SOMNIA_DEPLOY_ACCESS_PASS_GAS_LIMIT:-3000000}"
PREMIUM_PRICE_WEI="${POLYSIGNAL_PREMIUM_PRICE_WEI:-10000000000000000}"
ACCESS_DURATION_DAYS="${POLYSIGNAL_ACCESS_DURATION_DAYS:-30}"
ACCESS_DURATION_SECONDS="$(( ACCESS_DURATION_DAYS * 24 * 60 * 60 ))"

BRIDGE_ADDRESS="$(
  deploy_contract \
    "contracts/PolymarketTradeBridge.sol:PolymarketTradeBridge" \
    "$BRIDGE_GAS_LIMIT" \
    "$RELAYER" \
    "$RELAYER"
)"

REACTIVE_ADDRESS="$(
  deploy_contract \
    "contracts/PolySignalReactive.sol:PolySignalReactive" \
    "$REACTIVE_GAS_LIMIT" \
    "$BRIDGE_ADDRESS" \
    "$SOMNIA_REACTIVITY_PRECOMPILE"
)"

ACCESS_PASS_ADDRESS="$(
  deploy_contract \
    "contracts/PolySignalAccessPass.sol:PolySignalAccessPass" \
    "$ACCESS_PASS_GAS_LIMIT" \
    "$RELAYER" \
    "$PREMIUM_PRICE_WEI" \
    "$ACCESS_DURATION_SECONDS"
)"

update_env_value "RELAYER_ADDRESS" "$RELAYER"
update_env_value "MOCK_POLYMARKET_ADDRESS" "$BRIDGE_ADDRESS"
update_env_value "POLYMARKET_TRADE_BRIDGE_ADDRESS" "$BRIDGE_ADDRESS"
update_env_value "POLYSIGNAL_REACTIVE_ADDRESS" "$REACTIVE_ADDRESS"
update_env_value "POLYSIGNAL_ACCESS_PASS_ADDRESS" "$ACCESS_PASS_ADDRESS"
update_env_value "POLYSIGNAL_PREMIUM_PRICE_WEI" "$PREMIUM_PRICE_WEI"
update_env_value "POLYSIGNAL_ACCESS_DURATION_DAYS" "$ACCESS_DURATION_DAYS"

printf 'Bridge deployed: %s\n' "$BRIDGE_ADDRESS"
printf 'Reactive deployed: %s\n' "$REACTIVE_ADDRESS"
printf 'Access pass deployed: %s\n' "$ACCESS_PASS_ADDRESS"
