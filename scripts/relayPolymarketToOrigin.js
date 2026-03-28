require("dotenv").config();
const { applyClashProxyEnv, normalizePrivateKey } = require("./lib/proxy");
const { computeAnomalyProfile, decodeAnomalyFlags } = require("./lib/anomaly");
applyClashProxyEnv();

const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodePacked,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseUnits,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const USDC_DECIMALS = 6n;
const LOG_BLOCK_BATCH = BigInt(process.env.POLYMARKET_LOG_BLOCK_BATCH || 1000);

const polymarketOrderFilledAbi = parseAbi([
  "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)",
]);

const orderFilledEvent = {
  type: "event",
  name: "OrderFilled",
  inputs: [
    { indexed: true, name: "orderHash", type: "bytes32" },
    { indexed: true, name: "maker", type: "address" },
    { indexed: true, name: "taker", type: "address" },
    { indexed: false, name: "makerAssetId", type: "uint256" },
    { indexed: false, name: "takerAssetId", type: "uint256" },
    { indexed: false, name: "makerAmountFilled", type: "uint256" },
    { indexed: false, name: "takerAmountFilled", type: "uint256" },
    { indexed: false, name: "fee", type: "uint256" },
  ],
};

const originAbi = parseAbi([
  "function reportTradeSignal((bytes32 sourceTradeId, bytes32 marketId, address trader, uint256 amount, uint8 direction, uint64 accountAgeDays, uint32 oddsBps, uint256 totalPositionUsd, uint16 anomalyFlags, uint16 riskScoreBps, uint16 recentTradeCount, uint16 sameSideStreak, uint16 counterpartyConcentrationBps, uint16 marketImpactBps, uint16 washClusterScoreBps, uint16 smartMoneyScoreBps, string marketTitle) tradeInput) returns (uint64 sequence)",
]);

const polygon = defineChain({
  id: 137,
  name: "Polygon",
  network: "polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.POLYGON_RPC_URL || "https://polygon-rpc.com"] },
  },
});

const sepolia = defineChain({
  id: Number(process.env.SEPOLIA_CHAIN_ID || 11155111),
  name: "Ethereum Sepolia",
  network: "sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"],
    },
  },
});

