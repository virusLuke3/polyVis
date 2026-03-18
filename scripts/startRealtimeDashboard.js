require("dotenv").config();
const { applyClashProxyEnv, normalizePrivateKey } = require("./lib/proxy");
const { computeAnomalyProfile, decodeAnomalyFlags } = require("./lib/anomaly");
const { evaluateReactiveSignal } = require("./lib/reactiveSignal");
applyClashProxyEnv();

const fs = require("fs");
const path = require("path");
const http = require("http");
const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodePacked,
  getAddress,
  http: httpTransport,
  keccak256,
  parseAbi,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const USDC_DECIMALS = 6;
const LOG_BLOCK_BATCH = BigInt(process.env.POLYMARKET_LOG_BLOCK_BATCH || "1000");
const SOMNIA_LOG_BLOCK_BATCH = BigInt(process.env.SOMNIA_LOG_BLOCK_BATCH || "900");
const MAX_TRADE_LOGS_PER_POLL = Number(process.env.POLYSIGNAL_MAX_TRADE_LOGS_PER_POLL || "400");
const PROGRESS_PERSIST_EVERY = Number(process.env.POLYSIGNAL_PROGRESS_PERSIST_EVERY || "25");
const MAX_RAW_LOGS_BUFFER = Number(
  process.env.POLYSIGNAL_MAX_RAW_LOGS_BUFFER || String(Math.max(MAX_TRADE_LOGS_PER_POLL * 4, 1000))
);
const COLD_START_BLOCKS = BigInt(process.env.POLYSIGNAL_COLD_START_BLOCKS || "2");
const SOMNIA_USE_LEGACY_TX = (process.env.SOMNIA_USE_LEGACY_TX || "true") === "true";
const SOMNIA_GAS_BUFFER_BPS = BigInt(process.env.SOMNIA_GAS_BUFFER_BPS || "13000");
const PORT_AUTO_INCREMENT = (process.env.PORT_AUTO_INCREMENT || "true") === "true";
const PORT_SEARCH_LIMIT = Number(process.env.PORT_SEARCH_LIMIT || "20");
const RUNTIME_DIR = path.resolve(process.env.POLYSIGNAL_RUNTIME_DIR || "./data/runtime");
const CURSOR_PATH = path.join(RUNTIME_DIR, "cursor.json");
const SNAPSHOT_PATH = path.join(RUNTIME_DIR, "dashboard-state.json");
const MARKETS_CACHE_PATH = path.join(RUNTIME_DIR, "markets-cache.json");
const MARKETS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PUBLIC_DIR = path.resolve("./public");

const polymarketOrderFilledAbi = parseAbi([
  "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)",
]);

const tradeBridgeAbi = parseAbi([
  "function logTrade((bytes32 sourceTradeId, bytes32 marketId, address trader, uint256 amount, uint8 direction, uint64 accountAgeDays, uint32 oddsBps, uint256 totalPositionUsd, uint16 anomalyFlags, uint16 riskScoreBps, uint16 recentTradeCount, uint16 sameSideStreak, uint16 counterpartyConcentrationBps, uint16 marketImpactBps, uint16 washClusterScoreBps, uint16 smartMoneyScoreBps, string marketTitle) tradeInput) returns (uint64 sequence)",
]);

const alphaSignalEvent = {
  type: "event",
  name: "AlphaSignal",
  inputs: [
    { indexed: true, name: "marketId", type: "bytes32" },
    { indexed: true, name: "trader", type: "address" },
    { indexed: true, name: "sourceTradeId", type: "bytes32" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "direction", type: "uint8" },
    { indexed: false, name: "analysisCode", type: "uint8" },
    { indexed: false, name: "matchedFlags", type: "uint16" },
    { indexed: false, name: "relayedFlags", type: "uint16" },
    { indexed: false, name: "riskScoreBps", type: "uint16" },
    { indexed: false, name: "oddsBps", type: "uint32" },
    { indexed: false, name: "totalPositionUsd", type: "uint256" },
    { indexed: false, name: "observedAt", type: "uint64" },
    { indexed: false, name: "marketTitle", type: "string" },
    { indexed: false, name: "thesis", type: "string" },
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
  transport: httpTransport(),
});

const somniaPublicClient = createPublicClient({
  chain: somniaTestnet,
  transport: httpTransport(),
});

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

const privateKey = normalizePrivateKey(process.env.PRIVATE_KEY);
const account = privateKey ? privateKeyToAccount(privateKey) : null;
const somniaWalletClient = account
  ? createWalletClient({
      account,
      chain: somniaTestnet,
      transport: httpTransport(),
    })
  : null;

