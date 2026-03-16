// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPolymarketTradeBridge} from "./interfaces/IPolymarketTradeBridge.sol";

contract PolymarketTradeBridge is IPolymarketTradeBridge {
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RelayerUpdated(address indexed previousRelayer, address indexed newRelayer);
    event TradeBridged(
        bytes32 indexed sourceTradeId,
        bytes32 indexed marketId,
        address indexed trader,
        uint256 amount,
        uint8 direction,
        uint64 accountAgeDays,
        uint32 oddsBps,
        uint256 totalPositionUsd,
        uint64 observedAt,
        string marketTitle
    );

    error NotOwner(address caller);
    error NotRelayer(address caller);
    error InvalidOwner(address candidate);
    error InvalidRelayer(address candidate);
    error InvalidTrader(address trader);
    error InvalidDirection(uint8 direction);
    error EmptyMarketTitle();
    error DuplicateSourceTrade(bytes32 sourceTradeId);

    address public owner;
    address public relayer;
    uint64 public tradeSequence;

    mapping(bytes32 => BridgedTrade) private tradesBySourceId;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender);
        }
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) {
            revert NotRelayer(msg.sender);
        }
        _;
    }

    constructor(address initialOwner, address initialRelayer) {
        address resolvedOwner = initialOwner == address(0) ? msg.sender : initialOwner;
        address resolvedRelayer = initialRelayer == address(0) ? resolvedOwner : initialRelayer;

        if (resolvedOwner == address(0)) {
            revert InvalidOwner(resolvedOwner);
        }
        if (resolvedRelayer == address(0)) {
            revert InvalidRelayer(resolvedRelayer);
        }

        owner = resolvedOwner;
        relayer = resolvedRelayer;

        emit OwnershipTransferred(address(0), resolvedOwner);
        emit RelayerUpdated(address(0), resolvedRelayer);
    }

    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) {
            revert InvalidRelayer(newRelayer);
        }

        address previousRelayer = relayer;
        relayer = newRelayer;
        emit RelayerUpdated(previousRelayer, newRelayer);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert InvalidOwner(newOwner);
        }

        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
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
        if (tradesBySourceId[tradeInput.sourceTradeId].observedAt != 0) {
            revert DuplicateSourceTrade(tradeInput.sourceTradeId);
        }

        sequence = ++tradeSequence;

        BridgedTrade memory bridgedTrade = BridgedTrade({
            sequence: sequence,
            observedAt: uint64(block.timestamp),
            sourceTradeId: tradeInput.sourceTradeId,
            marketId: tradeInput.marketId,
            trader: tradeInput.trader,
            amount: tradeInput.amount,
            direction: tradeInput.direction,
            accountAgeDays: tradeInput.accountAgeDays,
            oddsBps: tradeInput.oddsBps,
            totalPositionUsd: tradeInput.totalPositionUsd,
            marketTitle: tradeInput.marketTitle
        });

        tradesBySourceId[tradeInput.sourceTradeId] = bridgedTrade;

        emit TradeBridged(
            bridgedTrade.sourceTradeId,
            bridgedTrade.marketId,
            bridgedTrade.trader,
            bridgedTrade.amount,
            bridgedTrade.direction,
            bridgedTrade.accountAgeDays,
            bridgedTrade.oddsBps,
            bridgedTrade.totalPositionUsd,
            bridgedTrade.observedAt,
            bridgedTrade.marketTitle
        );
    }

    function getTrade(bytes32 sourceTradeId) external view returns (BridgedTrade memory) {
        return tradesBySourceId[sourceTradeId];
    }
}
