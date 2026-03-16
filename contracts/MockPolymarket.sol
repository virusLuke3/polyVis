// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PolymarketTradeBridge} from "./PolymarketTradeBridge.sol";

contract MockPolymarket is PolymarketTradeBridge {
    constructor(address initialOwner, address initialRelayer)
        PolymarketTradeBridge(initialOwner, initialRelayer)
    {}
}
