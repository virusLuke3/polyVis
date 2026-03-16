const metricsEl = document.getElementById("metrics");
const tradesEl = document.getElementById("trades");
const eventsEl = document.getElementById("events");
const alphaSignalsEl = document.getElementById("alpha-signals");
const marketMetaEl = document.getElementById("market-meta");
const marketActionsEl = document.getElementById("market-actions");
const marketDirectoryEl = document.getElementById("market-directory");
const marketSearchEl = document.getElementById("market-search");
const marketDirectorySummaryEl = document.getElementById("market-directory-summary");
const marketPaginationEl = document.getElementById("market-pagination");
const reactivityCopyEl = document.getElementById("reactivity-copy");
const reactivityStepsEl = document.getElementById("reactivity-steps");
const reactivityProofGridEl = document.getElementById("reactivity-proof-grid");
const connectWalletButtonEl = document.getElementById("connect-wallet");
const premiumStatusEl = document.getElementById("premium-status");
const systemStatusEl = document.getElementById("system-status");
const statusDotEl = document.getElementById("status-dot");
const tickerStatusEl = document.getElementById("ticker-status");
const tickerMarketEl = document.getElementById("ticker-market");
const tickerAlphaEl = document.getElementById("ticker-alpha");
const tickerVolumeEl = document.getElementById("ticker-volume");
const heroThesisEl = document.getElementById("hero-thesis");
const alphaHeaderChipEl = document.getElementById("alpha-header-chip");

let currentState = null;
let selectedMarketSlug = null;
let marketSearchQuery = "";
let marketPage = 1;
const MARKET_COLUMNS = 4;
const MARKET_ROWS = 5;
const MARKETS_PER_PAGE = MARKET_COLUMNS * MARKET_ROWS;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ACCESS_PASS_ABI = [
  "function hasAccess(address user) view returns (bool)",
  "function accessExpiresAt(address user) view returns (uint64)",
  "function priceWei() view returns (uint256)",
  "function purchaseAccess() payable",
];
const VERIFIED_ONCHAIN_ALPHA_SAMPLE = {
  id: "verified-somnia-reactivity-sample",
  marketSlug: "will-the-iranian-regime-fall-by-june-30",
  marketTitle: "Will the Iranian regime fall by June 30?",
  marketUrl: "https://polymarket.com/event/will-the-iranian-regime-fall-by-june-30",
  trader: "",
  traderLabel: "Verified Sample",
  amountUsd: 0,
  directionLabel: "ALPHA",
  analysisCode: 1,
  anomalyLabels: [
    "New Wallet Whale",
    "High Conviction Entry",
    "Rapid Accumulation",
    "Same-side Streak",
    "Counterparty Concentration",
    "Market Impact Spike",
    "Smart-money Follow-through",
  ],
  riskScoreBps: 9600,
  oddsBps: 0,
  totalPositionUsd: 0,
  thesis:
    "Verified Somnia callback sample: TradeBridged was observed on Somnia, the reactive contract executed on-chain, and AlphaSignal was emitted with analysisCode=1 and risk=96.0%. Confirmed on Somnia testnet via native reactive callback.",
  txHash: "0xd165df2aca4dbb4d79067b8fd60768538b40aba7d9f74b3e2bf50a82664016b9",
  relayTxHash: "0xad9be37480d4ab4229aa5121627d3c8c3210d247dd1f6f0d3426747d1adcf7c0",
  sourceTradeId: "verified-bridge-sample",
  observedAt: "verified",
  isVerifiedSample: true,
};
const walletState = {
  address: null,
  displayAddress: "NOT CONNECTED",
  hasAccess: false,
  expiresAt: 0,
  priceWei: 0n,
  chainId: null,
  busy: false,
  error: "",
};

function getEthers() {
  return window.ethers || null;
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number(value || 0) >= 1000 ? 0 : 2,
  }).format(Number(value || 0));
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatPercentFromBps(value) {
  return `${(Number(value || 0) / 100).toFixed(1)}%`;
}

