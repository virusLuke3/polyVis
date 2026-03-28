// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "lib/reactive-lib/src/abstract-base/AbstractCallback.sol";

contract PolySignalDestination is AbstractCallback {
    struct SignalRecord {
        bytes32 sourceTradeId;
        bytes32 marketId;
        address trader;
        uint256 amount;
        uint8 direction;
        uint8 analysisCode;
        uint16 matchedFlags;
        uint16 relayedFlags;
        uint16 finalRiskScoreBps;
        uint32 oddsBps;
        uint256 totalPositionUsd;
        uint64 observedAt;
        uint64 deliveredAt;
        address reactiveSender;
        string marketTitle;
        string thesis;
    }

    event SignalRecorded(
        bytes32 indexed sourceTradeId,
        bytes32 indexed marketId,
        address indexed trader,
        uint8 analysisCode,
        uint16 matchedFlags,
        uint16 finalRiskScoreBps,
        address reactiveSender,
        string marketTitle,
        string thesis
    );

    error NotOwner(address caller);
    error DuplicateSignal(bytes32 sourceTradeId);

    address public immutable owner;
    uint256 public totalSignals;
    mapping(bytes32 => bool) public seenSignals;
    mapping(bytes32 => SignalRecord) internal signalRecords;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor(address callbackSender, address initialOwner) AbstractCallback(callbackSender) payable {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
    }

    function recordSignal(
        address reactiveSender,
        bytes32 sourceTradeId,
        bytes32 marketId,
        address trader,
        uint256 amount,
        uint8 direction,
        uint8 analysisCode,
        uint16 matchedFlags,
        uint16 relayedFlags,
        uint16 finalRiskScoreBps,
        uint32 oddsBps,
        uint256 totalPositionUsd,
        uint64 observedAt,
        string calldata marketTitle,
        string calldata thesis
    ) external authorizedSenderOnly {
        if (seenSignals[sourceTradeId]) revert DuplicateSignal(sourceTradeId);

        seenSignals[sourceTradeId] = true;
        totalSignals += 1;
        signalRecords[sourceTradeId] = SignalRecord({
            sourceTradeId: sourceTradeId,
            marketId: marketId,
            trader: trader,
            amount: amount,
            direction: direction,
            analysisCode: analysisCode,
            matchedFlags: matchedFlags,
            relayedFlags: relayedFlags,
            finalRiskScoreBps: finalRiskScoreBps,
            oddsBps: oddsBps,
            totalPositionUsd: totalPositionUsd,
            observedAt: observedAt,
            deliveredAt: uint64(block.timestamp),
            reactiveSender: reactiveSender,
            marketTitle: marketTitle,
            thesis: thesis
        });

        emit SignalRecorded(
            sourceTradeId,
            marketId,
            trader,
            analysisCode,
            matchedFlags,
            finalRiskScoreBps,
            reactiveSender,
            marketTitle,
            thesis
        );
    }

    function getSignal(bytes32 sourceTradeId) external view returns (SignalRecord memory) {
        return signalRecords[sourceTradeId];
    }
}
