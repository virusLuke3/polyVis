const metricsEl = document.getElementById("metrics");
const tradesEl = document.getElementById("trades");
const eventsEl = document.getElementById("events");
const marketQuestionEl = document.getElementById("market-question");
const marketMetaEl = document.getElementById("market-meta");
const systemStatusEl = document.getElementById("system-status");
const statusDotEl = document.getElementById("status-dot");

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function renderMetrics(state) {
  const analytics = state.analytics || {};
  const counters = state.counters || {};

  const cards = [
    ["Tracked volume", formatUsd(analytics.totalVolumeUsd)],
    ["YES flow", formatUsd(analytics.yesVolumeUsd)],
    ["NO flow", formatUsd(analytics.noVolumeUsd)],
    ["Projected signals", formatCompact(counters.signalsProjected)],
    ["Trades relayed", formatCompact(counters.tradesRelayed)],
    ["Conviction score", `${analytics.convictionScore || 0}%`],
  ];

  metricsEl.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric-card">
          <p class="label">${label}</p>
          <h3>${value}</h3>
        </article>
      `
    )
    .join("");
}

function renderTrades(state) {
  const trades = state.trades || [];

  tradesEl.innerHTML = trades.length
    ? trades
        .map(
          (trade) => `
            <article class="trade-card">
              <div class="row">
                <strong>${trade.directionLabel}</strong>
                <span class="pill">${trade.side}</span>
                <span class="muted">${trade.traderLabel}</span>
              </div>
              <div class="row">
                <h4>${formatUsd(trade.amountUsd)}</h4>
                <span class="muted">Block ${trade.blockNumber}</span>
              </div>
              <p>${trade.signalProjection?.thesis || "No signal thesis available."}</p>
              <p class="muted">${trade.signalProjection?.relayStatus || "Relay pending"}</p>
            </article>
          `
        )
        .join("")
    : '<p class="empty">Waiting for matching trades...</p>';
}

function renderEvents(state) {
  const events = state.events || [];

  eventsEl.innerHTML = events.length
    ? events
        .map(
          (event) => `
            <article class="event-card">
              <div class="row">
                <strong>${event.type}</strong>
                <span class="muted">${new Date(event.timestamp).toLocaleTimeString()}</span>
              </div>
              <p>${JSON.stringify(event.payload)}</p>
            </article>
          `
        )
        .join("")
    : '<p class="empty">No events yet.</p>';
}

function renderState(state) {
  const market = state.market || {};
  marketQuestionEl.textContent = market.question || "Waiting for Polymarket market metadata";
  marketMetaEl.textContent = `${market.slug || ""} | Liquidity ${formatUsd(market.liquidity)} | Volume ${formatUsd(market.volume)}`;
  systemStatusEl.textContent = state.status || "unknown";
  statusDotEl.dataset.status = state.status || "unknown";

  renderMetrics(state);
  renderTrades(state);
  renderEvents(state);
}

async function boot() {
  const response = await fetch("/api/state");
  const initialState = await response.json();
  renderState(initialState);

  const source = new EventSource("/events");
  source.addEventListener("state", (event) => renderState(JSON.parse(event.data)));
}

boot().catch((error) => {
  systemStatusEl.textContent = `error: ${error.message}`;
});