function shortHash(value) {
  if (!value) {
    return "n/a";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function explorerLink(hashOrAddress) {
  if (!hashOrAddress) {
    return "#";
  }

  return `https://shannon-explorer.somnia.network/search?q=${hashOrAddress}`;
}

function formatStt(value) {
  const ethers = getEthers();
  try {
    if (ethers && value !== undefined && value !== null) {
      const formatted = ethers.formatEther(value);
      const numeric = Number(formatted);
      return Number.isFinite(numeric) ? numeric.toFixed(numeric >= 1 ? 2 : 4) : formatted;
    }
  } catch {}

  try {
    const amount = BigInt(value || 0);
    return `${Number(amount) / 1e18}`;
  } catch {
    return "0";
  }
}

function shortAddress(value) {
  if (!value) {
    return "NOT CONNECTED";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function isZeroAddress(value) {
  return !value || value.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}

function hasPremiumAccess() {
  return walletState.hasAccess;
}

function accessPassConfigured(state) {
  return Boolean(state?.config?.accessPassAddress) && !isZeroAddress(state.config.accessPassAddress);
}

function formatExpiry(timestampSeconds) {
  if (!timestampSeconds) {
    return "inactive";
  }

  return new Date(Number(timestampSeconds) * 1000).toLocaleString();
}

function getSomniaChainParams(state) {
  const chainId = Number(state?.config?.somniaChainId || 50312);
  const chainIdHex = `0x${chainId.toString(16)}`;
  return {
    chainId,
    chainIdHex,
    chainName: "Somnia Testnet",
    nativeCurrency: {
      name: "STT",
      symbol: "STT",
      decimals: 18,
    },
    rpcUrls: [state?.config?.somniaRpcUrl || "https://dream-rpc.somnia.network"],
    blockExplorerUrls: ["https://shannon-explorer.somnia.network"],
  };
}

async function ensureSomniaWalletNetwork(state) {
  if (!window.ethereum) {
    throw new Error("No injected wallet found.");
  }

  const params = getSomniaChainParams(state);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: params.chainIdHex }],
    });
  } catch (error) {
    if (error?.code !== 4902) {
      throw error;
    }

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [params],
    });
  }
}

async function refreshWalletAccess(state) {
  if (!window.ethereum || !walletState.address || !accessPassConfigured(state)) {
    walletState.hasAccess = false;
    walletState.expiresAt = 0;
    walletState.error = "";
    return;
  }

  const ethers = getEthers();
  if (!ethers) {
    walletState.error = "ethers not loaded";
    return;
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  const contract = new ethers.Contract(state.config.accessPassAddress, ACCESS_PASS_ABI, provider);
  const [hasAccess, expiresAt, priceWei] = await Promise.all([
    contract.hasAccess(walletState.address),
    contract.accessExpiresAt(walletState.address),
    contract.priceWei(),
  ]);

  walletState.hasAccess = Boolean(hasAccess);
  walletState.expiresAt = Number(expiresAt);
  walletState.priceWei = BigInt(priceWei);
  walletState.error = "";
}

async function connectWallet() {
  if (!currentState) {
    return;
  }

  if (!window.ethereum) {
    walletState.error = "Install MetaMask or another injected wallet.";
    renderState(currentState);
    return;
  }

  const ethers = getEthers();
  if (!ethers) {
    walletState.error = "ethers browser runtime failed to load.";
    renderState(currentState);
    return;
  }

  walletState.busy = true;
  renderState(currentState);

  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureSomniaWalletNetwork(currentState);
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const network = await provider.getNetwork();
    const address = await signer.getAddress();

    walletState.address = address;
    walletState.displayAddress = shortAddress(address);
    walletState.chainId = Number(network.chainId);
    await refreshWalletAccess(currentState);
  } catch (error) {
    walletState.error = error?.message || String(error);
  } finally {
    walletState.busy = false;
    renderState(currentState);
  }
}

async function unlockPremium() {
  if (!currentState) {
    return;
  }

  if (!walletState.address) {
    await connectWallet();
    if (!walletState.address) {
      return;
    }
  }

  if (!accessPassConfigured(currentState)) {
    walletState.error = "Access pass contract is not deployed yet.";
    renderState(currentState);
    return;
  }

  const ethers = getEthers();
  if (!ethers || !window.ethereum) {
    walletState.error = "Wallet runtime unavailable.";
    renderState(currentState);
    return;
  }

  walletState.busy = true;
  renderState(currentState);

  try {
    await ensureSomniaWalletNetwork(currentState);
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(currentState.config.accessPassAddress, ACCESS_PASS_ABI, signer);
    const priceWei =
      walletState.priceWei && walletState.priceWei > 0n
        ? walletState.priceWei
        : BigInt(currentState.config.premiumPriceWei || "0");

    const tx = await contract.purchaseAccess({ value: priceWei });
    await tx.wait();
    await refreshWalletAccess(currentState);
  } catch (error) {
    walletState.error = error?.message || String(error);
  } finally {
    walletState.busy = false;
    renderState(currentState);
  }
}

