# polyVis

English is the default documentation language for this repository.

Chinese entry:
[中文说明 / README.zh-CN.md](/Users/jiahuaiyu/develop/hackthon/polyVis/README.zh-CN.md)

`polyVis` is the main project structure for the Somnia Reactivity Mini Hackathon pivot:
`PolySignal - Somnia Reactive Trading Advisory Dashboard`.

The project is `Foundry-first`, proxy-aware for Clash Verge, and centered on a Somnia-native reactive flow:
live Polymarket trades are relayed into Somnia, Somnia subscriptions trigger the reactive contract on-chain, and the dashboard consumes the resulting `AlphaSignal` events.

## Overview

- `contracts/`
  - `PolymarketTradeBridge.sol`: bridge contract that receives relayed Polymarket trades on Somnia.
  - `PolySignalReactive.sol`: Somnia reactive handler that evaluates 8 anomaly rules and emits `AlphaSignal`.
  - `PolySignalAccessPass.sol`: minimal premium access contract for wallet-gated dashboard unlocks.
  - `MockPolymarket.sol`: compatibility wrapper kept for the old contract name.
- `scripts/`
  - `fetchPolymarketData.js`: fetches Gamma market metadata and Polygon `OrderFilled` logs into a local snapshot.
  - `relayPolymarketTrade.js`: relays a suspicious Polymarket trade into `PolymarketTradeBridge`.
  - `startRealtimeDashboard.js`: runs the live ingestion loop and serves the dashboard.
  - `deploy-foundry.sh`: deploys bridge, reactive contract, and access pass.
  - `create-subscription.sh`: creates the Somnia native subscription.
  - `doctor.sh`: checks Somnia RPC, Polygon RPC, Gamma API, and relayer identity.
- `scripts/lib/`
  - `proxy.js` / `proxy-env.sh`: applies Clash Verge proxy settings.
  - `anomaly.js`: computes the relayed anomaly profile.
  - `reactiveSignal.js`: mirrors the on-chain signal evaluation for local previewing.
- `public/`
  - browser dashboard assets, including wallet connect and premium unlock UI.
- `.env` / `.env.example`
  - root-level runtime configuration.

## Why This Satisfies Somnia Reactivity

The relayer only forwards Polymarket trades into Somnia.

The actual trigger decision is on-chain:

1. A suspicious Polymarket trade is normalized and sent to `PolymarketTradeBridge.logTrade(...)`.
2. `PolymarketTradeBridge` emits `TradeBridged(...)`.
3. Somnia native subscription infrastructure detects that event.
4. Somnia calls `PolySignalReactive.onEvent(...)`.
5. `PolySignalReactive` evaluates the trade on-chain and emits `AlphaSignal(...)` if thresholds are met.

That means the advisory trigger is not driven by a cron job or a backend event loop.

## Eight Reactive Rules

The current prototype relays a structured anomaly profile and then evaluates these rule classes on-chain:

1. `NEW_WALLET_WHALE`
2. `HIGH_CONVICTION_ENTRY`
3. `RAPID_ACCUMULATION`
4. `SAME_SIDE_STREAK`
5. `COUNTERPARTY_CONCENTRATION`
6. `MARKET_IMPACT_SPIKE`
7. `WASH_CLUSTER`
8. `SMART_MONEY_FOLLOWTHROUGH`

The relayer derives the metrics from live Polymarket `OrderFilled` history, but the final trigger still happens inside `PolySignalReactive` on Somnia.

## Wallet And Premium Access

The dashboard now includes a minimal user-facing monetization flow:

- `Connect Wallet` in the top bar
- `PolySignalAccessPass` on Somnia
- `Unlock Premium` button in the alpha panel
- premium-gated `Alpha Signal Feed`
- premium-gated detailed trade explanations

The current minimal access model uses Somnia native `STT` payment through `purchaseAccess()`.

## How Polymarket Data Is Fetched

The root scripts include the Polymarket fetching logic directly, so the prototype does not depend on `polyFake/`.

- Market metadata source: Gamma API
  - `question`
  - `conditionId`
  - `clobTokenIds`
  - `outcomePrices`
  - active market pagination
- On-chain truth source: Polygon exchange logs
  - `OrderFilled` from `CTF Exchange`
  - `OrderFilled` from `NegRisk Exchange`

Trade decoding rules:

- `makerAssetId == 0` means a buy using USDC.
- `takerAssetId == 0` means the other side is selling the outcome token.
- the non-zero asset ID is the Polymarket outcome token ID.

## Commands

```bash
npm install
cp .env.example .env
npm run doctor
npm run compile
npm run deploy:somnia
npm run subscribe:somnia
npm run relayer:address
npm start
```

Open `http://localhost:3000` after startup to use the dashboard.

## Deployment Notes

`npm run deploy:somnia` now deploys three contracts and writes them back into `.env`:

- `POLYMARKET_TRADE_BRIDGE_ADDRESS`
- `POLYSIGNAL_REACTIVE_ADDRESS`
- `POLYSIGNAL_ACCESS_PASS_ADDRESS`

After each redeploy of the bridge or reactive contract, run:

```bash
npm run subscribe:somnia
```

because the Somnia subscription must point at the latest deployed addresses.

## Relayer Address

`RELAYER_ADDRESS` is the EOA that submits `logTrade(...)` into `PolymarketTradeBridge`.

In the simplest setup, use the address derived from the same `PRIVATE_KEY`:

```bash
npm run relayer:address
```

or directly:

```bash
cast wallet address --private-key "$PRIVATE_KEY"
```

The scripts accept `PRIVATE_KEY` with or without a `0x` prefix.

## Clash / VPN Notes

This project writes Clash defaults directly into `.env` and applies them from code.

- default mixed proxy: `127.0.0.1:7898`
- Node scripts automatically apply proxy envs from `scripts/lib/proxy.js`
- shell scripts automatically export proxy envs from `scripts/lib/proxy-env.sh`

If Somnia or Gamma still fails, run:

```bash
npm run doctor
```

## Somnia Legacy Gas

Somnia RPC may reject EIP-1559 fee estimation. The project defaults to legacy gas mode.

- `.env`: `SOMNIA_USE_LEGACY_TX=true`
- optional fixed gas price: `SOMNIA_GAS_PRICE_WEI=1000000000`

This affects:

- `npm run deploy:somnia`
- `npm run subscribe:somnia`
- `npm run relay:trade`
- `npm start`
