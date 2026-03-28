// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "lib/reactive-lib/src/interfaces/IReactive.sol";
import "lib/reactive-lib/src/abstract-base/AbstractReactive.sol";

contract PolySignalReactiveNetwork is IReactive, AbstractReactive {
    struct EvaluatedSignal {
        bool shouldDispatch;
        uint8 analysisCode;
        uint16 matchedFlags;
        uint16 finalRiskScoreBps;
        string thesis;
    }

    uint16 internal constant FLAG_NEW_WALLET_WHALE = 1 << 0;
    uint16 internal constant FLAG_HIGH_CONVICTION_ENTRY = 1 << 1;
    uint16 internal constant FLAG_RAPID_ACCUMULATION = 1 << 2;
    uint16 internal constant FLAG_SAME_SIDE_STREAK = 1 << 3;
    uint16 internal constant FLAG_COUNTERPARTY_CONCENTRATION = 1 << 4;
    uint16 internal constant FLAG_MARKET_IMPACT_SPIKE = 1 << 5;
    uint16 internal constant FLAG_WASH_CLUSTER = 1 << 6;
    uint16 internal constant FLAG_SMART_MONEY_FOLLOWTHROUGH = 1 << 7;

    uint256 internal constant TRADE_SIGNAL_OBSERVED_TOPIC_0 =
        uint256(
            keccak256(
                "TradeSignalObserved(bytes32,bytes32,address,uint256,uint8,uint64,uint32,uint256,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,string)"
            )
        );
    uint64 internal constant CALLBACK_GAS_LIMIT = 1_200_000;

    uint256 public immutable originChainId;
    uint256 public immutable destinationChainId;
    address public immutable originContract;
    address public immutable destinationContract;

    event ReactiveSignalEvaluated(
        bytes32 indexed sourceTradeId,
        bytes32 indexed marketId,
        address indexed trader,
        uint8 analysisCode,
        uint16 matchedFlags,
        uint16 finalRiskScoreBps,
        string thesis
    );

    constructor(
        uint256 originChainId_,
        uint256 destinationChainId_,
        address originContract_,
        address destinationContract_
    ) payable {
        originChainId = originChainId_;
        destinationChainId = destinationChainId_;
        originContract = originContract_;
        destinationContract = destinationContract_;

        if (!vm) {
            service.subscribe(
                originChainId_,
                originContract_,
                TRADE_SIGNAL_OBSERVED_TOPIC_0,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
        }
    }

    function react(LogRecord calldata log) external vmOnly {
        if (log.chain_id != originChainId) return;
        if (log._contract != originContract) return;
        if (log.topic_0 != TRADE_SIGNAL_OBSERVED_TOPIC_0) return;

        (
            uint256 amount,
            uint8 direction,
            uint64 accountAgeDays,
            uint32 oddsBps,
            uint256 totalPositionUsd,
            uint16 relayedFlags,
            uint16 relayedRiskScoreBps,
            uint16 recentTradeCount,
            uint16 sameSideStreak,
            uint16 counterpartyConcentrationBps,
            uint16 marketImpactBps,
            uint16 washClusterScoreBps,
            uint16 smartMoneyScoreBps,
            uint64 observedAt,
            string memory marketTitle
        ) = abi.decode(
                log.data,
                (uint256, uint8, uint64, uint32, uint256, uint16, uint16, uint16, uint16, uint16, uint16, uint16, uint16, uint64, string)
            );

        EvaluatedSignal memory evaluation = evaluateTrade(
            amount,
            accountAgeDays,
            oddsBps,
            totalPositionUsd,
            relayedFlags,
            relayedRiskScoreBps,
            recentTradeCount,
            sameSideStreak,
            counterpartyConcentrationBps,
            marketImpactBps,
            washClusterScoreBps,
            smartMoneyScoreBps
        );

        if (!evaluation.shouldDispatch) return;

        bytes32 sourceTradeId = bytes32(log.topic_1);
        bytes32 marketId = bytes32(log.topic_2);
        address trader = address(uint160(log.topic_3));

        emit ReactiveSignalEvaluated(
            sourceTradeId,
            marketId,
            trader,
            evaluation.analysisCode,
            evaluation.matchedFlags,
            evaluation.finalRiskScoreBps,
            evaluation.thesis
        );

        bytes memory payload = abi.encodeWithSignature(
            "recordSignal(address,bytes32,bytes32,address,uint256,uint8,uint8,uint16,uint16,uint16,uint32,uint256,uint64,string,string)",
            address(this),
            sourceTradeId,
            marketId,
            trader,
            amount,
            direction,
            evaluation.analysisCode,
            evaluation.matchedFlags,
            relayedFlags,
            evaluation.finalRiskScoreBps,
            oddsBps,
            totalPositionUsd,
            observedAt,
            marketTitle,
            evaluation.thesis
        );

        emit Callback(destinationChainId, destinationContract, CALLBACK_GAS_LIMIT, payload);
    }

    function evaluateTrade(
        uint256 amount,
        uint64 accountAgeDays,
        uint32 oddsBps,
        uint256 totalPositionUsd,
        uint16, /*relayedFlags*/
        uint16 relayedRiskScoreBps,
        uint16 recentTradeCount,
        uint16 sameSideStreak,
        uint16 counterpartyConcentrationBps,
        uint16 marketImpactBps,
        uint16 washClusterScoreBps,
        uint16 smartMoneyScoreBps
    ) public pure returns (EvaluatedSignal memory evaluation) {
        uint16 matchedFlags;

        if (amount >= 25_000e6 && accountAgeDays <= 7) matchedFlags |= FLAG_NEW_WALLET_WHALE;
        if (oddsBps >= 6_000 && amount >= 12_500e6) matchedFlags |= FLAG_HIGH_CONVICTION_ENTRY;
        if (recentTradeCount >= 3 && totalPositionUsd >= 40_000e6) matchedFlags |= FLAG_RAPID_ACCUMULATION;
        if (sameSideStreak >= 3) matchedFlags |= FLAG_SAME_SIDE_STREAK;
        if (counterpartyConcentrationBps >= 6_500) matchedFlags |= FLAG_COUNTERPARTY_CONCENTRATION;
        if (marketImpactBps >= 450) matchedFlags |= FLAG_MARKET_IMPACT_SPIKE;
        if (washClusterScoreBps >= 6_000) matchedFlags |= FLAG_WASH_CLUSTER;
        if (smartMoneyScoreBps >= 7_000) matchedFlags |= FLAG_SMART_MONEY_FOLLOWTHROUGH;

        if (matchedFlags == 0) {
            return evaluation;
        }

        uint16 derivedRisk;
        if ((matchedFlags & FLAG_NEW_WALLET_WHALE) != 0) derivedRisk += 2200;
        if ((matchedFlags & FLAG_HIGH_CONVICTION_ENTRY) != 0) derivedRisk += 1200;
        if ((matchedFlags & FLAG_RAPID_ACCUMULATION) != 0) derivedRisk += 1300;
        if ((matchedFlags & FLAG_SAME_SIDE_STREAK) != 0) derivedRisk += 900;
        if ((matchedFlags & FLAG_COUNTERPARTY_CONCENTRATION) != 0) derivedRisk += 1200;
        if ((matchedFlags & FLAG_MARKET_IMPACT_SPIKE) != 0) derivedRisk += 1300;
        if ((matchedFlags & FLAG_WASH_CLUSTER) != 0) derivedRisk += 1600;
        if ((matchedFlags & FLAG_SMART_MONEY_FOLLOWTHROUGH) != 0) derivedRisk += 1500;
        if (derivedRisk > 10_000) derivedRisk = 10_000;

        uint16 finalRiskScoreBps = derivedRisk > relayedRiskScoreBps
            ? derivedRisk
            : relayedRiskScoreBps;
        if (finalRiskScoreBps < 3_000) {
            return evaluation;
        }

        uint8 analysisCode;
        if ((matchedFlags & FLAG_NEW_WALLET_WHALE) != 0) analysisCode = 1;
        else if ((matchedFlags & FLAG_SMART_MONEY_FOLLOWTHROUGH) != 0) analysisCode = 8;
        else if ((matchedFlags & FLAG_WASH_CLUSTER) != 0) analysisCode = 7;
        else if ((matchedFlags & FLAG_MARKET_IMPACT_SPIKE) != 0) analysisCode = 6;
        else if ((matchedFlags & FLAG_COUNTERPARTY_CONCENTRATION) != 0) analysisCode = 5;
        else if ((matchedFlags & FLAG_RAPID_ACCUMULATION) != 0) analysisCode = 3;
        else if ((matchedFlags & FLAG_SAME_SIDE_STREAK) != 0) analysisCode = 4;
        else if ((matchedFlags & FLAG_HIGH_CONVICTION_ENTRY) != 0) analysisCode = 2;

        evaluation.shouldDispatch = true;
        evaluation.analysisCode = analysisCode;
        evaluation.matchedFlags = matchedFlags;
        evaluation.finalRiskScoreBps = finalRiskScoreBps;
        evaluation.thesis = thesisForAnalysisCode(analysisCode);
    }

    function thesisForAnalysisCode(uint8 analysisCode) public pure returns (string memory) {
        if (analysisCode == 1) return "New wallet deployed whale-sized conviction into the market.";
        if (analysisCode == 2) return "High-conviction entry landed with favorable odds and meaningful size.";
        if (analysisCode == 3) return "Rapid accumulation pattern suggests coordinated position building.";
        if (analysisCode == 4) return "Repeated same-side pressure is reinforcing directional momentum.";
        if (analysisCode == 5) return "Counterparty concentration implies a narrow, informed execution path.";
        if (analysisCode == 6) return "Market impact spiked fast enough to justify an automated alert.";
        if (analysisCode == 7) return "Wash-cluster heuristics crossed the manipulation threshold.";
        if (analysisCode == 8) return "Smart-money follow-through remained strong after the initial trade.";
        return "Reactive evaluation completed.";
    }
}
