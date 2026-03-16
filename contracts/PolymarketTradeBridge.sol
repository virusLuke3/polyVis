// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPolymarketTradeBridge} from "./interfaces/IPolymarketTradeBridge.sol";

contract PolymarketTradeBridge is IPolymarketTradeBridge {
    event TradeBridged(
        bytes32 indexed sourceTradeId,
        bytes32 indexed marketId,
        address indexed trader,
        uint256 amount,
        uint8 direction,
        uint64 accountAgeDays,
        uint32 oddsBps,
        uint256 totalPositionUsd,
        uint16 anomalyFlags,
        uint16 riskScoreBps,
        uint16 recentTradeCount,
        uint16 sameSideStreak,
        uint16 counterpartyConcentrationBps,
        uint16 marketImpactBps,
        uint16 washClusterScoreBps,
        uint16 smartMoneyScoreBps,
        uint64 observedAt,
        string marketTitle
    );

    error NotRelayer(address caller);
    error InvalidTrader(address trader);
    error InvalidDirection(uint8 direction);
    error EmptyMarketTitle();
    error DuplicateSourceTrade(bytes32 sourceTradeId);

    address public immutable owner;
    address public immutable relayer;
    uint64 public tradeSequence;

    mapping(bytes32 => bool) public seenSourceTrades;

    modifier onlyRelayer() {
        if (msg.sender != relayer) {
            revert NotRelayer(msg.sender);
        }
        _;
    }

    constructor(address initialOwner, address initialRelayer) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
        relayer = initialRelayer == address(0) ? owner : initialRelayer;
    }

    function logTrade(
        BridgedTradeInput calldata tradeInput
    ) external onlyRelayer returns (uint64 sequence) {
        if (tradeInput.trader == address(0)) {
            revert InvalidTrader(tradeInput.trader);
        }
        if (tradeInput.direction > uint8(TradeDirection.NO)) {
            revert InvalidDirection(tradeInput.direction);
        }
        if (bytes(tradeInput.marketTitle).length == 0) {
            revert EmptyMarketTitle();
        }
        if (seenSourceTrades[tradeInput.sourceTradeId]) {
            revert DuplicateSourceTrade(tradeInput.sourceTradeId);
        }

        seenSourceTrades[tradeInput.sourceTradeId] = true;
        sequence = ++tradeSequence;

        emit TradeBridged(
            tradeInput.sourceTradeId,
            tradeInput.marketId,
            tradeInput.trader,
            tradeInput.amount,
            tradeInput.direction,
            tradeInput.accountAgeDays,
            tradeInput.oddsBps,
            tradeInput.totalPositionUsd,
            tradeInput.anomalyFlags,
            tradeInput.riskScoreBps,
            tradeInput.recentTradeCount,
            tradeInput.sameSideStreak,
            tradeInput.counterpartyConcentrationBps,
            tradeInput.marketImpactBps,
            tradeInput.washClusterScoreBps,
            tradeInput.smartMoneyScoreBps,
            uint64(block.timestamp),
            tradeInput.marketTitle
        );
    }
}
