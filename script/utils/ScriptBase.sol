// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function envBool(string calldata key) external view returns (bool);
    function addr(uint256 privateKey) external pure returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

abstract contract ScriptBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}