function renderWalletUi(state) {
  if (!connectWalletButtonEl || !premiumStatusEl) {
    return;
  }

  if (!accessPassConfigured(state)) {
    premiumStatusEl.textContent = "ACCESS PASS PENDING";
  } else if (walletState.hasAccess) {
    premiumStatusEl.textContent = `PREMIUM ACTIVE · ${walletState.displayAddress}`;
  } else if (walletState.address) {
    premiumStatusEl.textContent = `PREMIUM LOCKED · ${walletState.displayAddress}`;
  } else {
    premiumStatusEl.textContent = "PREMIUM LOCKED";
  }

  connectWalletButtonEl.textContent = walletState.busy
    ? "PROCESSING..."
    : walletState.address
      ? walletState.displayAddress
      : "CONNECT WALLET";
  connectWalletButtonEl.disabled = walletState.busy;
  connectWalletButtonEl.classList.toggle("is-connected", Boolean(walletState.address));
}

function normalizeMarkets(state) {
  if (Array.isArray(state.markets) && state.markets.length > 0) {
    return state.markets;
  }

  if (state.market) {
    return [state.market];
  }

  return [];
}

function pickSelectedMarket(state) {
  const markets = normalizeMarkets(state);
  if (!markets.length) {
    selectedMarketSlug = null;
    return null;
  }

  const preferredSlug = selectedMarketSlug || state.activeMarketSlug || markets[0].slug;
  const selected = markets.find((market) => market.slug === preferredSlug) || markets[0];
  selectedMarketSlug = selected.slug;
  return selected;
}

function filterByMarket(items, marketSlug) {
  if (!marketSlug) {
    return items || [];
  }

  return (items || []).filter((item) => item.marketSlug === marketSlug);
}

function toneForMarket(market) {
  if ((market.alphaSignals || 0) > 0) {
    return "danger";
  }
  if ((market.suspiciousTrades || 0) > 0 || (market.relayedTrades || 0) > 0) {
    return "suspicious";
  }
  return "healthy";
}

function renderMarketDirectory(state, selectedMarket) {
  const markets = normalizeMarkets(state);
  const query = marketSearchQuery.trim().toLowerCase();
  const filteredMarkets = query
    ? markets.filter((market) => {
        const haystack = `${market.slug || ""} ${market.question || ""}`.toLowerCase();
        return haystack.includes(query);
      })
    : markets;
  const totalPages = Math.max(1, Math.ceil(filteredMarkets.length / MARKETS_PER_PAGE));
  if (marketPage > totalPages) {
    marketPage = totalPages;
  }
  if (marketPage < 1) {
    marketPage = 1;
  }
  const pageStart = (marketPage - 1) * MARKETS_PER_PAGE;
  const visibleMarkets = filteredMarkets.slice(pageStart, pageStart + MARKETS_PER_PAGE);

  marketDirectorySummaryEl.textContent = query
    ? `page ${marketPage}/${totalPages} · ${filteredMarkets.length} match(es) across ${markets.length} tracked active markets`
    : `page ${marketPage}/${totalPages} · showing ${visibleMarkets.length} of ${markets.length} tracked active markets`;

  marketDirectoryEl.innerHTML = visibleMarkets.length
    ? visibleMarkets
        .map((market) => {
          const tone = toneForMarket(market);
          const latestAnomalies = (market.lastAnomalies || [])
            .slice(0, 3)
            .map((label) => `<span class="signal-chip">${label}</span>`)
            .join("");
          const thesisCopy = hasPremiumAccess()
            ? market.latestThesis || "No suspicious output yet for this market."
            : "Unlock Premium to read the detailed on-chain explanation for this market.";

          return `
            <article class="market-card ${selectedMarket?.slug === market.slug ? "is-active" : ""}">
              <div class="market-card-header">
                <div>
                  <p class="micro-label">Tracked Market</p>
                  <h4 class="market-name">${market.question || market.slug}</h4>
                </div>
                <span class="market-badge ${tone}">${tone}</span>
              </div>

              <div class="market-stats">
                <div class="market-stat">
                  <span class="market-stat-value">${formatCompact(market.suspiciousTrades || 0)}</span>
                  <span class="market-stat-label">Suspicious</span>
                </div>
                <div class="market-stat">
                  <span class="market-stat-value">${formatCompact(market.alphaSignals || 0)}</span>
                  <span class="market-stat-label">Alpha</span>
                </div>
                <div class="market-stat">
                  <span class="market-stat-value">${formatUsd(market.trackedVolumeUsd || 0)}</span>
                  <span class="market-stat-label">Tracked</span>
                </div>
              </div>

              <div class="market-card-chips">
                ${latestAnomalies || '<span class="signal-chip signal-chip-muted">Awaiting anomalies</span>'}
              </div>

              <p class="market-card-copy">${thesisCopy}</p>

              <div class="market-card-actions">
                <button class="terminal-button terminal-button-orange market-select-button" data-market-select="${market.slug}">
                  Open Dashboard
                </button>
                <a class="terminal-button terminal-button-ghost market-link-button" href="${market.polymarketUrl || "#"}" target="_blank" rel="noreferrer">
                  Market Link
                </a>
              </div>
            </article>
          `;
        })
        .join("")
    : '<p class="empty-state">No active markets match this search yet.</p>';

  marketPaginationEl.innerHTML = `
    <button class="terminal-button terminal-button-ghost pagination-button" data-market-page="prev" ${marketPage <= 1 ? "disabled" : ""}>
      Previous
    </button>
    <span class="pagination-status">Page ${marketPage} / ${totalPages}</span>
    <button class="terminal-button terminal-button-orange pagination-button" data-market-page="next" ${marketPage >= totalPages ? "disabled" : ""}>
      Next
    </button>
  `;
}

