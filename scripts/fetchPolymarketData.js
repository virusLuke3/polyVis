require("dotenv").config();
const { applyClashProxyEnv } = require("./lib/proxy");
applyClashProxyEnv();

const fs = require("fs");
const path = require("path");
const { createPublicClient, decodeEventLog, defineChain, http, parseAbi } = require("viem");

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const LOG_BLOCK_BATCH = BigInt(process.env.POLYMARKET_LOG_BLOCK_BATCH || 1000);

const orderFilledAbi = parseAbi([
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

const polygon = defineChain({
  id: 137,
  name: "Polygon",
  network: "polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.POLYGON_RPC_URL || "https://polygon-rpc.com"] },
  },
});

const polygonClient = createPublicClient({
  chain: polygon,
  transport: http(),
});

function parseJsonArrayMaybe(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

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
    return tokenIds;
  }

  const tokens = Array.isArray(market.tokens) ? market.tokens : [];
  return tokens.map((token) => BigInt(String(token.token_id)));
}

function decodeTrade(log) {
  const decoded = decodeEventLog({
    abi: orderFilledAbi,
    data: log.data,
    topics: log.topics,
  });

  const makerAssetId = decoded.args.makerAssetId;
  const takerAssetId = decoded.args.takerAssetId;
  const makerAmountFilled = decoded.args.makerAmountFilled;
  const takerAmountFilled = decoded.args.takerAmountFilled;
  const isBuy = makerAssetId === 0n;

  return {
    orderHash: decoded.args.orderHash,
    bettor: isBuy ? decoded.args.maker : decoded.args.taker,
    maker: decoded.args.maker,
    taker: decoded.args.taker,
    tokenId: String(isBuy ? takerAssetId : makerAssetId),
    usdcAmount: String(isBuy ? makerAmountFilled : takerAmountFilled),
    shareAmount: String(isBuy ? takerAmountFilled : makerAmountFilled),
    side: isBuy ? "BUY" : "SELL",
    txHash: log.transactionHash,
    blockNumber: Number(log.blockNumber),
    logIndex: Number(log.logIndex),
    exchange: log.address,
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

async function fetchRecentTradesForMarket(market, blocksBack) {
  const latestBlock = await polygonClient.getBlockNumber();
  const fromBlock = latestBlock > blocksBack ? latestBlock - blocksBack : 0n;
  const tokenIds = new Set(extractTokenIds(market).map((value) => value.toString()));

  const [binaryLogs, negRiskLogs] = await Promise.all([
    getLogsInChunks(CTF_EXCHANGE_ADDRESS, fromBlock, latestBlock),
    getLogsInChunks(NEG_RISK_EXCHANGE_ADDRESS, fromBlock, latestBlock),
  ]);

  return [...binaryLogs, ...negRiskLogs]
    .map(decodeTrade)
    .filter((trade) => tokenIds.has(trade.tokenId))
    .sort((a, b) => {
      if (a.blockNumber === b.blockNumber) {
        return b.logIndex - a.logIndex;
      }
      return b.blockNumber - a.blockNumber;
    });
}

async function main() {
  const slug = process.env.POLYMARKET_MARKET_SLUG || "will-the-iranian-regime-fall-by-june-30";
  const snapshotPath =
    process.env.POLYMARKET_SNAPSHOT_PATH || "./data/polymarket/latest-market.json";
  const blocksBack = BigInt(process.env.POLYSIGNAL_SCAN_BLOCKS || 15000);

  const market = await fetchMarketBySlug(slug);
  const trades = await fetchRecentTradesForMarket(market, blocksBack);

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    slug,
    conditionId: market.conditionId,
    question: market.question,
    clobTokenIds: parseJsonArrayMaybe(market.clobTokenIds),
    outcomePrices: parseJsonArrayMaybe(market.outcomePrices),
    volume: market.volume,
    liquidity: market.liquidity,
    trades: trades.slice(0, 25),
  };

  const targetPath = path.resolve(snapshotPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(snapshot, null, 2));

  console.log(`Saved Polymarket snapshot to ${targetPath}`);
  console.log(`Market: ${snapshot.question}`);
  console.log(`Trades captured: ${snapshot.trades.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
