const ANOMALY_FLAGS = {
  NEW_WALLET_WHALE: 1 << 0,
  HIGH_CONVICTION_ENTRY: 1 << 1,
  RAPID_ACCUMULATION: 1 << 2,
  SAME_SIDE_STREAK: 1 << 3,
  COUNTERPARTY_CONCENTRATION: 1 << 4,
  MARKET_IMPACT_SPIKE: 1 << 5,
  WASH_CLUSTER: 1 << 6,
  SMART_MONEY_FOLLOWTHROUGH: 1 << 7,
};

const ANOMALY_LABELS = {
  [ANOMALY_FLAGS.NEW_WALLET_WHALE]: "New Wallet Whale",
  [ANOMALY_FLAGS.HIGH_CONVICTION_ENTRY]: "High Conviction Entry",
  [ANOMALY_FLAGS.RAPID_ACCUMULATION]: "Rapid Accumulation",
  [ANOMALY_FLAGS.SAME_SIDE_STREAK]: "Same-side Streak",
  [ANOMALY_FLAGS.COUNTERPARTY_CONCENTRATION]: "Counterparty Concentration",
  [ANOMALY_FLAGS.MARKET_IMPACT_SPIKE]: "Market Impact Spike",
  [ANOMALY_FLAGS.WASH_CLUSTER]: "Wash Cluster",
  [ANOMALY_FLAGS.SMART_MONEY_FOLLOWTHROUGH]: "Smart-money Follow-through",
};

function clampBps(value) {
  return Math.max(0, Math.min(10_000, Math.round(Number(value || 0))));
}

function getSmartMoneyAllowlist() {
  return new Set(
    (process.env.POLYSIGNAL_SMART_MONEY_ADDRESSES || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function countBits(mask) {
  let value = Number(mask || 0);
  let count = 0;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}

function decodeAnomalyFlags(mask) {
  return Object.entries(ANOMALY_FLAGS)
    .filter(([, bit]) => (Number(mask || 0) & bit) !== 0)
    .map(([, bit]) => ({
      bit,
      label: ANOMALY_LABELS[bit],
    }));
}

function computeAnomalyProfile({
  trade,
  market,
  recentTrades = [],
  traderHistory = [],
  accountAgeDays,
}) {
  const amount = BigInt(trade.amount);
  const totalPositionUsd = traderHistory.reduce((sum, item) => sum + BigInt(item.amount || 0n), amount);
  const amountUsd = Number(amount) / 1e6;
  const liquidityUsd = Number(market?.liquidity || 0);

  const traderLower = String(trade.trader).toLowerCase();
  const sameTraderTrades = traderHistory.filter((item) => String(item.trader).toLowerCase() === traderLower);
  const recentTradeCount = Math.min(65535, sameTraderTrades.length + 1);

  const recentSorted = [...sameTraderTrades, trade].sort((a, b) => {
    if (a.blockNumber === b.blockNumber) {
      return (a.logIndex || 0) - (b.logIndex || 0);
    }
    return (a.blockNumber || 0) - (b.blockNumber || 0);
  });

  let sameSideStreak = 0;
  for (let i = recentSorted.length - 1; i >= 0; i -= 1) {
    if (Number(recentSorted[i].direction) !== Number(trade.direction)) {
      break;
    }
    sameSideStreak += 1;
  }

  const counterpartyCounts = new Map();
  for (const item of sameTraderTrades) {
    const cp = String(item.counterparty || "").toLowerCase();
    if (!cp) {
      continue;
    }
    counterpartyCounts.set(cp, (counterpartyCounts.get(cp) || 0) + 1);
  }
  if (trade.counterparty) {
    const cp = String(trade.counterparty).toLowerCase();
    counterpartyCounts.set(cp, (counterpartyCounts.get(cp) || 0) + 1);
  }
  const maxCounterpartyCount = Math.max(0, ...counterpartyCounts.values());
  const counterpartyConcentrationBps =
    recentTradeCount >= 3 ? clampBps((maxCounterpartyCount / recentTradeCount) * 10_000) : 0;

  const marketImpactBps = liquidityUsd > 0 ? clampBps((amountUsd / liquidityUsd) * 10_000) : 0;

  const repeatedSizeCount = sameTraderTrades.filter(
    (item) => BigInt(item.amount || 0n) === amount && Number(item.direction) === Number(trade.direction)
  ).length;
  const washClusterScoreBps = clampBps(
    repeatedSizeCount * 1200 + (counterpartyConcentrationBps >= 6500 ? 2200 : 0) + (recentTradeCount >= 3 ? 1600 : 0)
  );

  const smartMoneyScoreBps = (() => {
    const allowlist = getSmartMoneyAllowlist();
    if (allowlist.has(traderLower)) {
      return 10_000;
    }

    return clampBps(
      (Number(totalPositionUsd) / 1e6 / 100_000) * 10_000 +
        (sameSideStreak >= 3 ? 1500 : 0) +
        (Number(trade.oddsBps || 0) >= 6500 ? 1000 : 0)
    );
  })();

  let anomalyFlags = 0;

  if (accountAgeDays <= 30 && amount >= 1_000_000_000n) {
    anomalyFlags |= ANOMALY_FLAGS.NEW_WALLET_WHALE;
  }
  if (Number(trade.oddsBps || 0) >= 5500 && amount >= 500_000_000n) {
    anomalyFlags |= ANOMALY_FLAGS.HIGH_CONVICTION_ENTRY;
  }
  if (recentTradeCount >= 2 && totalPositionUsd >= 2_000_000_000n) {
    anomalyFlags |= ANOMALY_FLAGS.RAPID_ACCUMULATION;
  }
  if (sameSideStreak >= 2) {
    anomalyFlags |= ANOMALY_FLAGS.SAME_SIDE_STREAK;
  }
  if (recentTradeCount >= 2 && counterpartyConcentrationBps >= 5000) {
    anomalyFlags |= ANOMALY_FLAGS.COUNTERPARTY_CONCENTRATION;
  }
  if (marketImpactBps >= 100) {
    anomalyFlags |= ANOMALY_FLAGS.MARKET_IMPACT_SPIKE;
  }
  if (washClusterScoreBps >= 3000) {
    anomalyFlags |= ANOMALY_FLAGS.WASH_CLUSTER;
  }
  if (smartMoneyScoreBps >= 5000) {
    anomalyFlags |= ANOMALY_FLAGS.SMART_MONEY_FOLLOWTHROUGH;
  }

  const riskScoreBps = clampBps(
    countBits(anomalyFlags) * 1100 +
      (marketImpactBps >= 450 ? 900 : 0) +
      (smartMoneyScoreBps >= 7000 ? 1300 : 0) +
      (Number(trade.oddsBps || 0) >= 6500 ? 800 : 0) +
      (accountAgeDays <= 2 ? 1000 : 0)
  );

  return {
    totalPositionUsd,
    anomalyFlags,
    riskScoreBps,
    recentTradeCount,
    sameSideStreak,
    counterpartyConcentrationBps,
    marketImpactBps,
    washClusterScoreBps,
    smartMoneyScoreBps,
    labels: decodeAnomalyFlags(anomalyFlags).map((item) => item.label),
  };
}

module.exports = {
  ANOMALY_FLAGS,
  ANOMALY_LABELS,
  clampBps,
  countBits,
  computeAnomalyProfile,
  decodeAnomalyFlags,
};