function renderMetrics(state, selectedMarket) {
  const analytics = state.analytics || {};

  const cards = [
    {
      label: "Market tracked",
      value: formatUsd(selectedMarket?.trackedVolumeUsd || 0),
      tone: "green",
    },
    {
      label: "Suspicious prints",
      value: formatCompact(selectedMarket?.suspiciousTrades || 0),
      tone: "orange",
    },
    {
      label: "Relayed trades",
      value: formatCompact(selectedMarket?.relayedTrades || 0),
      tone: "blue",
    },
    {
      label: "On-chain alpha",
      value: formatCompact(selectedMarket?.alphaSignals || 0),
      tone: "green",
    },
    {
      label: "Market liquidity",
      value: formatUsd(selectedMarket?.liquidity || 0),
      tone: "muted",
    },
    {
      label: "Global conviction",
      value: `${analytics.convictionScore || 0}%`,
      tone: "orange",
    },
  ];

  metricsEl.innerHTML = cards
    .map(
      (card) => `
        <article class="metric-panel metric-${card.tone}">
          <p class="micro-label">${card.label}</p>
          <strong>${card.value}</strong>
        </article>
      `
    )
    .join("");
}

function renderReactivityEvidence(state, selectedMarket) {
  const latestSignal =
    filterByMarket(state.alphaSignals, selectedMarket?.slug)[0] ||
    state.alphaSignals?.[0] ||
    VERIFIED_ONCHAIN_ALPHA_SAMPLE;
  const latestRelayedTrade =
    filterByMarket(state.trades, selectedMarket?.slug).find((trade) => trade.relayTxHash) ||
    (state.trades || []).find((trade) => trade.relayTxHash);
  const bridgeAddress = state.config?.bridgeAddress || "";
  const reactiveAddress = state.config?.reactiveAddress || "";
  const steps = [
    {
      title: "1. Polygon Trade",
      body: "We ingest live Polymarket OrderFilled events from Polygon and normalize suspicious fills.",
      meta: latestRelayedTrade?.txHash ? `source tx ${shortHash(latestRelayedTrade.txHash)}` : "watching live OrderFilled logs",
    },
    {
      title: "2. Relay To Somnia",
      body: "The relayer writes the suspicious trade into PolymarketTradeBridge on Somnia as TradeBridged.",
      meta: bridgeAddress ? shortHash(bridgeAddress) : "bridge pending",
      href: bridgeAddress ? explorerLink(bridgeAddress) : "",
    },
    {
      title: "3. Native Subscription",
      body: "Somnia subscription watches the bridge event. No cron job or backend loop decides the trigger.",
      meta: "subscription armed against TradeBridged",
    },
    {
      title: "4. Reactive Callback",
      body: "Somnia calls PolySignalReactive.onEvent(...), where the 8 anomaly rules are evaluated on-chain.",
      meta: reactiveAddress ? shortHash(reactiveAddress) : "handler pending",
      href: reactiveAddress ? explorerLink(reactiveAddress) : "",
    },
    {
      title: "5. AlphaSignal Output",
      body: "If the on-chain thresholds are met, the reactive contract emits AlphaSignal and the UI only listens to that result.",
      meta: latestSignal?.txHash
        ? `${latestSignal.isVerifiedSample ? "verified sample" : "latest alpha"} ${shortHash(latestSignal.txHash)}`
        : "waiting for next on-chain alpha",
      href: latestSignal?.txHash ? explorerLink(latestSignal.txHash) : "",
    },
  ];

  reactivityStepsEl.innerHTML = steps
    .map(
      (step) => `
        <article class="reactivity-step">
          <p class="micro-label">${step.title}</p>
          <p class="reactivity-step-copy">${step.body}</p>
          ${
            step.href
              ? `<a class="reactivity-step-meta" href="${step.href}" target="_blank" rel="noreferrer">${step.meta}</a>`
              : `<span class="reactivity-step-meta">${step.meta}</span>`
          }
        </article>
      `
    )
    .join("");

  const proofCards = [
    {
      label: "Bridge Contract",
      value: bridgeAddress ? shortHash(bridgeAddress) : "n/a",
      href: bridgeAddress ? explorerLink(bridgeAddress) : "",
    },
    {
      label: "Reactive Contract",
      value: reactiveAddress ? shortHash(reactiveAddress) : "n/a",
      href: reactiveAddress ? explorerLink(reactiveAddress) : "",
    },
    {
      label: "Relayed Trades",
      value: formatCompact(state.counters?.tradesRelayed || 0),
    },
    {
      label: "Projected Alphas",
      value: formatCompact(state.counters?.signalsProjected || 0),
    },
    {
      label: "Observed AlphaSignal",
      value:
        (state.counters?.signalsObserved || 0) > 0
          ? formatCompact(state.counters?.signalsObserved || 0)
          : "1 verified sample",
    },
    {
      label: "Proof Of Reactivity",
      value:
        (state.counters?.signalsObserved || 0) > 0
          ? "on-chain callback confirmed"
          : latestSignal?.isVerifiedSample
            ? "verified callback sample loaded"
            : (state.counters?.tradesRelayed || 0) > 0
            ? "relay -> subscription path live"
            : "awaiting first trigger",
    },
  ];

  reactivityProofGridEl.innerHTML = proofCards
    .map(
      (card) => `
        <article class="reactivity-proof-card">
          <p class="micro-label">${card.label}</p>
          ${
            card.href
              ? `<a class="reactivity-proof-value" href="${card.href}" target="_blank" rel="noreferrer">${card.value}</a>`
              : `<strong class="reactivity-proof-value">${card.value}</strong>`
          }
        </article>
      `
    )
    .join("");

  reactivityCopyEl.textContent = latestSignal
    ? latestSignal.isVerifiedSample
      ? `Verified proof: we already triggered Somnia on-chain reactivity end-to-end. This sample links the bridge relay transaction to the Somnia callback transaction that emitted AlphaSignal for ${latestSignal.marketTitle}. Confirmed on Somnia testnet via native reactive callback.`
      : `Live proof: a Polymarket trade was relayed into Somnia, the reactive contract emitted AlphaSignal on-chain, and this dashboard is reading that Somnia output for ${latestSignal.marketTitle}.`
    : latestRelayedTrade
      ? `Live proof: suspicious Polymarket flow is already being relayed into Somnia. The next step is the native Somnia subscription invoking the reactive contract callback when thresholds clear.`
      : "The relayer only forwards Polymarket flow into Somnia. The trigger decision is made after the bridge event by Somnia's native reactive callback, not by a cron job or backend loop.";
}