function parseMarketSlugs() {
  const configured = process.env.POLYMARKET_MARKET_SLUGS || process.env.POLYMARKET_MARKET_SLUG || "";

  return [
    ...new Set(
      configured
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

const state = {
  startedAt: new Date().toISOString(),
  status: "booting",
  config: {
    slugs: parseMarketSlugs(),
    trackAllActiveMarkets: (process.env.POLYMARKET_TRACK_ALL_ACTIVE || "true") === "true",
    activeMarketsLimit: Number(process.env.POLYMARKET_ACTIVE_MARKETS_LIMIT || "3000"),
    activeMarketsPageSize: Number(process.env.POLYMARKET_ACTIVE_MARKETS_PAGE_SIZE || "500"),
    marketRefreshMs: Number(process.env.POLYMARKET_MARKET_REFRESH_MS || "900000"),
    minWhaleUsd: Number(process.env.POLYSIGNAL_MIN_WHALE_USDC || "25000"),
    pollIntervalMs: Number(process.env.POLYSIGNAL_POLL_INTERVAL_MS || "12000"),
    dashboardPort: Number(process.env.PORT || "3000"),
    somniaChainId: Number(process.env.SOMNIA_CHAIN_ID || "50312"),
    somniaRpcUrl: process.env.SOMNIA_RPC_URL || "https://dream-rpc.somnia.network",
    bridgeAddress: process.env.POLYMARKET_TRADE_BRIDGE_ADDRESS || process.env.MOCK_POLYMARKET_ADDRESS || "",
    reactiveAddress: process.env.POLYSIGNAL_REACTIVE_ADDRESS || "",
    accessPassAddress: process.env.POLYSIGNAL_ACCESS_PASS_ADDRESS || "",
    premiumPriceWei: process.env.POLYSIGNAL_PREMIUM_PRICE_WEI || "0",
    accessDurationDays: Number(process.env.POLYSIGNAL_ACCESS_DURATION_DAYS || "30"),
  },
  activeMarketSlug: null,
  market: null,
  markets: [],
  lastMarketRefreshAt: null,
  latestBlock: null,
  lastProcessedBlock: null,
  counters: {
    tradesSeen: 0,
    tradesRelayed: 0,
    signalsProjected: 0,
    signalsObserved: 0,
    relayFailures: 0,
  },
  analytics: {
    totalVolumeUsd: 0,
    yesVolumeUsd: 0,
    noVolumeUsd: 0,
    buyCount: 0,
    sellCount: 0,
    whaleTrades: 0,
    uniqueTraders: 0,
    avgTradeUsd: 0,
    convictionScore: 0,
  },
  trades: [],
  alphaSignals: [],
  events: [],
  errors: [],
};

const sseClients = new Set();
let pollTimer = null;
let httpServer = null;
const marketContexts = new Map();
const tokenMarketIndex = new Map();
let isPolling = false;
const processedTrades = [];

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
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

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  ensureRuntimeDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function fetchJsonWithRetry(url, options = {}) {
  const retries = Number(options.retries || 3);
  const timeoutMs = Number(options.timeoutMs || 15_000);
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "PolySignal/0.1",
          ...(options.headers || {}),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function restoreSnapshotState() {
  const snapshot = readJsonIfExists(SNAPSHOT_PATH);
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  state.activeMarketSlug = snapshot.activeMarketSlug || state.activeMarketSlug;
  state.market = snapshot.market || state.market;
  state.markets = Array.isArray(snapshot.markets) ? snapshot.markets : state.markets;
  state.lastMarketRefreshAt = snapshot.lastMarketRefreshAt || state.lastMarketRefreshAt;
  state.latestBlock = snapshot.latestBlock ?? state.latestBlock;
  state.lastProcessedBlock = snapshot.lastProcessedBlock ?? state.lastProcessedBlock;
  state.counters = snapshot.counters || state.counters;
  state.analytics = snapshot.analytics || state.analytics;
  state.trades = Array.isArray(snapshot.trades) ? snapshot.trades : state.trades;
  state.alphaSignals = Array.isArray(snapshot.alphaSignals) ? snapshot.alphaSignals : state.alphaSignals;
  state.events = Array.isArray(snapshot.events) ? snapshot.events : state.events;
  state.errors = [];
}

function normalizeRelayError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const duplicate =
    message.includes("DuplicateSourceTrade") ||
    message.includes("0xb4bcdd0c") ||
    message.toLowerCase().includes("duplicate source trade");

  if (duplicate) {
    return {
      duplicate: true,
      message: "Already relayed earlier on Somnia for this source trade.",
    };
  }

  return {
    duplicate: false,
    message,
  };
}

function pushEvent(type, payload) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };

  state.events = [event, ...state.events].slice(0, 80);
  broadcast("event", event);
  persistState();
}

function recordError(error) {
  const message = error instanceof Error ? error.message : String(error);
  state.errors = [{ timestamp: new Date().toISOString(), message }, ...state.errors].slice(0, 20);
  state.status = "degraded";
  pushEvent("error", { message });
}

function broadcast(eventName, data) {
  const body = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of sseClients) {
    response.write(body);
  }
}

