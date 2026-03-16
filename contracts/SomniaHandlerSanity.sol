// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SomniaHandlerSanity {
    address public owner;

    constructor(address initialOwner) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
    }

    function onEvent(
        address,
        bytes32[] calldata,
        bytes calldata
    ) external pure {}
}