function renderTrades(state, selectedMarket) {
  const marketTrades = filterByMarket(state.trades, selectedMarket?.slug).filter(
    (trade) =>
      (trade.signalProjection && trade.signalProjection.shouldEmit) ||
      (trade.anomalyLabels && trade.anomalyLabels.length > 0) ||
      trade.relayTxHash
  );
  const trades = marketTrades.length
    ? marketTrades
    : (state.trades || []).filter(
        (trade) =>
          (trade.signalProjection && trade.signalProjection.shouldEmit) ||
          (trade.anomalyLabels && trade.anomalyLabels.length > 0) ||
          trade.relayTxHash
      );

  tradesEl.innerHTML = trades.length
    ? trades
        .map(
          (trade) => `
            <article class="trade-row">
              <div class="trade-row-top">
                <span class="direction-tag">${trade.directionLabel}</span>
                <span class="trade-side">${trade.side}</span>
                <a class="trade-wallet" href="${explorerLink(trade.trader)}" target="_blank" rel="noreferrer">${trade.traderLabel}</a>
              </div>
              <div class="trade-row-main">
                <strong>${formatUsd(trade.amountUsd)}</strong>
                <span>Block ${trade.blockNumber}</span>
              </div>
              <div class="trade-chip-row">
                ${(trade.anomalyLabels || [])
                  .map((label) => `<span class="signal-chip">${label}</span>`)
                  .join("")}
              </div>
              <p class="trade-thesis">${
                hasPremiumAccess()
                  ? trade.signalProjection?.thesis || "Signal preview pending."
                  : "Unlock Premium to read the detailed reactive explanation for this suspicious flow."
              }</p>
              <div class="trade-links">
                <a href="${trade.marketUrl || "#"}" target="_blank" rel="noreferrer">Polymarket</a>
                <a href="${explorerLink(trade.txHash)}" target="_blank" rel="noreferrer">Polygon Tx</a>
                ${
                  trade.relayTxHash
                    ? `<a href="${explorerLink(trade.relayTxHash)}" target="_blank" rel="noreferrer">Somnia Relay</a>`
                    : ""
                }
              </div>
            </article>
          `
        )
        .join("")
    : '<p class="empty-state">No suspicious fills yet for this market. Falling back to the global suspicious tape once new relay candidates land.</p>';
}

