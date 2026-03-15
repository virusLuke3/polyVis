// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISomniaReactivityPrecompile {
    struct SubscriptionData {
        bytes32[4] eventTopics;
        address origin;
        address caller;
        address emitter;
        address handlerContractAddress;
        bytes4 handlerFunctionSelector;
        uint256 priorityFeePerGas;
        uint256 maxFeePerGas;
        uint256 gasLimit;
        bool isGuaranteed;
        bool isCoalesced;
    }

    function subscribe(SubscriptionData calldata subscriptionData) external returns (uint256);

    function unsubscribe(uint256 subscriptionId) external;
}
