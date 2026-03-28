# Hackathon Requirements Status

This document evaluates the current `polyVis / PolySignal` repository against the hackathon eligibility checklist.

## Overall conclusion

The project now satisfies the **core technical architecture requirements**:

- it includes a real Origin contract
- it includes a standard Reactive Contract
- it includes a standard Destination callback contract
- it includes deployment and relay scripts
- it explains the problem, solution, and workflow
- it publicly records the deployed contract addresses

However, the project is **not yet fully submission-complete** as of this document, because two required deliverables are still missing:

1. the **full live workflow transaction hash record**
2. the **demo video**

So the honest status is:

- `Technically aligned`: **Yes**
- `Fully submission-ready right now`: **No, not yet**

## Requirement-by-requirement check

### 1. Valid use of Reactive Contracts

Status: **Satisfied**

Evidence:

- Reactive contract: [PolySignalReactiveNetwork.sol](../contracts/reactive/PolySignalReactiveNetwork.sol)
- Origin contract emits `TradeSignalObserved`
- Reactive contract subscribes to that event on the origin chain
- Reactive contract emits `Callback(...)`
- Destination callback contract receives the automated result via `recordSignal(...)`

Why this counts:

- this is not just a normal Solidity contract deployed somewhere
- the Reactive Contract is explicitly designed to listen for an EVM event and automatically trigger the next transaction

### 2. Full contract code in the repository

Status: **Satisfied**

Evidence:

- Origin: [PolySignalOrigin.sol](../contracts/reactive/PolySignalOrigin.sol)
- Reactive: [PolySignalReactiveNetwork.sol](../contracts/reactive/PolySignalReactiveNetwork.sol)
- Destination: [PolySignalDestination.sol](../contracts/reactive/PolySignalDestination.sol)
- Deploy script: [deploy-reactive-foundry.sh](../scripts/deploy-reactive-foundry.sh)
- Relay script: [relayPolymarketToOrigin.js](../scripts/relayPolymarketToOrigin.js)
- Usage docs: [README.md](../README.md)

### 3. Include Origin contract if applicable

Status: **Satisfied**

Evidence:

- custom Origin contract included: [PolySignalOrigin.sol](../contracts/reactive/PolySignalOrigin.sol)
- deployment path documented in [README.md](../README.md)

### 4. Publicly disclose all deployed contract addresses

Status: **Satisfied**

Deployed addresses:

- Origin `PolySignalOrigin` on Sepolia:
  - `0xe355af321d4C2ED8CeDDc5778AcEe951dF65207F`
- Destination `PolySignalDestination` on Sepolia:
  - `0xfa1E65E91bD0fC1E737181AD3B483D17efA0026D`
- Reactive `PolySignalReactiveNetwork` on Reactive Lasna:
  - `0xA2fDAB7ef7BA944e4E404bF6AdC091cA49679C92`

Also recorded in:

- [HACKATHON_SUBMISSION.md](./HACKATHON_SUBMISSION.md)

### 5. Explain the problem and solution

Status: **Satisfied**

Evidence:

- problem/solution narrative in [README.md](../README.md)
- submission summary in [HACKATHON_SUBMISSION.md](./HACKATHON_SUBMISSION.md)

Current framing:

- Problem: Polymarket whale trades are visible, but ordinary dashboards and bots cannot provide trust-minimized, on-chain reactive automation.
- Solution: relay suspicious trade summaries into an Origin contract, let a Reactive Contract observe the event and automatically trigger the destination callback, then persist the alpha signal on-chain.

### 6. Provide a post-deployment workflow description

Status: **Satisfied**

Evidence:

- step-by-step workflow in [README.md](../README.md)
- step-by-step workflow in [HACKATHON_SUBMISSION.md](./HACKATHON_SUBMISSION.md)

### 7. Provide full transaction hash records for the whole workflow

Status: **Partially satisfied**

What is already available:

- Deploy Origin tx hash:
  - `0x6e0dd70c0621af28260ec41e1f226c33a6ed9d1dca47c3c6bcbf389a0619ee5c`
- Deploy Destination tx hash:
  - `0xc0af92b44199725f3a36ed516dde186ae9982c5d0caa6af66884c7f44e9ac0e4`
- Deploy Reactive tx hash:
  - `0xc2337349961190b8d2c27977b4116336847ac6d467413bc353db8fbe266d6e6c`
- Origin workflow tx hash:
  - `0xb967e57985c3d380e92592a1dc176f7aedfb356e533d197d7212274aefd649ee`
- Reactive execution tx hash:
  - `0xafbc42174e6d2aee767dcb1f8eeb29016d0c5c69ab423bc636405243874aff3f`
- Destination callback tx hash:
  - `0xe082e349e4edaa7425622f1ed5c53608bcde01a2a43ae551af70963c099d9c3d`

What is still missing:

- no tx hash is missing for one complete live workflow
- if you want multiple demo runs in the final submission, record additional workflow hashes as well

Why this matters:

- the rules explicitly require that the team actually run the full workflow
- deployment tx hashes alone are not enough, but this repository now includes one full live workflow record

### 8. Demo video

Status: **Not satisfied yet**

Current state:

- no demo video artifact is stored or referenced in the repository yet

## Current verdict

If judged on architecture and repository completeness, this project is now in good shape.

If judged on final submission eligibility **today**, it is still missing:

1. the required demo video

## Recommended next steps

1. Record a demo video under 5 minutes and add its link to the submission package.
2. Optionally run more live workflows if you want multiple examples in the final materials.
3. Keep [HACKATHON_SUBMISSION.md](./HACKATHON_SUBMISSION.md) as the judge-facing source of truth.
