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

SEPOLIA_RPC_URL="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
SEPOLIA_CHAIN_ID="${SEPOLIA_CHAIN_ID:-11155111}"
REACTIVE_RPC_URL="${REACTIVE_RPC_URL:-https://lasna-rpc.rnk.dev/}"
REACTIVE_CHAIN_ID="${REACTIVE_CHAIN_ID:-5318007}"
REACTIVE_CALLBACK_PROXY_ADDRESS="${REACTIVE_CALLBACK_PROXY_ADDRESS:-0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA}"
REACTIVE_DEPLOY_FUND_WEI="${REACTIVE_DEPLOY_FUND_WEI:-10000000000000000}"

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
  local rpc_url="$1"
  local chain_id="$2"
  local contract_id="$3"
  local gas_limit="$4"
  local value="$5"
  shift 5

  local output
  local -a args=(
    "$contract_id"
    --rpc-url "$rpc_url"
    --chain-id "$chain_id"
    --private-key "$PRIVATE_KEY"
    --gas-limit "$gas_limit"
    --broadcast
  )

  if [[ -n "$value" && "$value" != "0" ]]; then
    args+=(--value "$value")
  fi

  if [[ "$#" -gt 0 ]]; then
    args+=(--constructor-args "$@")
  fi

  output="$(forge create "${args[@]}" 2>&1)"
  printf '%s\n' "$output" >&2
  printf '%s\n' "$output" | awk '/Deployed to:/ { print $3 }' | tail -n 1
}

RELAYER="$(resolve_relayer)"
ORIGIN_GAS_LIMIT="${SEPOLIA_DEPLOY_ORIGIN_GAS_LIMIT:-5500000}"
DESTINATION_GAS_LIMIT="${SEPOLIA_DEPLOY_DESTINATION_GAS_LIMIT:-6500000}"
REACTIVE_GAS_LIMIT="${REACTIVE_DEPLOY_GAS_LIMIT:-9000000}"

ORIGIN_ADDRESS="$(
  deploy_contract \
    "$SEPOLIA_RPC_URL" \
    "$SEPOLIA_CHAIN_ID" \
    "contracts/reactive/PolySignalOrigin.sol:PolySignalOrigin" \
    "$ORIGIN_GAS_LIMIT" \
    "0" \
    "$RELAYER" \
    "$RELAYER"
)"

DESTINATION_ADDRESS="$(
  deploy_contract \
    "$SEPOLIA_RPC_URL" \
    "$SEPOLIA_CHAIN_ID" \
    "contracts/reactive/PolySignalDestination.sol:PolySignalDestination" \
    "$DESTINATION_GAS_LIMIT" \
    "${DESTINATION_DEPLOY_FUND_WEI:-10000000000000000}" \
    "$REACTIVE_CALLBACK_PROXY_ADDRESS" \
    "$RELAYER"
)"

REACTIVE_ADDRESS="$(
  deploy_contract \
    "$REACTIVE_RPC_URL" \
    "$REACTIVE_CHAIN_ID" \
    "contracts/reactive/PolySignalReactiveNetwork.sol:PolySignalReactiveNetwork" \
    "$REACTIVE_GAS_LIMIT" \
    "$REACTIVE_DEPLOY_FUND_WEI" \
    "$SEPOLIA_CHAIN_ID" \
    "$SEPOLIA_CHAIN_ID" \
    "$ORIGIN_ADDRESS" \
    "$DESTINATION_ADDRESS"
)"

update_env_value "RELAYER_ADDRESS" "$RELAYER"
update_env_value "SEPOLIA_CHAIN_ID" "$SEPOLIA_CHAIN_ID"
update_env_value "SEPOLIA_RPC_URL" "$SEPOLIA_RPC_URL"
update_env_value "REACTIVE_CHAIN_ID" "$REACTIVE_CHAIN_ID"
update_env_value "REACTIVE_RPC_URL" "$REACTIVE_RPC_URL"
update_env_value "REACTIVE_CALLBACK_PROXY_ADDRESS" "$REACTIVE_CALLBACK_PROXY_ADDRESS"
update_env_value "POLYSIGNAL_ORIGIN_ADDRESS" "$ORIGIN_ADDRESS"
update_env_value "POLYSIGNAL_DESTINATION_ADDRESS" "$DESTINATION_ADDRESS"
update_env_value "POLYSIGNAL_REACTIVE_RC_ADDRESS" "$REACTIVE_ADDRESS"

printf 'Origin deployed on Sepolia: %s\n' "$ORIGIN_ADDRESS"
printf 'Destination deployed on Sepolia: %s\n' "$DESTINATION_ADDRESS"
printf 'Reactive contract deployed on Lasna: %s\n' "$REACTIVE_ADDRESS"
