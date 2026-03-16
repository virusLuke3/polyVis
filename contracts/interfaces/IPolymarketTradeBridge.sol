// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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
        string marketTitle;
    }
}
