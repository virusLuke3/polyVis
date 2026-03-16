const FLAG_NEW_WALLET_WHALE = 1 << 0;
const FLAG_HIGH_CONVICTION_ENTRY = 1 << 1;
const FLAG_RAPID_ACCUMULATION = 1 << 2;
const FLAG_SAME_SIDE_STREAK = 1 << 3;
const FLAG_COUNTERPARTY_CONCENTRATION = 1 << 4;
const FLAG_MARKET_IMPACT_SPIKE = 1 << 5;
const FLAG_WASH_CLUSTER = 1 << 6;
const FLAG_SMART_MONEY_FOLLOWTHROUGH = 1 << 7;

function deriveRiskScore(matchedFlags) {
  let score = 0;

  if (matchedFlags & FLAG_NEW_WALLET_WHALE) score += 2200;
  if (matchedFlags & FLAG_HIGH_CONVICTION_ENTRY) score += 1200;
  if (matchedFlags & FLAG_RAPID_ACCUMULATION) score += 1300;
  if (matchedFlags & FLAG_SAME_SIDE_STREAK) score += 900;
  if (matchedFlags & FLAG_COUNTERPARTY_CONCENTRATION) score += 1200;
  if (matchedFlags & FLAG_MARKET_IMPACT_SPIKE) score += 1300;
  if (matchedFlags & FLAG_WASH_CLUSTER) score += 1600;
  if (matchedFlags & FLAG_SMART_MONEY_FOLLOWTHROUGH) score += 1500;

  return Math.min(score, 10_000);
}

function pickPrimarySignal(matchedFlags) {
  if (matchedFlags & FLAG_NEW_WALLET_WHALE) return 1;
  if (matchedFlags & FLAG_SMART_MONEY_FOLLOWTHROUGH) return 8;
  if (matchedFlags & FLAG_WASH_CLUSTER) return 7;
  if (matchedFlags & FLAG_MARKET_IMPACT_SPIKE) return 6;
  if (matchedFlags & FLAG_COUNTERPARTY_CONCENTRATION) return 5;
  if (matchedFlags & FLAG_RAPID_ACCUMULATION) return 3;
  if (matchedFlags & FLAG_SAME_SIDE_STREAK) return 4;
  if (matchedFlags & FLAG_HIGH_CONVICTION_ENTRY) return 2;
  return 0;
}

function analysisLabel(analysisCode) {
  switch (analysisCode) {
    case 1:
      return "New wallet whale detected: fresh address entered with whale-sized conviction.";
    case 2:
      return "High conviction entry: size and odds cleared the on-chain confidence threshold.";
    case 3:
      return "Rapid accumulation: repeated flow built a meaningful position very quickly.";
    case 4:
      return "Same-side streak: the wallet kept pressing one direction across multiple fills.";
    case 5:
      return "Counterparty concentration: execution clustered around a narrow liquidity relationship.";
    case 6:
      return "Market impact spike: the fill pattern suggests meaningful local price impact.";
    case 7:
      return "Wash-cluster risk: address behavior resembles circular or coordinated flow.";
    case 8:
      return "Smart-money follow-through: the wallet aligns with a smart-money style footprint.";
    default:
      return "";
  }
}

function bpsToPercent(value) {
  return `${(Number(value || 0) / 100).toFixed(1)}%`;
}

function buildNoSignalExplanation(payload, matchedFlags, finalRiskScoreBps) {
  if (matchedFlags !== 0) {
    return `Monitored only: anomaly traits were detected, but final risk ${bpsToPercent(finalRiskScoreBps)} stayed below the 30.0% alpha threshold.`;
  }

  return `No reactive trigger: size ${bpsToPercent(payload.oddsBps)} odds and wallet behavior stayed below whale, conviction, and concentration thresholds.`;
}

function evaluateReactiveSignal(payload) {
  let matchedFlags = 0;

  if (payload.amount >= 25_000e6 && payload.accountAgeDays <= 7) {
    matchedFlags |= FLAG_NEW_WALLET_WHALE;
  }
  if (payload.oddsBps >= 6_000 && payload.amount >= 12_500e6) {
    matchedFlags |= FLAG_HIGH_CONVICTION_ENTRY;
  }
  if (payload.recentTradeCount >= 3 && payload.totalPositionUsd >= 40_000e6) {
    matchedFlags |= FLAG_RAPID_ACCUMULATION;
  }
  if (payload.sameSideStreak >= 3) {
    matchedFlags |= FLAG_SAME_SIDE_STREAK;
  }
  if (payload.counterpartyConcentrationBps >= 6_500) {
    matchedFlags |= FLAG_COUNTERPARTY_CONCENTRATION;
  }
  if (payload.marketImpactBps >= 450) {
    matchedFlags |= FLAG_MARKET_IMPACT_SPIKE;
  }
  if (payload.washClusterScoreBps >= 6_000) {
    matchedFlags |= FLAG_WASH_CLUSTER;
  }
  if (payload.smartMoneyScoreBps >= 7_000) {
    matchedFlags |= FLAG_SMART_MONEY_FOLLOWTHROUGH;
  }

  const derivedRiskScoreBps = deriveRiskScore(matchedFlags);
  const finalRiskScoreBps = Math.max(payload.riskScoreBps || 0, derivedRiskScoreBps);
  const shouldEmit = matchedFlags !== 0 && finalRiskScoreBps >= 3_000;
  const analysisCode = shouldEmit ? pickPrimarySignal(matchedFlags) : 0;

  return {
    shouldEmit,
    analysisCode,
    matchedFlags,
    finalRiskScoreBps,
    thesis: shouldEmit
      ? analysisLabel(analysisCode)
      : buildNoSignalExplanation(payload, matchedFlags, finalRiskScoreBps),
  };
}

module.exports = {
  evaluateReactiveSignal,
};