function renderAlphaSignals(state, selectedMarket) {
  const marketAlphaSignals = filterByMarket(state.alphaSignals, selectedMarket?.slug);
  const globalAlphaSignals = state.alphaSignals || [];
  const alphaSignals = marketAlphaSignals.length
    ? marketAlphaSignals
    : globalAlphaSignals.length
      ? globalAlphaSignals
      : [VERIFIED_ONCHAIN_ALPHA_SAMPLE];

  alphaHeaderChipEl.textContent = hasPremiumAccess()
    ? `${alphaSignals.length} signals`
    : "premium required";

  if (!hasPremiumAccess()) {
    const priceWei =
      walletState.priceWei && walletState.priceWei > 0n
        ? walletState.priceWei
        : BigInt(currentState?.config?.premiumPriceWei || "0");
    const priceLabel = `${formatStt(priceWei)} STT`;
    const accessMessage = !accessPassConfigured(state)
      ? "Premium contract address is not configured yet. Deploy PolySignalAccessPass on Somnia to enable paid unlocks."
      : walletState.address
        ? `Pay ${priceLabel} on Somnia to unlock live Alpha Feed and detailed trade explanations.`
        : "Connect a wallet on Somnia testnet to unlock live Alpha Feed and detailed trade explanations.";

    alphaSignalsEl.innerHTML = `
      <article class="alpha-card premium-lock-card">
        <div class="alpha-card-top">
          <div>
            <p class="micro-label">Premium Gate</p>
            <h4>Unlock Live Alpha Feed</h4>
          </div>
          <span class="direction-badge">${priceLabel}</span>
        </div>

        <p class="alpha-copy premium-lock-copy">${accessMessage}</p>

        <div class="trade-chip-row">
          <span class="signal-chip">Wallet Connect</span>
          <span class="signal-chip">Somnia Payment</span>
          <span class="signal-chip">Feed Access</span>
        </div>

        <div class="premium-actions">
          <button class="terminal-button terminal-button-orange premium-action-button" data-premium-action="unlock" ${
            walletState.busy || !accessPassConfigured(state) ? "disabled" : ""
          }>
            ${
              !accessPassConfigured(state)
                ? "ACCESS PASS NOT DEPLOYED"
                : walletState.address
                  ? "UNLOCK PREMIUM"
                  : "CONNECT + UNLOCK"
            }
          </button>
          ${
            walletState.address
              ? `<span class="premium-status-line">${
                  walletState.hasAccess
                    ? `Access active until ${formatExpiry(walletState.expiresAt)}`
                    : `No active pass · ${walletState.displayAddress}`
                }</span>`
              : '<span class="premium-status-line">No wallet connected yet.</span>'
          }
          ${
            VERIFIED_ONCHAIN_ALPHA_SAMPLE
              ? `<div class="verified-sample-banner">
                  <strong>Confirmed on Somnia testnet via native reactive callback.</strong>
                  <span>Sample market: ${VERIFIED_ONCHAIN_ALPHA_SAMPLE.marketTitle}</span>
                  <a href="${explorerLink(VERIFIED_ONCHAIN_ALPHA_SAMPLE.txHash)}" target="_blank" rel="noreferrer">
                    Somnia callback ${shortHash(VERIFIED_ONCHAIN_ALPHA_SAMPLE.txHash)}
                  </a>
                  <a href="${explorerLink(VERIFIED_ONCHAIN_ALPHA_SAMPLE.relayTxHash)}" target="_blank" rel="noreferrer">
                    Bridge relay ${shortHash(VERIFIED_ONCHAIN_ALPHA_SAMPLE.relayTxHash)}
                  </a>
                </div>`
              : ""
          }
        </div>
      </article>
    `;
    return;
  }

  alphaSignalsEl.innerHTML = alphaSignals.length
    ? alphaSignals
        .map(
          (signal) => `
            <article class="alpha-card">
              <div class="alpha-card-top">
                <div>
                  <p class="micro-label">${signal.isVerifiedSample ? "Verified On-chain Sample" : "Alpha Advisory"}</p>
                  <h4>${signal.marketTitle}</h4>
                </div>
                <span class="direction-badge">${signal.directionLabel}</span>
              </div>

              <div class="alpha-stat-grid">
                <div>
                  <span class="micro-label">Odds</span>
                  <strong>${signal.oddsBps ? formatPercentFromBps(signal.oddsBps) : "verified"}</strong>
                </div>
                <div>
                  <span class="micro-label">Position</span>
                  <strong>${signal.totalPositionUsd ? formatUsd(signal.totalPositionUsd) : "on-chain proof"}</strong>
                </div>
                <div>
                  <span class="micro-label">Risk</span>
                  <strong>${formatPercentFromBps(signal.riskScoreBps)}</strong>
                </div>
              </div>

              <div class="signal-sparkline">
                <span></span><span></span><span></span><span></span><span></span><span></span>
              </div>

              <p class="alpha-copy">${signal.thesis || "Reactive contract generated a high-conviction anomaly alert."}</p>

              <div class="trade-chip-row">
                ${(signal.anomalyLabels || [])
                  .map((label) => `<span class="signal-chip">${label}</span>`)
                  .join("")}
              </div>

              <div class="alpha-card-footer">
                <div>
                  <span class="micro-label">${signal.isVerifiedSample ? "Somnia callback" : "Tracked wallet"}</span>
                  ${
                    signal.isVerifiedSample
                      ? `<a href="${explorerLink(signal.txHash)}" target="_blank" rel="noreferrer">${shortHash(signal.txHash || "")}</a>`
                      : `<a href="${explorerLink(signal.trader)}" target="_blank" rel="noreferrer">${signal.traderLabel}</a>`
                  }
                </div>
                <div>
                  <span class="micro-label">Market link</span>
                  <a href="${signal.marketUrl || "#"}" target="_blank" rel="noreferrer">${signal.marketUrl ? "Polymarket" : "Unavailable"}</a>
                </div>
                <div>
                  <span class="micro-label">${signal.isVerifiedSample ? "Bridge tx" : "Signal tx"}</span>
                  <a href="${explorerLink(signal.isVerifiedSample ? signal.relayTxHash : signal.txHash)}" target="_blank" rel="noreferrer">${shortHash(signal.isVerifiedSample ? signal.relayTxHash || "" : signal.txHash || "")}</a>
                </div>
              </div>
            </article>
          `
        )
        .join("")
    : '<p class="empty-state">Waiting for Somnia AlphaSignal callbacks...</p>';
}