function persistState() {
  writeJson(SNAPSHOT_PATH, state);
  broadcast("state", state);
}

function formatUsd6(rawAmount) {
  return Number(rawAmount) / 10 ** USDC_DECIMALS;
}

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function extractEventSlug(market) {
  if (typeof market?.eventSlug === "string" && market.eventSlug.trim()) {
    return market.eventSlug;
  }
  const events = Array.isArray(market?.events) ? market.events : [];
  const candidate = events.find((event) => event && typeof event.slug === "string" && event.slug.trim());
  return candidate?.slug || "";
}

function toPolymarketUrl(market) {
  const slug = extractEventSlug(market) || market?.slug || "";
  return slug ? `https://polymarket.com/event/${slug}` : "";
}

function getMarketKey(market) {
  return market?.slug || market?.conditionId || "";
}

function buildMarketSummary(context) {
  return {
    slug: getMarketKey(context.market),
    question: context.market.question,
    conditionId: context.market.conditionId,
    volume: Number(context.market.volume || 0),
    liquidity: Number(context.market.liquidity || 0),
    outcomePrices: context.outcomePrices,
    polymarketUrl: context.polymarketUrl,
    trackedVolumeUsd: 0,
    suspiciousTrades: 0,
    relayedTrades: 0,
    alphaSignals: 0,
    lastTradeAt: null,
    lastAlphaAt: null,
    lastAnomalies: [],
    latestThesis: "",
  };
}

function normalizeMarketPayload(market) {
  if (!market || !market.conditionId) {
    return null;
  }

  const tokens = Array.isArray(market.tokens)
    ? market.tokens
        .filter(Boolean)
        .slice(0, 4)
        .map((token) => ({
          outcome: token.outcome,
          token_id: token.token_id,
          price: token.price,
        }))
    : [];

  return {
    slug: market.slug || "",
    eventSlug: extractEventSlug(market) || market.slug || "",
    question: market.question || "",
    conditionId: String(market.conditionId),
    volume: Number(market.volume || 0),
    liquidity: Number(market.liquidity || 0),
    clobTokenIds: market.clobTokenIds || [],
    outcomePrices: market.outcomePrices || [],
    tokens,
  };
}

function sortMarketSummaries() {
  state.markets.sort((a, b) => {
    const alphaDelta = (b.alphaSignals || 0) - (a.alphaSignals || 0);
    if (alphaDelta !== 0) return alphaDelta;

    const suspiciousDelta = (b.suspiciousTrades || 0) - (a.suspiciousTrades || 0);
    if (suspiciousDelta !== 0) return suspiciousDelta;

    const relayedDelta = (b.relayedTrades || 0) - (a.relayedTrades || 0);
    if (relayedDelta !== 0) return relayedDelta;

    const trackedVolumeDelta = Number(b.trackedVolumeUsd || 0) - Number(a.trackedVolumeUsd || 0);
    if (trackedVolumeDelta !== 0) return trackedVolumeDelta;

    return Number(b.volume || 0) - Number(a.volume || 0);
  });
}

function syncPrimaryMarket() {
  sortMarketSummaries();

  if (!state.activeMarketSlug && state.markets.length > 0) {
    state.activeMarketSlug = state.markets[0].slug;
  }

  state.market =
    state.markets.find((item) => item.slug === state.activeMarketSlug) || state.markets[0] || null;
}

function upsertMarketSummary(summary) {
  const index = state.markets.findIndex((item) => item.slug === summary.slug);
  if (index === -1) {
    state.markets.push(summary);
  } else {
    state.markets[index] = { ...state.markets[index], ...summary };
  }
  syncPrimaryMarket();
}

function updateMarketSummary(slug, updater) {
  const index = state.markets.findIndex((item) => item.slug === slug);
  if (index === -1) {
    return;
  }

  const current = state.markets[index];
  const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
  state.markets[index] = next;
  syncPrimaryMarket();
}

async function fetchMarketBySlug(slug) {
  const data = await fetchJsonWithRetry(`${GAMMA_API_BASE}/markets?slug=${encodeURIComponent(slug)}`);
  const market = normalizeMarketPayload(Array.isArray(data) ? data[0] : data);
  if (!market || !market.conditionId) {
    throw new Error(`No market found for slug "${slug}"`);
  }
  return market;
}