const polygonClient = createPublicClient({
  chain: polygon,
  transport: http(),
});

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseJsonArrayMaybe(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchMarketBySlug(slug) {
  const response = await fetch(
    `${GAMMA_API_BASE}/markets?slug=${encodeURIComponent(slug)}`
  );

  if (!response.ok) {
    throw new Error(`Gamma market lookup failed with status ${response.status}`);
  }

  const data = await response.json();
  const market = Array.isArray(data) ? data[0] : data;
  if (!market || !market.conditionId) {
    throw new Error(`No market found for slug "${slug}"`);
  }

  return market;
}

function extractTokenIds(market) {
  const clobTokenIds = parseJsonArrayMaybe(market.clobTokenIds);
  const tokenIds = clobTokenIds.map((item) => BigInt(String(item)));

  if (tokenIds.length >= 2) {
    return {
      yesTokenId: tokenIds[0],
      noTokenId: tokenIds[1],
    };
  }

  const tokens = Array.isArray(market.tokens) ? market.tokens : [];
  const yes = tokens.find((token) => String(token.outcome).toUpperCase() === "YES");
  const no = tokens.find((token) => String(token.outcome).toUpperCase() === "NO");
  if (!yes || !no) {
    throw new Error("Unable to derive YES/NO token IDs");
  }

  return {
    yesTokenId: BigInt(String(yes.token_id)),
    noTokenId: BigInt(String(no.token_id)),
  };
}

function extractOutcomePrices(market) {
  const prices = parseJsonArrayMaybe(market.outcomePrices);
  if (prices.length >= 2) {
    return {
      yesBps: Math.round(Number(prices[0]) * 10_000),
      noBps: Math.round(Number(prices[1]) * 10_000),
    };
  }

  return { yesBps: 5000, noBps: 5000 };
}

function decodePolymarketTrade(log) {
  const decoded = decodeEventLog({
    abi: polymarketOrderFilledAbi,
    data: log.data,
    topics: log.topics,
  });

  const makerAssetId = decoded.args.makerAssetId;
  const takerAssetId = decoded.args.takerAssetId;
  const makerAmountFilled = decoded.args.makerAmountFilled;
  const takerAmountFilled = decoded.args.takerAmountFilled;

  const isBuy = makerAssetId === 0n;
  const bettor = isBuy ? decoded.args.maker : decoded.args.taker;
  const counterparty = isBuy ? decoded.args.taker : decoded.args.maker;

  return {
    orderHash: decoded.args.orderHash,
    sourceTradeId: keccak256(
      encodePacked(
        ["bytes32", "uint256", "bytes32"],
        [decoded.args.orderHash, BigInt(log.logIndex), log.transactionHash]
      )
    ),
    trader: getAddress(bettor),
    counterparty: getAddress(counterparty),
    tokenId: isBuy ? takerAssetId : makerAssetId,
    amount: isBuy ? makerAmountFilled : takerAmountFilled,
    shares: isBuy ? takerAmountFilled : makerAmountFilled,
    side: isBuy ? "BUY" : "SELL",
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
  };
}

async function getLogsInChunks(address, fromBlock, toBlock) {
  const logs = [];
  let startBlock = fromBlock;

  while (startBlock <= toBlock) {
    const endBlock =
      startBlock + LOG_BLOCK_BATCH - 1n < toBlock
        ? startBlock + LOG_BLOCK_BATCH - 1n
        : toBlock;

    const chunkLogs = await polygonClient.getLogs({
      address,
      event: orderFilledEvent,
      fromBlock: startBlock,
      toBlock: endBlock,
    });

    logs.push(...chunkLogs);
    startBlock = endBlock + 1n;
  }

  return logs;
}

async function findLatestLargeTrade(market, minWhaleUsd) {
  const latestBlock = await polygonClient.getBlockNumber();
  const blocksBack = BigInt(process.env.POLYSIGNAL_SCAN_BLOCKS || 15000);
  const fromBlock = latestBlock > blocksBack ? latestBlock - blocksBack : 0n;
  const minimumAmount = parseUnits(String(minWhaleUsd), Number(USDC_DECIMALS));
  const { yesTokenId, noTokenId } = extractTokenIds(market);
  const trackedTokenIds = new Set([yesTokenId.toString(), noTokenId.toString()]);

  const [binaryLogs, negRiskLogs] = await Promise.all([
    getLogsInChunks(CTF_EXCHANGE_ADDRESS, fromBlock, latestBlock),
    getLogsInChunks(NEG_RISK_EXCHANGE_ADDRESS, fromBlock, latestBlock),
  ]);

  const latestTrade = [...binaryLogs, ...negRiskLogs]
    .map(decodePolymarketTrade)
    .filter((trade) => trackedTokenIds.has(trade.tokenId.toString()))
    .filter((trade) => trade.amount >= minimumAmount)
    .sort((a, b) => {
      if (a.blockNumber === b.blockNumber) {
        return Number(b.logIndex - a.logIndex);
      }
      return Number(b.blockNumber - a.blockNumber);
    })[0];

  if (!latestTrade) {
    throw new Error(
      `No Polymarket trade above ${minWhaleUsd} USDC found in the last ${blocksBack} Polygon blocks`
    );
  }

  return latestTrade;
}

async function main() {
  const privateKey = normalizePrivateKey(requireEnv("PRIVATE_KEY"));
  const account = privateKeyToAccount(privateKey);
  const marketSlug = process.env.POLYMARKET_MARKET_SLUG || "will-the-iranian-regime-fall-by-june-30";
  const minWhaleUsd = Number(process.env.POLYSIGNAL_MIN_WHALE_USDC || "25000");
  const originAddress = requireEnv("POLYSIGNAL_ORIGIN_ADDRESS");

  const market = await fetchMarketBySlug(marketSlug);
  const latestTrade = await findLatestLargeTrade(market, minWhaleUsd);
  const { yesBps, noBps } = extractOutcomePrices(market);

  const marketContext = {
    marketId: keccak256(`0x${String(market.conditionId).replace(/^0x/, "")}`),
    marketTitle: market.question || marketSlug,
    liquidity: Number(market.liquidityNum || market.liquidity || 0),
    smartMoneyAddresses: (process.env.POLYSIGNAL_SMART_MONEY_ADDRESSES || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    newWalletAddresses: (process.env.POLYSIGNAL_NEW_WALLET_ADDRESSES || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };

  const accountAgeDays = marketContext.newWalletAddresses.includes(
    latestTrade.trader.toLowerCase()
  )
    ? 1
    : 45;

  const oddsBps =
    latestTrade.tokenId.toString() === extractTokenIds(market).yesTokenId.toString()
      ? yesBps
      : noBps;

  const anomalyProfile = computeAnomalyProfile({
    trade: {
      amount: latestTrade.amount,
      direction: latestTrade.side === "BUY" ? 0 : 1,
      trader: latestTrade.trader,
      counterparty: latestTrade.counterparty,
      oddsBps,
    },
    market: marketContext,
    accountAgeDays,
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(),
  });

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  const request = {
    abi: originAbi,
    address: getAddress(originAddress),
    functionName: "reportTradeSignal",
    args: [
      {
        sourceTradeId: latestTrade.sourceTradeId,
        marketId: marketContext.marketId,
        trader: latestTrade.trader,
        amount: latestTrade.amount,
        direction: latestTrade.side === "BUY" ? 0 : 1,
        accountAgeDays,
        oddsBps,
        totalPositionUsd: anomalyProfile.totalPositionUsd,
        anomalyFlags: anomalyProfile.anomalyFlags,
        riskScoreBps: anomalyProfile.riskScoreBps,
        recentTradeCount: anomalyProfile.recentTradeCount,
        sameSideStreak: anomalyProfile.sameSideStreak,
        counterpartyConcentrationBps: anomalyProfile.counterpartyConcentrationBps,
        marketImpactBps: anomalyProfile.marketImpactBps,
        washClusterScoreBps: anomalyProfile.washClusterScoreBps,
        smartMoneyScoreBps: anomalyProfile.smartMoneyScoreBps,
        marketTitle: marketContext.marketTitle,
      },
    ],
    account,
    chain: sepolia,
  };

  const gas = await publicClient.estimateContractGas(request);
  const txHash = await walletClient.writeContract({
    ...request,
    gas: (gas * 13n) / 10n,
  });

  console.log("Origin relay tx hash:", txHash);
  console.log("Tracked market:", marketContext.marketTitle);
  console.log("Source trade:", latestTrade.txHash);
  console.log(
    "Anomaly flags:",
    decodeAnomalyFlags(anomalyProfile.anomalyFlags)
      .map((item) => item.label)
      .join(", ")
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
