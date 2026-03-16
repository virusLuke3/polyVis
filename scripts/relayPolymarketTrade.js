require("dotenv").config();
const { applyClashProxyEnv, normalizePrivateKey } = require("./lib/proxy");
const { computeAnomalyProfile, decodeAnomalyFlags } = require("./lib/anomaly");
const { evaluateReactiveSignal } = require("./lib/reactiveSignal");
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
const SOMNIA_USE_LEGACY_TX = (process.env.SOMNIA_USE_LEGACY_TX || "true") === "true";
const SOMNIA_GAS_BUFFER_BPS = BigInt(process.env.SOMNIA_GAS_BUFFER_BPS || "13000");

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

const tradeBridgeAbi = parseAbi([
  "function logTrade((bytes32 sourceTradeId, bytes32 marketId, address trader, uint256 amount, uint8 direction, uint64 accountAgeDays, uint32 oddsBps, uint256 totalPositionUsd, uint16 anomalyFlags, uint16 riskScoreBps, uint16 recentTradeCount, uint16 sameSideStreak, uint16 counterpartyConcentrationBps, uint16 marketImpactBps, uint16 washClusterScoreBps, uint16 smartMoneyScoreBps, string marketTitle) tradeInput) returns (uint64 sequence)",
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

const somniaTestnet = defineChain({
  id: Number(process.env.SOMNIA_CHAIN_ID || 50312),
  name: "Somnia Testnet",
  network: "somnia-testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.SOMNIA_RPC_URL || "https://dream-rpc.somnia.network"],
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

function getSomniaTxOverrides() {
  const gasPrice = process.env.SOMNIA_GAS_PRICE_WEI
    ? BigInt(process.env.SOMNIA_GAS_PRICE_WEI)
    : undefined;

  if (SOMNIA_USE_LEGACY_TX) {
    return gasPrice ? { gasPrice } : {};
  }

  return {};
}

function withGasBuffer(gasEstimate) {
  return (gasEstimate * SOMNIA_GAS_BUFFER_BPS) / 10000n;
}

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

function formatUsd6(value) {
  return `${Number(value) / 1e6}`;
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

  const fallback = Array.isArray(market.tokens) ? market.tokens : [];
  const yes = fallback.find((token) => String(token.outcome).toUpperCase() === "YES");
  const no = fallback.find((token) => String(token.outcome).toUpperCase() === "NO");

  if (!yes || !no) {
    throw new Error("Unable to determine YES/NO token IDs from Gamma market payload");
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

  const tokens = Array.isArray(market.tokens) ? market.tokens : [];
  const yes = tokens.find((token) => String(token.outcome).toUpperCase() === "YES");
  const no = tokens.find((token) => String(token.outcome).toUpperCase() === "NO");

  return {
    yesBps: Math.round(Number(yes?.price || 0) * 10_000),
    noBps: Math.round(Number(no?.price || 0) * 10_000),
  };
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

  return {
    ...latestTrade,
    direction: latestTrade.tokenId === yesTokenId ? 0 : 1,
  };
}

function mockAccountAgeDays(trader) {
  const allowlist = (process.env.POLYSIGNAL_NEW_WALLET_ADDRESSES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(trader.toLowerCase()) ? 1 : 45;
}

function buildBridgePayload(market, trade, profile) {
  const { yesBps, noBps } = extractOutcomePrices(market);
  const oddsBps = trade.direction === 0 ? yesBps : noBps;

  return {
    sourceTradeId: trade.sourceTradeId,
    marketId: market.conditionId,
    trader: trade.trader,
    amount: trade.amount,
    direction: trade.direction,
    accountAgeDays: mockAccountAgeDays(trade.trader),
    oddsBps,
    totalPositionUsd: profile.totalPositionUsd,
    anomalyFlags: profile.anomalyFlags,
    riskScoreBps: profile.riskScoreBps,
    recentTradeCount: profile.recentTradeCount,
    sameSideStreak: profile.sameSideStreak,
    counterpartyConcentrationBps: profile.counterpartyConcentrationBps,
    marketImpactBps: profile.marketImpactBps,
    washClusterScoreBps: profile.washClusterScoreBps,
    smartMoneyScoreBps: profile.smartMoneyScoreBps,
    marketTitle: market.question || market.slug || "Unknown market",
  };
}

function toBridgeTuple(payload) {
  return {
    sourceTradeId: payload.sourceTradeId,
    marketId: payload.marketId,
    trader: payload.trader,
    amount: payload.amount,
    direction: payload.direction,
    accountAgeDays: payload.accountAgeDays,
    oddsBps: payload.oddsBps,
    totalPositionUsd: payload.totalPositionUsd,
    anomalyFlags: payload.anomalyFlags,
    riskScoreBps: payload.riskScoreBps,
    recentTradeCount: payload.recentTradeCount,
    sameSideStreak: payload.sameSideStreak,
    counterpartyConcentrationBps: payload.counterpartyConcentrationBps,
    marketImpactBps: payload.marketImpactBps,
    washClusterScoreBps: payload.washClusterScoreBps,
    smartMoneyScoreBps: payload.smartMoneyScoreBps,
    marketTitle: payload.marketTitle,
  };
}

async function main() {
  const privateKey = normalizePrivateKey(requireEnv("PRIVATE_KEY"));
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: http(),
  });
  const publicSomniaClient = createPublicClient({
    chain: somniaTestnet,
    transport: http(),
  });

  const tradeBridgeAddress =
    process.env.POLYMARKET_TRADE_BRIDGE_ADDRESS || requireEnv("MOCK_POLYMARKET_ADDRESS");
  const reactiveAddress = process.env.POLYSIGNAL_REACTIVE_ADDRESS || "";
  const slug = process.env.POLYMARKET_MARKET_SLUG || "trump-presidential-election";
  const minWhaleUsd = Number(process.env.POLYSIGNAL_MIN_WHALE_USDC || "25000");

  const market = await fetchMarketBySlug(slug);
  const trade = await findLatestLargeTrade(market, minWhaleUsd);
  const latestBlock = await polygonClient.getBlockNumber();
  const blocksBack = BigInt(process.env.POLYSIGNAL_SCAN_BLOCKS || 15000);
  const fromBlock = latestBlock > blocksBack ? latestBlock - blocksBack : 0n;
  const { yesTokenId, noTokenId } = extractTokenIds(market);
  const trackedTokenIds = new Set([yesTokenId.toString(), noTokenId.toString()]);
  const [binaryLogs, negRiskLogs] = await Promise.all([
    getLogsInChunks(CTF_EXCHANGE_ADDRESS, fromBlock, latestBlock),
    getLogsInChunks(NEG_RISK_EXCHANGE_ADDRESS, fromBlock, latestBlock),
  ]);
  const marketTrades = [...binaryLogs, ...negRiskLogs]
    .map(decodePolymarketTrade)
    .filter((item) => trackedTokenIds.has(item.tokenId.toString()));

  const outcomePrices = extractOutcomePrices(market);
  const traderHistory = marketTrades.filter(
    (item) =>
      item.trader.toLowerCase() === trade.trader.toLowerCase() &&
      !(item.txHash === trade.txHash && item.logIndex === trade.logIndex)
  );
  const profile = computeAnomalyProfile({
    trade: {
      ...trade,
      oddsBps: trade.direction === 0 ? outcomePrices.yesBps : outcomePrices.noBps,
    },
    market,
    recentTrades: marketTrades,
    traderHistory,
    accountAgeDays: mockAccountAgeDays(trade.trader),
  });
  const payload = buildBridgePayload(market, trade, profile);

  console.log("Selected market:", payload.marketTitle);
  console.log("Trade tx:", trade.txHash);
  console.log("Trader:", payload.trader);
  console.log("Direction:", payload.direction === 0 ? "YES" : "NO");
  console.log("Amount (USDC):", formatUsd6(payload.amount));
  console.log("Odds (bps):", payload.oddsBps);
  console.log("Mock account age (days):", payload.accountAgeDays);
  console.log(
    "Anomaly flags:",
    decodeAnomalyFlags(payload.anomalyFlags)
      .map((item) => item.label)
      .join(", ") || "none"
  );
  console.log("Risk score:", payload.riskScoreBps);

  if (reactiveAddress) {
    const preview = evaluateReactiveSignal(payload);
    console.log("Reactive preview:", preview);
  }

  const gas = withGasBuffer(
    await publicSomniaClient.estimateContractGas({
      address: getAddress(tradeBridgeAddress),
      abi: tradeBridgeAbi,
      functionName: "logTrade",
      args: [toBridgeTuple(payload)],
      chain: somniaTestnet,
      account,
      ...getSomniaTxOverrides(),
    })
  );

  const txHash = await walletClient.writeContract({
    address: getAddress(tradeBridgeAddress),
    abi: tradeBridgeAbi,
    functionName: "logTrade",
    args: [toBridgeTuple(payload)],
    chain: somniaTestnet,
    account,
    gas,
    ...getSomniaTxOverrides(),
  });

  console.log("Relayed to Somnia tx:", txHash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
