# polyVis

English is the default documentation language for this repository.

Demo: https://youtu.be/9P1pz3HloqI
PPT: PolySignal_Reactive_Whale_Alerts.pptx

Chinese entry:
[中文说明 / README.zh-CN.md](./README.zh-CN.md)

`polyVis` is now structured as a Reactive Network hackathon submission for:
`PolySignal - Reactive Polymarket Whale Alert`.

The submission-ready path is no longer the legacy Somnia-only flow.
For the hackathon, the canonical workflow is:

`Polygon Polymarket trade -> Sepolia Origin -> Reactive Network RC on Lasna -> Sepolia Destination callback`

## Product Highlights

Here are the key aspects of our Somnia Reactivity Demo:

**1. Main Dashboard & Executable Context**  
![Main Dashboard](./figures/demo1.png)  
*The main hub displaying continuous real-time trading signals, actionable context, and our pure Web3-native premium wallet integration.*

**2. Somnia Reactivity Evidence Chain**  
![Evidence Chain](./figures/demo2.png)  
*Transparent end-to-end proof of reactivity. It tracks the pipeline from Polygon trade ingestion, Bridge relay passing, native subscription detection, to the final reactive evaluation entirely on-chain.*

**3. Premium On-Chain Alpha Feed**  
![Alpha Signal Feed](./figures/demo3.png)  
*Visualizing the high-conviction alerts computed directly by the Somnia reactive contract. Trades hitting the 8 anomaly rules are instantly shown to premium audiences.*

**4. Market Tracking & Anomaly Flow**  
![Tracked Markets](./figures/demo4.png)  
*The tracking directory flags suspicious Polymarket order flows, assigning anomaly profiles like "Same-side Streak" and "Market Impact Spike" natively via smart contracts.*

## Quick verdict

Before this refactor, the project was **not strong enough** for the Reactive Contracts requirement.

Why:

- the old `PolySignalReactive.sol` was a Somnia callback-style contract, not a standard Reactive Network RC built on `AbstractReactive`
- there was no standard Reactive Network destination callback contract
- there was no clear `Origin + Reactive + Destination` repository structure for judges to inspect
- the workflow and submission evidence sections were not organized around Reactive Network expectations

This repository now includes all required pieces for the Reactive Network version of the project.

## Contracts included

Reactive Network submission path:

- `contracts/reactive/PolySignalOrigin.sol`
  - custom Origin contract on Sepolia
  - receives relayed Polymarket anomaly summaries and emits `TradeSignalObserved`
- `contracts/reactive/PolySignalReactiveNetwork.sol`
  - standard Reactive Contract
  - built on `AbstractReactive`
  - subscribes to `TradeSignalObserved` on the origin chain
  - reacts automatically and emits a Reactive Network `Callback`
- `contracts/reactive/PolySignalDestination.sol`
  - Destination callback contract on Sepolia
  - built on `AbstractCallback`
  - receives the callback and stores the final alpha signal on-chain
- `contracts/mocks/MockReactiveCallbackProxy.sol`
  - local testing helper only

Vendored Reactive base files:

- `lib/reactive-lib/src/interfaces/IReactive.sol`
- `lib/reactive-lib/src/interfaces/ISystemContract.sol`
- `lib/reactive-lib/src/interfaces/ISubscriptionService.sol`
- `lib/reactive-lib/src/interfaces/IPayer.sol`
- `lib/reactive-lib/src/interfaces/IPayable.sol`
- `lib/reactive-lib/src/abstract-base/AbstractReactive.sol`
- `lib/reactive-lib/src/abstract-base/AbstractCallback.sol`
- `lib/reactive-lib/src/abstract-base/AbstractPayer.sol`

Legacy Somnia files are still present for reference, but they are **not** the main hackathon submission path anymore.

## Why Reactive Contracts matter here

Problem:

- Polymarket whale or coordinated trades appear on Polygon
- a normal dashboard or backend can detect them off-chain, but cannot produce a trust-minimized, chain-native automation path by itself
- if a team only logs results in a backend or manually calls a second contract, the system is not truly reactive

Reactive solution:

1. A suspicious Polymarket trade is relayed into `PolySignalOrigin` on Sepolia.
2. `PolySignalOrigin` emits `TradeSignalObserved`.
3. `PolySignalReactiveNetwork` on Reactive Network listens to that exact event subscription.
4. When the event appears, the RC evaluates the anomaly rules on-chain.
5. If thresholds are met, the RC emits a Reactive `Callback`.
6. The callback executes `recordSignal(...)` on `PolySignalDestination` on Sepolia.
7. The destination contract persists the alert on-chain as the final alpha signal feed.

Without the Reactive layer, this becomes much harder because:

- the detection and action path would depend on a centralized bot or cron
- cross-environment automation would not be verifiable from contract code alone
- the “listen for an event, then automatically trigger a destination transaction” property would be missing

## Repository workflow

### 1. Deploy contracts

```bash
npm install
cp .env.example .env
npm run deploy:reactive
```

This deploys:

- `PolySignalOrigin` to Sepolia
- `PolySignalDestination` to Sepolia
- `PolySignalReactiveNetwork` to Reactive Lasna

and writes the addresses back into `.env`.

### 2. Relay a real Polymarket trade into Origin

```bash
npm run relay:reactive
```

This script:

- fetches Polymarket market metadata from Gamma
- scans Polygon `OrderFilled` logs
- finds a large recent trade
- computes the anomaly profile
- submits `reportTradeSignal(...)` to `PolySignalOrigin`

### 3. Let Reactive Network process the event

After the origin transaction lands:

- Reactive Network observes the `TradeSignalObserved` event
- the RC on Lasna runs `react(...)`
- the RC emits a `Callback(...)`
- the callback proxy calls `recordSignal(...)` on `PolySignalDestination`

### 4. Record evidence for submission

Fill the contract addresses and transaction hashes in:

- `docs/HACKATHON_SUBMISSION.md`

## Commands

```bash
npm install
forge build
npm test
npm run deploy:reactive
npm run relay:reactive
```

## Local verification status

Local verification is already included:

- `forge build` passes
- `npm test` passes
- the test simulates the full flow:
  - Origin emits an event
  - Reactive contract receives the log
  - RC emits `Callback`
  - destination callback stores the signal

Main local test:

- `test/PolySignalReactiveNetwork.js`

## Networks and environment

Important `.env` values for the Reactive submission path:

- `SEPOLIA_RPC_URL`
- `SEPOLIA_CHAIN_ID=11155111`
- `REACTIVE_RPC_URL`
- `REACTIVE_CHAIN_ID=5318007`
- `REACTIVE_CALLBACK_PROXY_ADDRESS`
- `POLYSIGNAL_ORIGIN_ADDRESS`
- `POLYSIGNAL_DESTINATION_ADDRESS`
- `POLYSIGNAL_REACTIVE_RC_ADDRESS`

Relevant scripts:

- `scripts/deploy-reactive-foundry.sh`
- `scripts/relayPolymarketToOrigin.js`

## Submission checklist mapping

The hackathon requirements are covered like this:

- valid use of Reactive Contracts
  - `contracts/reactive/PolySignalReactiveNetwork.sol`
- full contract code
  - Origin, Reactive, Destination, deploy scripts, relay script, docs are all in-repo
- Origin contract included
  - `contracts/reactive/PolySignalOrigin.sol`
- deployed contract addresses
  - fill `docs/HACKATHON_SUBMISSION.md`
- explain problem and solution
  - this README + `docs/HACKATHON_SUBMISSION.md`
- post-deployment workflow
  - this README + `docs/HACKATHON_SUBMISSION.md`
- full transaction hash record
  - fill `docs/HACKATHON_SUBMISSION.md` after running on live networks

## Important note

I completed the repository refactor, local compile, and local end-to-end test.

What still requires your live wallet / RPC funding:

- actual Sepolia deployment
- actual Lasna deployment
- actual callback execution on live Reactive Network
- final contract addresses
- final origin / reactive / destination transaction hashes

Those live values cannot be truthfully pre-filled without your wallet, funds, and a real deployment run.
