require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http: httpTransport,
  parseAbi,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const USDC_DECIMALS = 6;
const RUNTIME_DIR = path.resolve(process.env.POLYSIGNAL_RUNTIME_DIR || "./data/runtime");
const CURSOR_PATH = path.join(RUNTIME_DIR, "cursor.json");
const SNAPSHOT_PATH = path.join(RUNTIME_DIR, "dashboard-state.json");
const PUBLIC_DIR = path.resolve("./public");

const polymarketOrderFilledAbi = parseAbi([
  "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)",
]);

const tradeBridgeAbi = parseAbi([
  "function logTrade((bytes32 sourceTradeId, bytes32 marketId, address trader, uint256 amount, uint8 direction, uint64 accountAgeDays, uint32 oddsBps, uint256 totalPositionUsd, string marketTitle) tradeInput) returns (uint64 sequence)",
]);

const reactiveAbi = parseAbi([
  "function previewSignal(uint256 amount, uint64 accountAgeDays, uint32 oddsBps, uint256 totalPositionUsd, uint8 direction) view returns (bool shouldEmit, uint8 analysisCode, string thesis)",
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
  transport: httpTransport(),
});

const somniaPublicClient = createPublicClient({
  chain: somniaTestnet,
  transport: httpTransport(),
});

const privateKey = process.env.PRIVATE_KEY;
const account = privateKey ? privateKeyToAccount(privateKey) : null;
const somniaWalletClient = account
  ? createWalletClient({
      account,
      chain: somniaTestnet,
      transport: httpTransport(),
    })
  : null;

