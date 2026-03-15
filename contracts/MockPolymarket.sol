// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockPolymarket {
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

    event RelayerUpdated(address indexed relayer);
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
    error InvalidDirection(uint8 direction);
    error EmptyMarketTitle();

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
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
        relayer = initialRelayer == address(0) ? owner : initialRelayer;
    }

    function setRelayer(address newRelayer) external onlyOwner {
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function logTrade(
        BridgedTradeInput calldata tradeInput
    ) external onlyRelayer returns (uint64 sequence) {
        if (tradeInput.direction > uint8(TradeDirection.NO)) {
            revert InvalidDirection(tradeInput.direction);
        }
        if (bytes(tradeInput.marketTitle).length == 0) {
            revert EmptyMarketTitle();
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