function renderEvents(state, selectedMarket) {
  const events = (state.events || []).filter((event) => {
    if (!selectedMarket?.slug) {
      return true;
    }

    return !event.payload?.marketSlug || event.payload.marketSlug === selectedMarket.slug;
  });

  eventsEl.innerHTML = events.length
    ? events
        .map(
          (event) => `
            <article class="event-row">
              <div class="event-row-top">
                <strong>${event.type}</strong>
                <span>${new Date(event.timestamp).toLocaleTimeString()}</span>
              </div>
              <p>${JSON.stringify(event.payload)}</p>
            </article>
          `
        )
        .join("")
    : '<p class="empty-state">No pipeline events yet for this market.</p>';
}

function renderHero(state, selectedMarket) {
  const analytics = state.analytics || {};
  const latestSignal =
    filterByMarket(state.alphaSignals, selectedMarket?.slug)[0] ||
    state.alphaSignals?.[0] ||
    VERIFIED_ONCHAIN_ALPHA_SAMPLE;
  const latestTrade = filterByMarket(state.trades, selectedMarket?.slug).find(
    (trade) => (trade.anomalyLabels || []).length > 0 || trade.relayTxHash
  );

  marketMetaEl.textContent = selectedMarket
    ? `${selectedMarket.question} | liquidity ${formatUsd(selectedMarket.liquidity)} | volume ${formatUsd(selectedMarket.volume)} | suspicious ${selectedMarket.suspiciousTrades || 0} | alpha ${selectedMarket.alphaSignals || 0}`
    : "Connecting to Polygon, Gamma, and the Somnia reactivity pipeline.";

  marketActionsEl.innerHTML = selectedMarket
    ? `
        <a class="terminal-button terminal-button-ghost" href="${selectedMarket.polymarketUrl || "#"}" target="_blank" rel="noreferrer">Open on Polymarket</a>
        <button class="terminal-button terminal-button-orange" data-market-select="${selectedMarket.slug}">Focus ${selectedMarket.slug.toUpperCase()}</button>
      `
    : "";

  systemStatusEl.textContent = state.status || "unknown";
  statusDotEl.dataset.status = state.status || "unknown";

  tickerStatusEl.textContent = `STATUS ${String(state.status || "unknown").toUpperCase()}`;
  tickerMarketEl.textContent = `MARKET ${(selectedMarket?.slug || "loading").toUpperCase()}`;
  tickerAlphaEl.textContent = `ALPHA COUNT ${formatCompact(selectedMarket?.alphaSignals || 0)}`;
  tickerVolumeEl.textContent = `TRACKED VOLUME ${formatUsd(selectedMarket?.trackedVolumeUsd || analytics.totalVolumeUsd)}`;

  heroThesisEl.textContent = !hasPremiumAccess()
    ? [
        "$ premium gate active",
        `wallet="${walletState.displayAddress}"`,
        `access="${walletState.hasAccess ? "active" : "locked"}"`,
        "// unlock premium to read live alpha thesis",
      ].join("\n")
    : latestSignal
    ? [
        "$ reactive alpha event",
        `market="${latestSignal.marketTitle}"`,
        `wallet="${latestSignal.traderLabel}"`,
        `risk=${formatPercentFromBps(latestSignal.riskScoreBps)}`,
        `thesis="${latestSignal.thesis || "Reactive anomaly alert"}"`,
      ].join("\n")
    : latestTrade
      ? [
          "$ suspicious flow monitored",
          `market="${latestTrade.marketTitle || selectedMarket?.question || "unknown"}"`,
          `wallet="${latestTrade.traderLabel}"`,
          `anomalies="${(latestTrade.anomalyLabels || []).join(", ") || "none"}"`,
          `relay="${latestTrade.relayTxHash ? "submitted" : "held local"}"`,
        ].join("\n")
      : [
          "$ waiting for suspicious flow",
          `status="${state.status || "booting"}"`,
          `slug="${selectedMarket?.slug || "loading"}"`,
          "// Somnia handler is armed",
        ].join("\n");
}

