// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockReactiveCallbackProxy {
    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function forward(address target, bytes calldata payload) external returns (bytes memory result) {
        (bool success, bytes memory returndata) = target.call(payload);
        require(success, "Callback forward failed");
        return returndata;
    }
}