const state = {
  startedAt: new Date().toISOString(),
  status: "booting",
  config: {
    slug: process.env.POLYMARKET_MARKET_SLUG || "trump-presidential-election",
    minWhaleUsd: Number(process.env.POLYSIGNAL_MIN_WHALE_USDC || "25000"),
    pollIntervalMs: Number(process.env.POLYSIGNAL_POLL_INTERVAL_MS || "12000"),
    dashboardPort: Number(process.env.PORT || "3000"),
    bridgeAddress: process.env.POLYMARKET_TRADE_BRIDGE_ADDRESS || process.env.MOCK_POLYMARKET_ADDRESS || "",
    reactiveAddress: process.env.POLYSIGNAL_REACTIVE_ADDRESS || "",
  },
  market: null,
  latestBlock: null,
  lastProcessedBlock: null,
  counters: {
    tradesSeen: 0,
    tradesRelayed: 0,
    signalsProjected: 0,
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
  events: [],
  errors: [],
};

const sseClients = new Set();
let pollTimer = null;
let marketContext = null;
let isPolling = false;

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

async function fetchMarketBySlug(slug) {
  const response = await fetch(`${GAMMA_API_BASE}/markets?slug=${encodeURIComponent(slug)}`);
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

  return allowlist.includes(trader.toLowerCase()) ? 1 : 45;
}

function computeTraderPositionUsd(trade) {
  return trade.amount;
}

function buildBridgePayload(trade) {
  const oddsBps = trade.direction === 0 ? marketContext.outcomePrices.yesBps : marketContext.outcomePrices.noBps;
  return {
    sourceTradeId: trade.sourceTradeId,
    marketId: marketContext.market.conditionId,
    trader: trade.trader,
    amount: trade.amount,
    direction: trade.direction,
    accountAgeDays: mockAccountAgeDays(trade.trader),
    oddsBps,
    totalPositionUsd: computeTraderPositionUsd(trade),
    marketTitle: marketContext.market.question || marketContext.market.slug || "Unknown market",
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
  const direction = tokenId === marketContext.tokenIds.yesTokenId ? 0 : 1;

  return {
    sourceTradeId: decoded.args.orderHash,
    txHash: log.transactionHash,
    trader,
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
    txHash: trade.txHash,
    relayTxHash,
    trader: trade.trader,
    traderLabel: shortAddress(trade.trader),
    amountUsd,
    shares: trade.shares.toString(),
    side: trade.side,
    direction: trade.direction,
    directionLabel: trade.directionLabel,
    blockNumber: trade.blockNumber,
    logIndex: trade.logIndex,
    exchange: trade.exchange,
    observedAt: new Date().toISOString(),
    signalProjection,
  };
}

async function projectSignal(payload) {
  const reactiveAddress = state.config.reactiveAddress;
  if (!reactiveAddress) {
    return {
      shouldEmit: false,
      analysisCode: 0,
      thesis: "Reactive contract address not configured.",
    };
  }

  try {
    const [shouldEmit, analysisCode, thesis] = await somniaPublicClient.readContract({
      address: getAddress(reactiveAddress),
      abi: reactiveAbi,
      functionName: "previewSignal",
      args: [
        payload.amount,
        payload.accountAgeDays,
        payload.oddsBps,
        payload.totalPositionUsd,
        payload.direction,
      ],
    });

    return {
      shouldEmit,
      analysisCode: Number(analysisCode),
      thesis,
    };
  } catch (error) {
    return {
      shouldEmit: false,
      analysisCode: 0,
      thesis: `Signal preview unavailable: ${error.message}`,
    };
  }
}

async function relayTrade(payload) {
  if (!somniaWalletClient || !account) {
    return { skipped: true, reason: "Missing PRIVATE_KEY for relay." };
  }
  if (!state.config.bridgeAddress) {
    return { skipped: true, reason: "Missing bridge contract address." };
  }

  const txHash = await somniaWalletClient.writeContract({
    address: getAddress(state.config.bridgeAddress),
    abi: tradeBridgeAbi,
    functionName: "logTrade",
    args: [payload],
    account,
    chain: somniaTestnet,
  });

  state.counters.tradesRelayed += 1;
  return { skipped: false, txHash };
}

function loadCursor() {
  const cursor = readJsonIfExists(CURSOR_PATH);
  return {
    lastProcessedBlock: cursor?.lastProcessedBlock ? BigInt(cursor.lastProcessedBlock) : null,
    seenTradeIds: new Set(Array.isArray(cursor?.seenTradeIds) ? cursor.seenTradeIds : []),
  };
}

function saveCursor(cursor) {
  writeJson(CURSOR_PATH, {
    lastProcessedBlock: cursor.lastProcessedBlock ? cursor.lastProcessedBlock.toString() : null,
    seenTradeIds: [...cursor.seenTradeIds].slice(-1000),
  });
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

  const [binaryLogs, negRiskLogs] = await Promise.all([
    polygonClient.getLogs({
      address: CTF_EXCHANGE_ADDRESS,
      event: eventDefinition,
      fromBlock,
      toBlock,
    }),
    polygonClient.getLogs({
      address: NEG_RISK_EXCHANGE_ADDRESS,
      event: eventDefinition,
      fromBlock,
      toBlock,
    }),
  ]);

  return [...binaryLogs, ...negRiskLogs];
}

async function initializeMarketContext() {
  const market = await fetchMarketBySlug(state.config.slug);
  marketContext = {
    market,
    tokenIds: extractTokenIds(market),
    outcomePrices: extractOutcomePrices(market),
  };

  state.market = {
    slug: market.slug,
    question: market.question,
    conditionId: market.conditionId,
    volume: Number(market.volume || 0),
    liquidity: Number(market.liquidity || 0),
    outcomePrices: marketContext.outcomePrices,
  };
}

async function ensureMarketContext() {
  if (marketContext) {
    return true;
  }

  try {
    await initializeMarketContext();
    pushEvent("market", {
      slug: state.market.slug,
      question: state.market.question,
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
    const hasMarketContext = await ensureMarketContext();
    if (!hasMarketContext) {
      persistState();
      return;
    }

    const latestBlock = await polygonClient.getBlockNumber();
    state.latestBlock = Number(latestBlock);

    const configuredBackfill = BigInt(process.env.POLYSIGNAL_START_BLOCKS_BACK || "250");
    const fromBlock = cursor.lastProcessedBlock
      ? cursor.lastProcessedBlock + 1n
      : latestBlock > configuredBackfill
        ? latestBlock - configuredBackfill
        : 0n;

    if (fromBlock > latestBlock) {
      state.status = "live";
      persistState();
      return;
    }

    const logs = await getLogsForRange(fromBlock, latestBlock);
    const trackedTokenIds = new Set([
      marketContext.tokenIds.yesTokenId.toString(),
      marketContext.tokenIds.noTokenId.toString(),
    ]);

    const trades = logs
      .map(decodePolymarketTrade)
      .filter((trade) => trackedTokenIds.has(trade.tokenId))
      .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber - b.blockNumber));

    for (const trade of trades) {
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

      let relayResult = { skipped: true, reason: "Trade below whale threshold." };
      if (formatUsd6(trade.amount) >= state.config.minWhaleUsd) {
        try {
          relayResult = await relayTrade(payload);
        } catch (error) {
          state.counters.relayFailures += 1;
          relayResult = { skipped: true, reason: error.message };
        }
      }

      const enrichedTrade = hydrateTradeForDashboard(
        trade,
        relayResult.txHash || null,
        {
          ...signalProjection,
          relayStatus: relayResult.skipped ? relayResult.reason : "Relayed to Somnia testnet",
        }
      );

      state.trades = [enrichedTrade, ...state.trades].slice(0, 50);
      updateAnalytics(enrichedTrade);

      pushEvent("trade", {
        market: state.market.question,
        trader: enrichedTrade.traderLabel,
        amountUsd: enrichedTrade.amountUsd,
        direction: enrichedTrade.directionLabel,
        relayTxHash: enrichedTrade.relayTxHash,
      });
    }

    cursor.lastProcessedBlock = latestBlock;
    state.lastProcessedBlock = Number(latestBlock);
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

function startHttpServer() {
  const server = http.createServer((request, response) => {
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

    serveFile(response, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
  });

  server.listen(state.config.dashboardPort, () => {
    console.log(`Dashboard listening on http://localhost:${state.config.dashboardPort}`);
  });
}

async function start() {
  ensureRuntimeDir();
  startHttpServer();

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
  process.exit(0);
});

start().catch((error) => {
  recordError(error);
  console.error(error);
  process.exitCode = 1;
});