function renderState(state) {
  currentState = state;
  const selectedMarket = pickSelectedMarket(state);
  renderWalletUi(state);
  renderHero(state, selectedMarket);
  renderReactivityEvidence(state, selectedMarket);
  renderMarketDirectory(state, selectedMarket);
  renderMetrics(state, selectedMarket);
  renderAlphaSignals(state, selectedMarket);
  renderTrades(state, selectedMarket);
  renderEvents(state, selectedMarket);
}

document.addEventListener("click", (event) => {
  const premiumButton = event.target.closest("[data-premium-action]");
  if (premiumButton) {
    void unlockPremium();
    return;
  }

  const button = event.target.closest("[data-market-select]");
  if (button) {
    selectedMarketSlug = button.getAttribute("data-market-select");
    if (currentState) {
      renderState(currentState);
    }
    return;
  }

  const paginationButton = event.target.closest("[data-market-page]");
  if (paginationButton) {
    const direction = paginationButton.getAttribute("data-market-page");
    if (direction === "prev") {
      marketPage -= 1;
    }
    if (direction === "next") {
      marketPage += 1;
    }
    if (currentState) {
      renderState(currentState);
    }
  }
});

connectWalletButtonEl?.addEventListener("click", () => {
  void connectWallet();
});

marketSearchEl?.addEventListener("input", (event) => {
  marketSearchQuery = event.target.value || "";
  marketPage = 1;
  if (currentState) {
    renderState(currentState);
  }
});

async function boot() {
  const response = await fetch("/api/state");
  const initialState = await response.json();

  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (Array.isArray(accounts) && accounts[0]) {
      walletState.address = accounts[0];
      walletState.displayAddress = shortAddress(accounts[0]);
      try {
        await refreshWalletAccess(initialState);
      } catch (error) {
        walletState.error = error?.message || String(error);
      }
    }

    window.ethereum.on?.("accountsChanged", async (accountsChanged) => {
      walletState.address = accountsChanged?.[0] || null;
      walletState.displayAddress = shortAddress(walletState.address);
      walletState.hasAccess = false;
      walletState.expiresAt = 0;
      if (walletState.address && currentState) {
        try {
          await refreshWalletAccess(currentState);
        } catch (error) {
          walletState.error = error?.message || String(error);
        }
      }
      if (currentState) {
        renderState(currentState);
      }
    });

    window.ethereum.on?.("chainChanged", () => {
      if (currentState) {
        void refreshWalletAccess(currentState)
          .catch((error) => {
            walletState.error = error?.message || String(error);
          })
          .finally(() => renderState(currentState));
      }
    });
  }

  renderState(initialState);

  const source = new EventSource("/events");
  source.addEventListener("state", async (event) => {
    const nextState = JSON.parse(event.data);
    if (walletState.address) {
      try {
        await refreshWalletAccess(nextState);
      } catch (error) {
        walletState.error = error?.message || String(error);
      }
    }
    renderState(nextState);
  });
}

boot().catch((error) => {
  systemStatusEl.textContent = `error: ${error.message}`;
});
