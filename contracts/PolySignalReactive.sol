// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockPolymarket} from "./MockPolymarket.sol";
import {ISomniaEventHandler} from "./interfaces/ISomniaEventHandler.sol";
import {ISomniaReactivityPrecompile} from "./interfaces/ISomniaReactivityPrecompile.sol";
import {SomniaEventHandler} from "./vendor/SomniaEventHandler.sol";

contract PolySignalReactive is SomniaEventHandler {
    enum AnalysisCode {
        NONE,
        NEW_WALLET_WHALE,
        ESTABLISHED_WHALE
    }

    struct SignalConfig {
        uint256 whaleThresholdUsd;
        uint64 newWalletMaxAgeDays;
        uint32 convictionOddsFloorBps;
        uint256 minTotalPositionUsd;
    }

    struct BridgedTradePayload {
        bytes32 sourceTradeId;
        bytes32 marketId;
        address trader;
        uint256 amount;
        uint8 direction;
        uint64 accountAgeDays;
        uint32 oddsBps;
        uint256 totalPositionUsd;
        uint64 observedAt;
        string marketTitle;
    }

    event SubscriptionCreated(uint256 indexed subscriptionId);
    event SubscriptionCancelled(uint256 indexed subscriptionId);
    event ConfigUpdated(
        uint256 whaleThresholdUsd,
        uint64 newWalletMaxAgeDays,
        uint32 convictionOddsFloorBps,
        uint256 minTotalPositionUsd
    );
    event AlphaSignal(
        bytes32 indexed marketId,
        address indexed trader,
        bytes32 indexed sourceTradeId,
        uint256 amount,
        uint8 direction,
        uint8 analysisCode,
        uint32 oddsBps,
        uint256 totalPositionUsd,
        uint64 observedAt,
        string marketTitle,
        string thesis
    );

    error NotOwner(address caller);
    error UnexpectedEmitter(address emitter);
    error UnknownTradeEvent();

    bytes32 public constant TRADE_BRIDGED_TOPIC =
        keccak256(
            "TradeBridged(bytes32,bytes32,address,uint256,uint8,uint64,uint32,uint256,uint64,string)"
        );

    address public owner;
    address public immutable sourceMarketData;
    ISomniaReactivityPrecompile public immutable somniaReactivity;

    uint256 public subscriptionId;
    SignalConfig public signalConfig;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender);
        }
        _;
    }

    constructor(
        address initialOwner,
        address sourceMarketData_,
        address precompileAddress
    ) SomniaEventHandler(precompileAddress) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
        sourceMarketData = sourceMarketData_;
        somniaReactivity = ISomniaReactivityPrecompile(somniaReactivityPrecompile);

        signalConfig = SignalConfig({
            whaleThresholdUsd: 25_000e6,
            newWalletMaxAgeDays: 7,
            convictionOddsFloorBps: 1_500,
            minTotalPositionUsd: 50_000e6
        });
    }

    function setSignalConfig(
        uint256 whaleThresholdUsd,
        uint64 newWalletMaxAgeDays,
        uint32 convictionOddsFloorBps,
        uint256 minTotalPositionUsd
    ) external onlyOwner {
        signalConfig = SignalConfig({
            whaleThresholdUsd: whaleThresholdUsd,
            newWalletMaxAgeDays: newWalletMaxAgeDays,
            convictionOddsFloorBps: convictionOddsFloorBps,
            minTotalPositionUsd: minTotalPositionUsd
        });

        emit ConfigUpdated(
            whaleThresholdUsd,
            newWalletMaxAgeDays,
            convictionOddsFloorBps,
            minTotalPositionUsd
        );
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function createSubscription(
        uint256 priorityFeePerGas,
        uint256 maxFeePerGas,
        uint256 gasLimit,
        bool isGuaranteed,
        bool isCoalesced
    ) external onlyOwner returns (uint256 newSubscriptionId) {
        bytes32[4] memory eventTopics = [
            TRADE_BRIDGED_TOPIC,
            bytes32(0),
            bytes32(0),
            bytes32(0)
        ];

        ISomniaReactivityPrecompile.SubscriptionData
            memory subscriptionData = ISomniaReactivityPrecompile.SubscriptionData({
                eventTopics: eventTopics,
                origin: address(0),
                caller: address(0),
                emitter: sourceMarketData,
                handlerContractAddress: address(this),
                handlerFunctionSelector: ISomniaEventHandler.onEvent.selector,
                priorityFeePerGas: priorityFeePerGas,
                maxFeePerGas: maxFeePerGas,
                gasLimit: gasLimit,
                isGuaranteed: isGuaranteed,
                isCoalesced: isCoalesced
            });

        newSubscriptionId = somniaReactivity.subscribe(subscriptionData);
        subscriptionId = newSubscriptionId;
        emit SubscriptionCreated(newSubscriptionId);
    }

    function cancelSubscription() external onlyOwner {
        uint256 existingSubscriptionId = subscriptionId;
        if (existingSubscriptionId == 0) {
            return;
        }

        somniaReactivity.unsubscribe(existingSubscriptionId);
        subscriptionId = 0;
        emit SubscriptionCancelled(existingSubscriptionId);
    }

    function previewSignal(
        uint256 amount,
        uint64 accountAgeDays,
        uint32 oddsBps,
        uint256 totalPositionUsd,
        uint8 direction
    ) external view returns (bool shouldEmit, uint8 analysisCode, string memory thesis) {
        BridgedTradePayload memory trade = BridgedTradePayload({
            sourceTradeId: bytes32(0),
            marketId: bytes32(0),
            trader: address(0),
            amount: amount,
            direction: direction,
            accountAgeDays: accountAgeDays,
            oddsBps: oddsBps,
            totalPositionUsd: totalPositionUsd,
            observedAt: 0,
            marketTitle: ""
        });

        return _evaluate(trade);
    }

    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        if (emitter != sourceMarketData) {
            revert UnexpectedEmitter(emitter);
        }
        if (eventTopics.length < 4 || eventTopics[0] != TRADE_BRIDGED_TOPIC) {
            revert UnknownTradeEvent();
        }

        BridgedTradePayload memory trade = _decodeTrade(eventTopics, data);
        (bool shouldEmit, uint8 analysisCode, string memory thesis) = _evaluate(trade);

        if (!shouldEmit) {
            return;
        }

        emit AlphaSignal(
            trade.marketId,
            trade.trader,
            trade.sourceTradeId,
            trade.amount,
            trade.direction,
            analysisCode,
            trade.oddsBps,
            trade.totalPositionUsd,
            trade.observedAt,
            trade.marketTitle,
            thesis
        );
    }

    function _decodeTrade(
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal pure returns (BridgedTradePayload memory trade) {
        (
            uint256 amount,
            uint8 direction,
            uint64 accountAgeDays,
            uint32 oddsBps,
            uint256 totalPositionUsd,
            uint64 observedAt,
            string memory marketTitle
        ) = abi.decode(data, (uint256, uint8, uint64, uint32, uint256, uint64, string));

        trade = BridgedTradePayload({
            sourceTradeId: eventTopics[1],
            marketId: eventTopics[2],
            trader: _topicToAddress(eventTopics[3]),
            amount: amount,
            direction: direction,
            accountAgeDays: accountAgeDays,
            oddsBps: oddsBps,
            totalPositionUsd: totalPositionUsd,
            observedAt: observedAt,
            marketTitle: marketTitle
        });
    }

    function _evaluate(
        BridgedTradePayload memory trade
    ) internal view returns (bool shouldEmit, uint8 analysisCode, string memory thesis) {
        SignalConfig memory config = signalConfig;

        bool whaleSize = trade.amount >= config.whaleThresholdUsd;
        bool newWallet = trade.accountAgeDays <= config.newWalletMaxAgeDays;
        bool strongConviction = trade.oddsBps >= config.convictionOddsFloorBps;
        bool largePosition = trade.totalPositionUsd >= config.minTotalPositionUsd;

        if (whaleSize && newWallet && strongConviction) {
            thesis = string(
                abi.encodePacked(
                    "New wallet whale: a fresh address entered ",
                    _directionLabel(trade.direction),
                    " with size above threshold and conviction above the configured floor."
                )
            );
            return (true, uint8(AnalysisCode.NEW_WALLET_WHALE), thesis);
        }

        if (whaleSize && largePosition && strongConviction) {
            thesis = string(
                abi.encodePacked(
                    "Established whale: a tracked wallet increased a high-conviction position to notable size on ",
                    _directionLabel(trade.direction),
                    "."
                )
            );
            return (true, uint8(AnalysisCode.ESTABLISHED_WHALE), thesis);
        }

        return (false, uint8(AnalysisCode.NONE), "");
    }

    function _directionLabel(uint8 direction) internal pure returns (string memory) {
        return direction == uint8(MockPolymarket.TradeDirection.YES) ? "YES" : "NO";
    }

    function _topicToAddress(bytes32 topicValue) internal pure returns (address) {
        return address(uint160(uint256(topicValue)));
    }
}
