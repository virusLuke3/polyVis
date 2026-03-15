// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISomniaEventHandler} from "../interfaces/ISomniaEventHandler.sol";

abstract contract SomniaEventHandler is ISomniaEventHandler {
    error NotSomniaReactivity(address caller);

    address public immutable somniaReactivityPrecompile;

    constructor(address precompileAddress) {
        somniaReactivityPrecompile = precompileAddress == address(0)
            ? address(0x0100)
            : precompileAddress;
    }

    modifier onlySomniaReactivity() {
        if (msg.sender != somniaReactivityPrecompile) {
            revert NotSomniaReactivity(msg.sender);
        }
        _;
    }

    function onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) external onlySomniaReactivity {
        _onEvent(emitter, eventTopics, data);
    }

    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal virtual;
}
