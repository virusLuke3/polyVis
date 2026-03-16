require("dotenv").config();

const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  parseAbi,
  parseUnits,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const USDC_DECIMALS = 6n;

const polymarketOrderFilledAbi = parseAbi([
  "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)",
]);

const tradeBridgeAbi = parseAbi([
  "function logTrade((bytes32 sourceTradeId, bytes32 marketId, address trader, uint256 amount, uint8 direction, uint64 accountAgeDays, uint32 oddsBps, uint256 totalPositionUsd, string marketTitle) tradeInput) returns (uint64 sequence)",
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

  return {
    orderHash: decoded.args.orderHash,
    trader: getAddress(bettor),
    tokenId: isBuy ? takerAssetId : makerAssetId,
    amount: isBuy ? makerAmountFilled : takerAmountFilled,
    shares: isBuy ? takerAmountFilled : makerAmountFilled,
    side: "BUY",
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
  };
}

async function findLatestLargeTrade(market, minWhaleUsd) {
  const latestBlock = await polygonClient.getBlockNumber();
  const blocksBack = BigInt(process.env.POLYSIGNAL_SCAN_BLOCKS || 15000);
  const fromBlock = latestBlock > blocksBack ? latestBlock - blocksBack : 0n;
  const minimumAmount = parseUnits(String(minWhaleUsd), Number(USDC_DECIMALS));

  const { yesTokenId, noTokenId } = extractTokenIds(market);
  const trackedTokenIds = new Set([yesTokenId.toString(), noTokenId.toString()]);

  const [binaryLogs, negRiskLogs] = await Promise.all([
    polygonClient.getLogs({
      address: CTF_EXCHANGE_ADDRESS,
      event: {
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
      },
      fromBlock,
      toBlock: latestBlock,
    }),
    polygonClient.getLogs({
      address: NEG_RISK_EXCHANGE_ADDRESS,
      event: {
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
      },
      fromBlock,
      toBlock: latestBlock,
    }),
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

function buildBridgePayload(market, trade) {
  const { yesBps, noBps } = extractOutcomePrices(market);
  const oddsBps = trade.direction === 0 ? yesBps : noBps;

  return {
    sourceTradeId: trade.txHash,
    marketId: market.conditionId,
    trader: trade.trader,
    amount: trade.amount,
    direction: trade.direction,
    accountAgeDays: mockAccountAgeDays(trade.trader),
    oddsBps,
    totalPositionUsd: trade.amount,
    marketTitle: market.question || market.slug || "Unknown market",
  };
}

async function main() {
  const privateKey = requireEnv("PRIVATE_KEY");
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: http(),
  });

  const tradeBridgeAddress =
    process.env.POLYMARKET_TRADE_BRIDGE_ADDRESS || requireEnv("MOCK_POLYMARKET_ADDRESS");
  const slug = process.env.POLYMARKET_MARKET_SLUG || "trump-presidential-election";
  const minWhaleUsd = Number(process.env.POLYSIGNAL_MIN_WHALE_USDC || "25000");

  const market = await fetchMarketBySlug(slug);
  const trade = await findLatestLargeTrade(market, minWhaleUsd);
  const payload = buildBridgePayload(market, trade);

  console.log("Selected market:", payload.marketTitle);
  console.log("Trade tx:", trade.txHash);
  console.log("Trader:", payload.trader);
  console.log("Direction:", payload.direction === 0 ? "YES" : "NO");
  console.log("Amount (USDC):", formatUsd6(payload.amount));
  console.log("Odds (bps):", payload.oddsBps);
  console.log("Mock account age (days):", payload.accountAgeDays);

  const txHash = await walletClient.writeContract({
    address: getAddress(tradeBridgeAddress),
    abi: tradeBridgeAbi,
    functionName: "logTrade",
    args: [payload],
    chain: somniaTestnet,
    account,
  });

  console.log("Relayed to Somnia tx:", txHash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