async function fetchActiveMarkets() {
  // Return cached markets if still fresh
  const cached = readJsonIfExists(MARKETS_CACHE_PATH);
  if (cached?.markets && Date.now() - (cached.savedAt || 0) < MARKETS_CACHE_TTL_MS) {
    return cached.markets;
  }

  const allMarkets = [];
  const pageSize = Math.max(1, state.config.activeMarketsPageSize);
  const maxMarkets = Math.max(pageSize, state.config.activeMarketsLimit);

  for (let offset = 0; offset < maxMarkets; offset += pageSize) {
    const data = await fetchJsonWithRetry(
      `${GAMMA_API_BASE}/markets?active=true&closed=false&limit=${pageSize}&offset=${offset}&order=volume&ascending=false`
    );
    const markets = Array.isArray(data) ? data : [];
    if (markets.length === 0) {
      break;
    }

    for (const market of markets) {
      const normalized = normalizeMarketPayload(market);
      if (normalized) {
        allMarkets.push(normalized);
      }
    }
    if (markets.length < pageSize) {
      break;
    }
  }

  const result = allMarkets.sort((a, b) => b.volume - a.volume).slice(0, maxMarkets);
  writeJson(MARKETS_CACHE_PATH, { savedAt: Date.now(), markets: result });
  return result;
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
    throw new Error("Unable to determine YES/NO token IDs from market payload");
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

function mockAccountAgeDays(trader) {
  const allowlist = (process.env.POLYSIGNAL_NEW_WALLET_ADDRESSES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.includes(trader.toLowerCase())) {
    return 1;
  }
  // Derive a pseudo-random age from the trader address so different wallets
  // get different ages, making detection more realistic.
  const seed = parseInt(trader.slice(-4), 16) % 365;
  return seed + 1;
}

function computeTraderPositionUsd(trade) {
  return trade.amount;
}

function buildBridgePayload(trade) {
  const context = marketContexts.get(trade.marketSlug);
  if (!context) {
    throw new Error(`Missing market context for slug "${trade.marketSlug}"`);
  }

  const oddsBps = trade.direction === 0 ? context.outcomePrices.yesBps : context.outcomePrices.noBps;
  const marketScopedTrades = processedTrades.filter((item) => item.marketSlug === trade.marketSlug);
  const traderHistory = processedTrades.filter(
    (item) =>
      item.marketSlug === trade.marketSlug &&
      item.trader.toLowerCase() === trade.trader.toLowerCase() &&
      !(item.txHash === trade.txHash && item.logIndex === trade.logIndex)
  );
  const profile = computeAnomalyProfile({
    trade: { ...trade, oddsBps },
    market: context.market,
    recentTrades: marketScopedTrades,
    traderHistory,
    accountAgeDays: mockAccountAgeDays(trade.trader),
  });

  return {
    sourceTradeId: trade.sourceTradeId,
    marketId: context.market.conditionId,
    trader: trade.trader,
    amount: trade.amount,
    direction: trade.direction,
    accountAgeDays: mockAccountAgeDays(trade.trader),
    oddsBps,
    totalPositionUsd: profile.totalPositionUsd || computeTraderPositionUsd(trade),
    anomalyFlags: profile.anomalyFlags,
    riskScoreBps: profile.riskScoreBps,
    recentTradeCount: profile.recentTradeCount,
    sameSideStreak: profile.sameSideStreak,
    counterpartyConcentrationBps: profile.counterpartyConcentrationBps,
    marketImpactBps: profile.marketImpactBps,
    washClusterScoreBps: profile.washClusterScoreBps,
    smartMoneyScoreBps: profile.smartMoneyScoreBps,
    marketTitle: context.market.question || context.market.slug || "Unknown market",
    anomalyLabels: profile.labels,
    marketSlug: getMarketKey(context.market),
    polymarketUrl: context.polymarketUrl,
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

function updateAnalytics(enrichedTrade) {
  const tradeUsd = enrichedTrade.amountUsd;
  state.counters.tradesSeen += 1;
  state.analytics.totalVolumeUsd += tradeUsd;
  if (enrichedTrade.directionLabel === "YES") {
    state.analytics.yesVolumeUsd += tradeUsd;
  } else {
    state.analytics.noVolumeUsd += tradeUsd;
  }
  if (enrichedTrade.side === "BUY") {
    state.analytics.buyCount += 1;
  } else {
    state.analytics.sellCount += 1;
  }
  if (tradeUsd >= state.config.minWhaleUsd) {
    state.analytics.whaleTrades += 1;
  }

  const traderSet = new Set(state.trades.map((item) => item.trader));
  state.analytics.uniqueTraders = traderSet.size;
  state.analytics.avgTradeUsd =
    state.counters.tradesSeen === 0 ? 0 : state.analytics.totalVolumeUsd / state.counters.tradesSeen;

  const denominator = state.analytics.yesVolumeUsd + state.analytics.noVolumeUsd || 1;
  state.analytics.convictionScore = Math.round(
    (Math.abs(state.analytics.yesVolumeUsd - state.analytics.noVolumeUsd) / denominator) * 100
  );
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
  const trader = getAddress(isBuy ? decoded.args.maker : decoded.args.taker);
  const tokenId = isBuy ? takerAssetId : makerAssetId;
  const tokenContext = tokenMarketIndex.get(tokenId.toString());
  if (!tokenContext) {
    return null;
  }

  const direction = tokenContext.direction;
  const counterparty = getAddress(isBuy ? decoded.args.taker : decoded.args.maker);

  return {
    sourceTradeId: keccak256(
      encodePacked(
        ["bytes32", "uint256", "bytes32"],
        [decoded.args.orderHash, BigInt(log.logIndex), log.transactionHash]
      )
    ),
    txHash: log.transactionHash,
    trader,
    counterparty,
    marketSlug: getMarketKey(tokenContext.market),
    marketTitle: tokenContext.market.question,
    marketUrl: tokenContext.polymarketUrl,
    marketId: tokenContext.market.conditionId,
    tokenId: tokenId.toString(),
    amount: isBuy ? makerAmountFilled : takerAmountFilled,
    shares: isBuy ? takerAmountFilled : makerAmountFilled,
    side: isBuy ? "BUY" : "SELL",
    direction,
    directionLabel: direction === 0 ? "YES" : "NO",
    blockNumber: Number(log.blockNumber),
    logIndex: Number(log.logIndex),
    exchange: getAddress(log.address),
  };
}

function hydrateTradeForDashboard(trade, relayTxHash, signalProjection) {
  const amountUsd = formatUsd6(trade.amount);
  return {
    id: `${trade.txHash}-${trade.logIndex}`,
    sourceTradeId: trade.sourceTradeId,
    marketSlug: trade.marketSlug,
    marketTitle: trade.marketTitle,
    marketUrl: trade.marketUrl,
    txHash: trade.txHash,
    relayTxHash,
    trader: trade.trader,
    traderLabel: shortAddress(trade.trader),
    amountUsd,
    shares: trade.shares.toString(),
    side: trade.side,
    direction: trade.direction,
    directionLabel: trade.directionLabel,
    anomalyLabels: trade.anomalyLabels || [],
    riskScoreBps: trade.riskScoreBps || 0,
    counterpartyLabel: trade.counterparty ? shortAddress(trade.counterparty) : "",
    blockNumber: trade.blockNumber,
    logIndex: trade.logIndex,
    exchange: trade.exchange,
    observedAt: new Date().toISOString(),
    signalProjection,
  };
}

async function projectSignal(payload) {
  return evaluateReactiveSignal(payload);
}

async function relayTrade(payload) {
  if (!somniaWalletClient || !account) {
    return { skipped: true, reason: "Missing PRIVATE_KEY for relay." };
  }
  if (!state.config.bridgeAddress) {
    return { skipped: true, reason: "Missing bridge contract address." };
  }

  const gas = withGasBuffer(
    await somniaPublicClient.estimateContractGas({
      address: getAddress(state.config.bridgeAddress),
      abi: tradeBridgeAbi,
      functionName: "logTrade",
      args: [toBridgeTuple(payload)],
      account,
      chain: somniaTestnet,
      ...getSomniaTxOverrides(),
    })
  );

  const txHash = await somniaWalletClient.writeContract({
    address: getAddress(state.config.bridgeAddress),
    abi: tradeBridgeAbi,
    functionName: "logTrade",
    args: [toBridgeTuple(payload)],
    account,
    chain: somniaTestnet,
    gas,
    ...getSomniaTxOverrides(),
  });

  state.counters.tradesRelayed += 1;
  return { skipped: false, txHash };
}

function loadCursor() {
  const cursor = readJsonIfExists(CURSOR_PATH);
  return {
    lastProcessedBlock: cursor?.lastProcessedBlock ? BigInt(cursor.lastProcessedBlock) : null,
    lastAlphaBlock: cursor?.lastAlphaBlock ? BigInt(cursor.lastAlphaBlock) : null,
    seenTradeIds: new Set(Array.isArray(cursor?.seenTradeIds) ? cursor.seenTradeIds : []),
    seenAlphaIds: new Set(Array.isArray(cursor?.seenAlphaIds) ? cursor.seenAlphaIds : []),
  };
}

function saveCursor(cursor) {
  writeJson(CURSOR_PATH, {
    lastProcessedBlock: cursor.lastProcessedBlock ? cursor.lastProcessedBlock.toString() : null,
    lastAlphaBlock: cursor.lastAlphaBlock ? cursor.lastAlphaBlock.toString() : null,
    seenTradeIds: [...cursor.seenTradeIds].slice(-1000),
    seenAlphaIds: [...cursor.seenAlphaIds].slice(-1000),
  });
}

async function pollAlphaSignals(cursor) {
  if (!state.config.reactiveAddress) {
    return;
  }

  const latestBlock = await somniaPublicClient.getBlockNumber();
  const fromBlock = cursor.lastAlphaBlock
    ? cursor.lastAlphaBlock + 1n
    : latestBlock > 200n
      ? latestBlock - 200n
      : 0n;

  if (fromBlock > latestBlock) {
    return;
  }

  const logs = [];
  let startBlock = fromBlock;

  while (startBlock <= latestBlock) {
    const endBlock =
      startBlock + SOMNIA_LOG_BLOCK_BATCH - 1n < latestBlock
        ? startBlock + SOMNIA_LOG_BLOCK_BATCH - 1n
        : latestBlock;

    const chunkLogs = await somniaPublicClient.getLogs({
      address: getAddress(state.config.reactiveAddress),
      event: alphaSignalEvent,
      fromBlock: startBlock,
      toBlock: endBlock,
    });

    for (const log of chunkLogs) {
      logs.push(log);
    }
    startBlock = endBlock + 1n;
  }

  for (const log of logs) {
    const signalId = `${log.transactionHash}-${log.logIndex}`;
    if (cursor.seenAlphaIds.has(signalId)) {
      continue;
    }

    cursor.seenAlphaIds.add(signalId);
    const args = log.args;
    const marketId = String(args.marketId || "");
    const marketSummary = state.markets.find(
      (item) => item.conditionId && String(item.conditionId).toLowerCase() === marketId.toLowerCase()
    );
    const card = {
      id: signalId,
      txHash: log.transactionHash,
      marketSlug: marketSummary?.slug || "",
      marketUrl: marketSummary?.polymarketUrl || "",
      trader: args.trader,
      traderLabel: shortAddress(args.trader),
      marketTitle: args.marketTitle,
      amountUsd: formatUsd6(args.amount),
      directionLabel: Number(args.direction) === 0 ? "YES" : "NO",
      analysisCode: Number(args.analysisCode),
      matchedFlags: Number(args.matchedFlags),
      anomalyLabels: decodeAnomalyFlags(Number(args.matchedFlags)).map((item) => item.label),
      riskScoreBps: Number(args.riskScoreBps),
      oddsBps: Number(args.oddsBps),
      totalPositionUsd: formatUsd6(args.totalPositionUsd),
      thesis: args.thesis,
      observedAt: new Date(Number(args.observedAt) * 1000).toISOString(),
    };

    state.alphaSignals = [card, ...state.alphaSignals].slice(0, 50);
    state.counters.signalsObserved += 1;
    if (marketSummary?.slug) {
      updateMarketSummary(marketSummary.slug, (current) => ({
        ...current,
        alphaSignals: current.alphaSignals + 1,
        lastAlphaAt: card.observedAt,
        latestThesis: card.thesis || current.latestThesis,
        lastAnomalies: card.anomalyLabels,
      }));
    }

    pushEvent("alpha-signal", {
      marketSlug: card.marketSlug,
      marketTitle: card.marketTitle,
      trader: card.traderLabel,
      direction: card.directionLabel,
      amountUsd: card.amountUsd,
      anomalies: card.anomalyLabels.join(", "),
    });
  }

  cursor.lastAlphaBlock = latestBlock;
}

async function getLogsForRange(fromBlock, toBlock) {
  const eventDefinition = {
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

  const logs = [];
  let startBlock = fromBlock;
  const addresses = [CTF_EXCHANGE_ADDRESS, NEG_RISK_EXCHANGE_ADDRESS];

  while (startBlock <= toBlock) {
    const endBlock =
      startBlock + LOG_BLOCK_BATCH - 1n < toBlock
        ? startBlock + LOG_BLOCK_BATCH - 1n
        : toBlock;

    for (const address of addresses) {
      const chunkLogs = await polygonClient.getLogs({
        address,
        event: eventDefinition,
        fromBlock: startBlock,
        toBlock: endBlock,
      });

      for (const log of chunkLogs) {
        logs.push(log);
      }

      if (logs.length > MAX_RAW_LOGS_BUFFER) {
        logs.splice(0, logs.length - MAX_RAW_LOGS_BUFFER);
      }
    }

    startBlock = endBlock + 1n;
  }

  return logs;
}

async function initializeMarketContexts() {
  const previousActiveMarketSlug = state.activeMarketSlug;
  const discoveredMarkets = state.config.trackAllActiveMarkets ? await fetchActiveMarkets() : [];
  const slugMarkets = state.config.slugs.length
    ? await Promise.all(state.config.slugs.map((slug) => fetchMarketBySlug(slug)))
    : [];
  const uniqueMarkets = new Map();

  for (const market of [...discoveredMarkets, ...slugMarkets]) {
    if (!market?.conditionId) {
      continue;
    }
    uniqueMarkets.set(String(market.conditionId).toLowerCase(), market);
  }

  marketContexts.clear();
  tokenMarketIndex.clear();
  const nextMarketSummaries = [];

  for (const market of uniqueMarkets.values()) {
    const tokenIds = extractTokenIds(market);
    const context = {
      market,
      tokenIds,
      outcomePrices: extractOutcomePrices(market),
      polymarketUrl: toPolymarketUrl(market),
    };
    const marketKey = getMarketKey(market);

    marketContexts.set(marketKey, context);
    tokenMarketIndex.set(tokenIds.yesTokenId.toString(), { market, direction: 0, polymarketUrl: context.polymarketUrl });
    tokenMarketIndex.set(tokenIds.noTokenId.toString(), { market, direction: 1, polymarketUrl: context.polymarketUrl });
    nextMarketSummaries.push(buildMarketSummary(context));
  }

  state.markets = nextMarketSummaries;
  sortMarketSummaries();
  syncPrimaryMarket();

  if (
    !previousActiveMarketSlug ||
    !state.markets.some((market) => market.slug === previousActiveMarketSlug)
  ) {
    sortMarketSummaries();
    state.activeMarketSlug = state.markets[0]?.slug || null;
    syncPrimaryMarket();
  }

  state.lastMarketRefreshAt = new Date().toISOString();
}

async function ensureMarketContexts() {
  const refreshMs = Math.max(60_000, state.config.marketRefreshMs);
  const hasFreshMarketContexts =
    marketContexts.size > 0 &&
    state.lastMarketRefreshAt &&
    Date.now() - new Date(state.lastMarketRefreshAt).getTime() < refreshMs;

  if (hasFreshMarketContexts) {
    return true;
  }

  try {
    await initializeMarketContexts();
    pushEvent("market-sync", {
      totalMarkets: state.markets.length,
      activeMarketSlug: state.activeMarketSlug,
      sampleMarkets: state.markets.slice(0, 5).map((market) => ({
        slug: market.slug,
        question: market.question,
        polymarketUrl: market.polymarketUrl,
      })),
    });
    return true;
  } catch (error) {
    recordError(new Error(`Unable to initialize market metadata: ${error.message}`));
    return false;
  }
}

async function pollOnce(cursor) {
  if (isPolling) {
    return;
  }
  isPolling = true;

  try {
    const hasMarketContexts = await ensureMarketContexts();
    if (!hasMarketContexts) {
      persistState();
      return;
    }

    const latestBlock = await polygonClient.getBlockNumber();
    state.latestBlock = Number(latestBlock);
    persistState();

    const configuredBackfill = BigInt(process.env.POLYSIGNAL_START_BLOCKS_BACK || "250");
    const coldStartBackfill = configuredBackfill < COLD_START_BLOCKS ? configuredBackfill : COLD_START_BLOCKS;
    const fromBlock = cursor.lastProcessedBlock
      ? cursor.lastProcessedBlock + 1n
      : latestBlock > coldStartBackfill
        ? latestBlock - coldStartBackfill
        : 0n;

    if (fromBlock > latestBlock) {
      state.status = "live";
      persistState();
      return;
    }

    const logs = await getLogsForRange(fromBlock, latestBlock);
    const allTrades = logs
      .map(decodePolymarketTrade)
      .filter(Boolean)
      .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber - b.blockNumber));

    let trades = allTrades;
    if (allTrades.length > MAX_TRADE_LOGS_PER_POLL) {
      trades = allTrades.slice(-MAX_TRADE_LOGS_PER_POLL);
      pushEvent("backfill-trimmed", {
        fromBlock: fromBlock.toString(),
        toBlock: latestBlock.toString(),
        totalLogs: allTrades.length,
        processedLogs: trades.length,
        note: "Processing only the most recent trade logs in this cycle to keep the dashboard responsive.",
      });
    }

    state.counters.tradesSeen += trades.length;

    for (let index = 0; index < trades.length; index += 1) {
      const trade = trades[index];
      const tradeKey = `${trade.txHash}-${trade.logIndex}`;
      if (cursor.seenTradeIds.has(tradeKey)) {
        continue;
      }

      cursor.seenTradeIds.add(tradeKey);
      const payload = buildBridgePayload(trade);
      const signalProjection = await projectSignal(payload);
      if (signalProjection.shouldEmit) {
        state.counters.signalsProjected += 1;
      }

      let relayResult = { skipped: true, reason: "Trade stayed below live relay threshold." };
      if (formatUsd6(trade.amount) >= state.config.minWhaleUsd || signalProjection.shouldEmit) {
        try {
          relayResult = await relayTrade(payload);
        } catch (error) {
          const normalized = normalizeRelayError(error);
          if (!normalized.duplicate) {
            state.counters.relayFailures += 1;
          }
          relayResult = { skipped: true, reason: normalized.message };
        }
      }

      const enrichedTrade = hydrateTradeForDashboard(
        {
          ...trade,
          anomalyLabels: payload.anomalyLabels,
          riskScoreBps: payload.riskScoreBps,
        },
        relayResult.txHash || null,
        {
          ...signalProjection,
          matchedLabels: decodeAnomalyFlags(signalProjection.matchedFlags || 0).map((item) => item.label),
          relayStatus: relayResult.skipped ? relayResult.reason : "Relayed to Somnia testnet",
        }
      );

      state.trades = [enrichedTrade, ...state.trades].slice(0, 50);
      updateAnalytics(enrichedTrade);
      updateMarketSummary(trade.marketSlug, (current) => ({
        ...current,
        trackedVolumeUsd: current.trackedVolumeUsd + enrichedTrade.amountUsd,
        suspiciousTrades:
          current.suspiciousTrades +
          (payload.anomalyFlags !== 0 || signalProjection.shouldEmit || enrichedTrade.relayTxHash ? 1 : 0),
        relayedTrades: current.relayedTrades + (enrichedTrade.relayTxHash ? 1 : 0),
        lastTradeAt: enrichedTrade.observedAt,
        lastAnomalies: payload.anomalyLabels,
        latestThesis: signalProjection.thesis || current.latestThesis,
      }));
      processedTrades.push({
        ...trade,
        oddsBps: payload.oddsBps,
        anomalyFlags: payload.anomalyFlags,
        riskScoreBps: payload.riskScoreBps,
      });
      if (processedTrades.length > 500) {
        processedTrades.shift();
      }

      if (payload.anomalyFlags !== 0 || signalProjection.shouldEmit || enrichedTrade.relayTxHash) {
        pushEvent("trade", {
          marketSlug: trade.marketSlug,
          market: trade.marketTitle,
          marketUrl: trade.marketUrl,
          trader: enrichedTrade.traderLabel,
          amountUsd: enrichedTrade.amountUsd,
          direction: enrichedTrade.directionLabel,
          anomalies: payload.anomalyLabels.join(", "),
          relayTxHash: enrichedTrade.relayTxHash,
        });
      }

      if ((index + 1) % PROGRESS_PERSIST_EVERY === 0) {
        state.status = "catching-up";
        state.lastProcessedBlock = Number(trade.blockNumber || latestBlock);
        persistState();
      }
    }

    cursor.lastProcessedBlock = latestBlock;
    state.lastProcessedBlock = Number(latestBlock);
    await pollAlphaSignals(cursor);
    state.status = "live";
    saveCursor(cursor);
    persistState();
  } finally {
    isPolling = false;
  }
}

function serveFile(response, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "Content-Type": contentType });
  response.end(fs.readFileSync(filePath));
}

function createHttpServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/state") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(state));
      return;
    }

    if (url.pathname === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      sseClients.add(response);
      request.on("close", () => sseClients.delete(response));
      return;
    }

    if (url.pathname === "/app.js") {
      serveFile(response, path.join(PUBLIC_DIR, "app.js"), "application/javascript; charset=utf-8");
      return;
    }

    if (url.pathname === "/styles.css") {
      serveFile(response, path.join(PUBLIC_DIR, "styles.css"), "text/css; charset=utf-8");
      return;
    }

    if (url.pathname === "/vendor/ethers.js") {
      serveFile(
        response,
        path.join(process.cwd(), "node_modules", "ethers", "dist", "ethers.umd.min.js"),
        "application/javascript; charset=utf-8"
      );
      return;
    }

    serveFile(response, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
  });
}

function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onListening = () => {
      cleanup();
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

async function startHttpServer() {
  const basePort = Number(state.config.dashboardPort || 3000);

  for (let offset = 0; offset <= PORT_SEARCH_LIMIT; offset += 1) {
    const candidatePort = basePort + offset;
    const server = createHttpServer();

    try {
      await listenOnPort(server, candidatePort);
      state.config.dashboardPort = candidatePort;
      httpServer = server;
      if (candidatePort !== basePort) {
        console.log(
          `Port ${basePort} is busy. Dashboard automatically moved to http://localhost:${candidatePort}`
        );
      } else {
        console.log(`Dashboard listening on http://localhost:${candidatePort}`);
      }
      return;
    } catch (error) {
      server.close();
      if (error.code === "EADDRINUSE" && PORT_AUTO_INCREMENT && offset < PORT_SEARCH_LIMIT) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Unable to bind dashboard port. Tried ports ${basePort}-${basePort + PORT_SEARCH_LIMIT}.`
  );
}

async function start() {
  ensureRuntimeDir();
  restoreSnapshotState();
  await startHttpServer();

  state.status = "initializing";
  persistState();

  if (!state.config.bridgeAddress) {
    pushEvent("warning", { message: "Bridge contract address missing. Relay writes will be skipped." });
  }
  if (!state.config.reactiveAddress) {
    pushEvent("warning", { message: "Reactive contract address missing. Dashboard will show local fallback analysis only." });
  }

  const cursor = loadCursor();
  await pollOnce(cursor);
  pollTimer = setInterval(() => {
    pollOnce(cursor).catch((error) => recordError(error));
  }, state.config.pollIntervalMs);
}

process.on("SIGINT", () => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  if (httpServer) {
    httpServer.close();
  }
  process.exit(0);
});

start().catch((error) => {
  recordError(error);
  console.error(error);
  process.exitCode = 1;
});
