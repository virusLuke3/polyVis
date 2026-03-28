const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PolySignal reactive workflow", function () {
  it("simulates origin event -> reactive evaluation -> destination callback", async function () {
    const [owner, relayer] = await ethers.getSigners();

    const Origin = await ethers.getContractFactory("PolySignalOrigin");
    const origin = await Origin.deploy(owner.address, relayer.address);
    await origin.waitForDeployment();

    const Proxy = await ethers.getContractFactory("MockReactiveCallbackProxy");
    const proxy = await Proxy.deploy();
    await proxy.waitForDeployment();

    const Destination = await ethers.getContractFactory("PolySignalDestination");
    const destination = await Destination.deploy(await proxy.getAddress(), owner.address);
    await destination.waitForDeployment();

    const Reactive = await ethers.getContractFactory("PolySignalReactiveNetwork");
    const reactive = await Reactive.deploy(
      11155111,
      11155111,
      await origin.getAddress(),
      await destination.getAddress()
    );
    await reactive.waitForDeployment();

    const sourceTradeId = ethers.keccak256(ethers.toUtf8Bytes("trade-1"));
    const marketId = ethers.keccak256(ethers.toUtf8Bytes("market-1"));
    const originAddress = await origin.getAddress();
    const destinationAddress = await destination.getAddress();
    const reactiveAddress = await reactive.getAddress();

    const originTx = await origin.connect(relayer).reportTradeSignal({
      sourceTradeId,
      marketId,
      trader: relayer.address,
      amount: 30_000_000_000n,
      direction: 0,
      accountAgeDays: 2,
      oddsBps: 6700,
      totalPositionUsd: 55_000_000_000n,
      anomalyFlags: 0,
      riskScoreBps: 3100,
      recentTradeCount: 4,
      sameSideStreak: 3,
      counterpartyConcentrationBps: 7000,
      marketImpactBps: 500,
      washClusterScoreBps: 2000,
      smartMoneyScoreBps: 7500,
      marketTitle: "Will policy pass this year?",
    });
    const originReceipt = await originTx.wait();

    const tradeLog = originReceipt.logs.find((log) => log.address === originAddress);
    const parsedOriginLog = origin.interface.parseLog(tradeLog);

    const reactiveTx = await reactive.react({
      chain_id: 11155111,
      _contract: originAddress,
      topic_0: BigInt(tradeLog.topics[0]),
      topic_1: BigInt(tradeLog.topics[1]),
      topic_2: BigInt(tradeLog.topics[2]),
      topic_3: BigInt(tradeLog.topics[3]),
      data: tradeLog.data,
      block_number: BigInt(originReceipt.blockNumber),
      op_code: 0,
      block_hash: BigInt(originReceipt.blockHash),
      tx_hash: BigInt(originReceipt.hash),
      log_index: BigInt(tradeLog.index),
    });
    const reactiveReceipt = await reactiveTx.wait();

    const parsedCallbackLog =
      reactiveReceipt.logs.find(
        (log) => log.address === reactiveAddress && log.fragment?.name === "Callback"
      ) || reactive.interface.parseLog(reactiveReceipt.logs[0]);

    await proxy.forward(destinationAddress, parsedCallbackLog.args.payload);

    const signal = await destination.getSignal(sourceTradeId);
    expect(signal.sourceTradeId).to.equal(sourceTradeId);
    expect(signal.marketId).to.equal(marketId);
    expect(signal.trader).to.equal(relayer.address);
    expect(signal.analysisCode).to.equal(1n);
    expect(signal.finalRiskScoreBps).to.equal(9600n);
    expect(signal.marketTitle).to.equal("Will policy pass this year?");
    expect(signal.thesis).to.contain("New wallet");
    expect(await destination.totalSignals()).to.equal(1n);
  });
});
