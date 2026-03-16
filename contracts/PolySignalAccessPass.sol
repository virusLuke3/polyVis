// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PolySignalAccessPass {
    event AccessPurchased(
        address indexed buyer,
        uint256 amountPaid,
        uint64 accessExpiresAt
    );
    event PriceUpdated(uint256 newPriceWei);
    event AccessDurationUpdated(uint64 newAccessDuration);
    event Withdrawal(address indexed recipient, uint256 amount);

    error NotOwner(address caller);
    error InsufficientPayment(uint256 expected, uint256 actual);
    error InvalidOwner();

    address public owner;
    uint256 public priceWei;
    uint64 public accessDuration;

    mapping(address => uint64) public accessExpiresAt;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender);
        }
        _;
    }

    constructor(
        address initialOwner,
        uint256 priceWei_,
        uint64 accessDuration_
    ) {
        if (initialOwner == address(0)) {
            revert InvalidOwner();
        }

        owner = initialOwner;
        priceWei = priceWei_;
        accessDuration = accessDuration_;
    }

    function hasAccess(address user) external view returns (bool) {
        return accessExpiresAt[user] >= block.timestamp;
    }

    function purchaseAccess() external payable {
        if (msg.value < priceWei) {
            revert InsufficientPayment(priceWei, msg.value);
        }

        uint64 currentExpiry = accessExpiresAt[msg.sender];
        uint64 base = currentExpiry > block.timestamp
            ? currentExpiry
            : uint64(block.timestamp);
        uint64 nextExpiry = base + accessDuration;

        accessExpiresAt[msg.sender] = nextExpiry;
        emit AccessPurchased(msg.sender, msg.value, nextExpiry);
    }

    function setPriceWei(uint256 newPriceWei) external onlyOwner {
        priceWei = newPriceWei;
        emit PriceUpdated(newPriceWei);
    }

    function setAccessDuration(uint64 newAccessDuration) external onlyOwner {
        accessDuration = newAccessDuration;
        emit AccessDurationUpdated(newAccessDuration);
    }

    function withdraw(address payable recipient) external onlyOwner {
        address payable target = recipient == address(0)
            ? payable(owner)
            : recipient;
        uint256 balance = address(this).balance;
        target.transfer(balance);
        emit Withdrawal(target, balance);
    }
}
