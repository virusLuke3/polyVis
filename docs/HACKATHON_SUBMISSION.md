# PolySignal Hackathon Submission

Use this file as the final judge-facing submission checklist after live deployment.

## Problem

Polymarket whale trades and coordinated flows appear on Polygon in real time, but a normal dashboard or backend cannot provide a trust-minimized, chain-native automation path by itself. We want an on-chain system that observes suspicious trade summaries, reacts automatically, and writes the final alpha alert to a destination contract without manual intervention.

## Why Reactive Network is necessary

This project uses Reactive Network to:

1. listen to `TradeSignalObserved` emitted by the Origin contract
2. execute the anomaly evaluation inside a Reactive Contract
3. automatically trigger a destination callback transaction
4. persist the final alert in a separate destination contract

Without Reactive Network, the workflow would fall back to a centralized bot or cron service.

## Contracts

| Role | Network | Address |
| --- | --- | --- |
| Origin: `PolySignalOrigin` | Sepolia | `0xe355af321d4C2ED8CeDDc5778AcEe951dF65207F` |
| Destination: `PolySignalDestination` | Sepolia | `0xfa1E65E91bD0fC1E737181AD3B483D17efA0026D` |
| Reactive: `PolySignalReactiveNetwork` | Reactive Lasna | `0xA2fDAB7ef7BA944e4E404bF6AdC091cA49679C92` |

## Repository paths

- Origin contract: `contracts/reactive/PolySignalOrigin.sol`
- Reactive contract: `contracts/reactive/PolySignalReactiveNetwork.sol`
- Destination contract: `contracts/reactive/PolySignalDestination.sol`
- Deploy script: `scripts/deploy-reactive-foundry.sh`
- Relay script: `scripts/relayPolymarketToOrigin.js`
- Local workflow test: `test/PolySignalReactiveNetwork.js`

## Post-deployment workflow

1. Deploy `PolySignalOrigin` to Sepolia.
2. Deploy `PolySignalDestination` to Sepolia.
3. Deploy `PolySignalReactiveNetwork` to Reactive Lasna with the Sepolia origin and destination addresses.
4. Run the relay script to detect a real suspicious Polymarket trade and submit it to `PolySignalOrigin`.
5. Reactive Network observes `TradeSignalObserved`.
6. The Reactive Contract executes `react(...)` automatically.
7. The Reactive Contract emits `Callback(...)`.
8. The callback reaches `PolySignalDestination.recordSignal(...)`.
9. The final alpha signal is stored on-chain.

## Transaction hashes

| Step | Network | Tx hash |
| --- | --- | --- |
| Deploy Origin | Sepolia | `0x6e0dd70c0621af28260ec41e1f226c33a6ed9d1dca47c3c6bcbf389a0619ee5c` |
| Deploy Destination | Sepolia | `0xc0af92b44199725f3a36ed516dde186ae9982c5d0caa6af66884c7f44e9ac0e4` |
| Deploy Reactive Contract | Reactive Lasna | `0xc2337349961190b8d2c27977b4116336847ac6d467413bc353db8fbe266d6e6c` |
| Origin trade relay: `reportTradeSignal(...)` | Sepolia | `0xb967e57985c3d380e92592a1dc176f7aedfb356e533d197d7212274aefd649ee` |
| Reactive execution / callback emission | Reactive Lasna | `0xafbc42174e6d2aee767dcb1f8eeb29016d0c5c69ab423bc636405243874aff3f` |
| Destination callback: `recordSignal(...)` | Sepolia | `0xe082e349e4edaa7425622f1ed5c53608bcde01a2a43ae551af70963c099d9c3d` |

## Notes for judges

- The repository contains a full custom Origin contract.
- The repository contains a standard Reactive Contract built on `AbstractReactive`.
- The repository contains a standard destination callback contract built on `AbstractCallback`.
- The repository includes deployment and relay scripts.
- The repository includes a local end-to-end test covering the full workflow.
- Live deployment is complete for the three core contracts.
- One live end-to-end workflow run is complete and recorded above.
