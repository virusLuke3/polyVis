// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPolymarketTradeBridge {
    enum TradeDirection {
        YES,
        NO
    }

    struct BridgedTradeInput {
        bytes32 sourceTradeId;
        bytes32 marketId;
        address trader;
        uint256 amount;
        uint8 direction;
        uint64 accountAgeDays;
        uint32 oddsBps;
        uint256 totalPositionUsd;
        uint16 anomalyFlags;
        uint16 riskScoreBps;
        uint16 recentTradeCount;
        uint16 sameSideStreak;
        uint16 counterpartyConcentrationBps;
        uint16 marketImpactBps;
        uint16 washClusterScoreBps;
        uint16 smartMoneyScoreBps;
        string marketTitle;
    }

    struct BridgedTrade {
        uint64 sequence;
        uint64 observedAt;
        bytes32 sourceTradeId;
        bytes32 marketId;
        address trader;
        uint256 amount;
        uint8 direction;
        uint64 accountAgeDays;
        uint32 oddsBps;
        uint256 totalPositionUsd;
        uint16 anomalyFlags;
        uint16 riskScoreBps;
        uint16 recentTradeCount;
        uint16 sameSideStreak;
        uint16 counterpartyConcentrationBps;
        uint16 marketImpactBps;
        uint16 washClusterScoreBps;
        uint16 smartMoneyScoreBps;
        string marketTitle;
    }
}
