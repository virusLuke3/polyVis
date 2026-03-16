// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PolySignalReactive {
    event AlphaSignal(
        bytes32 indexed marketId,
        address indexed trader,
        bytes32 indexed sourceTradeId,
        uint256 amount,
        uint8 direction,
        uint8 analysisCode,
        uint16 matchedFlags,
        uint16 relayedFlags,
        uint16 riskScoreBps,
        uint32 oddsBps,
        uint256 totalPositionUsd,
        uint64 observedAt,
        string marketTitle,
        string thesis
    );

    error NotSomniaReactivity(address caller);
    error UnexpectedEmitter(address emitter);
    error UnknownTradeEvent();

    uint16 internal constant FLAG_NEW_WALLET_WHALE = 1 << 0;
    uint16 internal constant FLAG_HIGH_CONVICTION_ENTRY = 1 << 1;
    uint16 internal constant FLAG_RAPID_ACCUMULATION = 1 << 2;
    uint16 internal constant FLAG_SAME_SIDE_STREAK = 1 << 3;
    uint16 internal constant FLAG_COUNTERPARTY_CONCENTRATION = 1 << 4;
    uint16 internal constant FLAG_MARKET_IMPACT_SPIKE = 1 << 5;
    uint16 internal constant FLAG_WASH_CLUSTER = 1 << 6;
    uint16 internal constant FLAG_SMART_MONEY_FOLLOWTHROUGH = 1 << 7;

    bytes32 internal constant TRADE_BRIDGED_TOPIC =
        keccak256(
            "TradeBridged(bytes32,bytes32,address,uint256,uint8,uint64,uint32,uint256,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,string)"
        );

    address public sourceMarketData;
    address public somniaReactivityPrecompile;

    constructor(address sourceMarketData_, address precompileAddress) {
        sourceMarketData = sourceMarketData_;
        somniaReactivityPrecompile = precompileAddress == address(0)
            ? address(0x0100)
            : precompileAddress;
    }

    function onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) external {
        if (msg.sender != somniaReactivityPrecompile) {
            revert NotSomniaReactivity(msg.sender);
        }
        if (emitter != sourceMarketData) {
            revert UnexpectedEmitter(emitter);
        }
        if (eventTopics.length < 4 || eventTopics[0] != TRADE_BRIDGED_TOPIC) {
            revert UnknownTradeEvent();
        }

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
            data,
            (uint256, uint8, uint64, uint32, uint256, uint16, uint16, uint16, uint16, uint16, uint16, uint16, uint16, uint64, string)
        );

        uint16 matchedFlags;
        if (amount >= 25_000e6 && accountAgeDays <= 7) matchedFlags |= FLAG_NEW_WALLET_WHALE;
        if (oddsBps >= 6_000 && amount >= 12_500e6) matchedFlags |= FLAG_HIGH_CONVICTION_ENTRY;
        if (recentTradeCount >= 3 && totalPositionUsd >= 40_000e6) {
            matchedFlags |= FLAG_RAPID_ACCUMULATION;
        }
        if (sameSideStreak >= 3) matchedFlags |= FLAG_SAME_SIDE_STREAK;
        if (counterpartyConcentrationBps >= 6_500) {
            matchedFlags |= FLAG_COUNTERPARTY_CONCENTRATION;
        }
        if (marketImpactBps >= 450) matchedFlags |= FLAG_MARKET_IMPACT_SPIKE;
        if (washClusterScoreBps >= 6_000) matchedFlags |= FLAG_WASH_CLUSTER;
        if (smartMoneyScoreBps >= 7_000) matchedFlags |= FLAG_SMART_MONEY_FOLLOWTHROUGH;
        if (matchedFlags == 0) return;

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
        if (finalRiskScoreBps < 3_000) return;

        uint8 analysisCode = 0;
        if ((matchedFlags & FLAG_NEW_WALLET_WHALE) != 0) analysisCode = 1;
        else if ((matchedFlags & FLAG_SMART_MONEY_FOLLOWTHROUGH) != 0) analysisCode = 8;
        else if ((matchedFlags & FLAG_WASH_CLUSTER) != 0) analysisCode = 7;
        else if ((matchedFlags & FLAG_MARKET_IMPACT_SPIKE) != 0) analysisCode = 6;
        else if ((matchedFlags & FLAG_COUNTERPARTY_CONCENTRATION) != 0) analysisCode = 5;
        else if ((matchedFlags & FLAG_RAPID_ACCUMULATION) != 0) analysisCode = 3;
        else if ((matchedFlags & FLAG_SAME_SIDE_STREAK) != 0) analysisCode = 4;
        else if ((matchedFlags & FLAG_HIGH_CONVICTION_ENTRY) != 0) analysisCode = 2;

        emit AlphaSignal(
            eventTopics[2],
            address(uint160(uint256(eventTopics[3]))),
            eventTopics[1],
            amount,
            direction,
            analysisCode,
            matchedFlags,
            relayedFlags,
            finalRiskScoreBps,
            oddsBps,
            totalPositionUsd,
            observedAt,
            marketTitle,
            ""
        );
    }
}
