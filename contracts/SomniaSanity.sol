// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SomniaSanity {
    uint256 public immutable deployedAt;
    address public immutable deployer;

    constructor() {
        deployedAt = block.timestamp;
        deployer = msg.sender;
    }
}
