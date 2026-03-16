# polyVis

`polyVis` is now the main project structure for the Somnia Reactivity Mini Hackathon pivot: `PolySignal - Somnia Reactive Trading Advisory Dashboard`.

## Current structure

- `contracts/`
  - `PolymarketTradeBridge.sol`: production bridge contract for relayed Polymarket trades on Somnia.
  - `MockPolymarket.sol`: compatibility wrapper kept for the old contract name.
  - `PolySignalReactive.sol`: subscribes with Somnia native reactivity and emits `AlphaSignal`.
- `scripts/`
  - `fetchPolymarketData.js`: fetches market metadata from Gamma and real `OrderFilled` trades from Polygon, then saves a local JSON snapshot.
  - `relayPolymarketTrade.js`: forwards a detected whale trade to `PolymarketTradeBridge` on Somnia.
  - `deploy.js`: deploys both Phase 1 contracts.
  - `startRealtimeDashboard.js`: runs a live ingestion loop, relays whale trades to Somnia testnet, and serves a dashboard over SSE.
- `public/`
  - live dashboard assets served by the Node runtime.
- `.env` / `.env.example`
  - root-level configuration for Polygon RPC, Somnia RPC, relayer account, market slug, and deployed contract addresses.
- `polyFake/`
  - legacy reference only; the root project no longer depends on it.

## Why this matches the hackathon requirement

The relayer only forwards a Polygon trade into Somnia.

The actual signal generation is on-chain:

1. `relayPolymarketTrade.js` or `startRealtimeDashboard.js` sends a normalized trade to `PolymarketTradeBridge.logTrade(...)`.
2. `PolymarketTradeBridge` emits `TradeBridged(...)`.
3. Somnia reactivity calls `PolySignalReactive.onEvent(...)`.
4. `PolySignalReactive` evaluates the trade and emits `AlphaSignal(...)`.

This means the analysis path is not driven by a backend polling loop or cron job.

## How Polymarket data is fetched

The root scripts now include the Polymarket data fetching logic directly, so you can delete `polyFake/` later without breaking the prototype.

- Market metadata source: Gamma API
  - `question`
  - `conditionId`
  - `clobTokenIds`
  - `outcomePrices`
- On-chain truth source: Polygon exchange logs
  - `OrderFilled` from `CTF Exchange`
  - `OrderFilled` from `NegRisk Exchange`

The scripts decode the trade using the same logic as the old `polyFake` implementation:

- `makerAssetId == 0` means a buy using USDC.
- `takerAssetId == 0` means the other side is selling the outcome token.
- the non-zero asset ID is the Polymarket outcome token ID.

## Commands

```bash
npm install
cp .env.example .env
npm run compile
npm run deploy:somnia
npm start
```

Open `http://localhost:3000` after startup to watch the live dashboard.
