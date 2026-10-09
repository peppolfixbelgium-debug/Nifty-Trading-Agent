import { useEffect, useMemo, useState } from "react";
import PremiumSelect from "./components/PremiumSelect";
import type { BacktestResponse, BacktestTrade } from "./lib/backtest-engine.js";
import type { OpportunityScanResponse } from "./lib/opportunity-types.js";
import type { MarketRegime, ScanAction, ScanResponse, ScanResult } from "./lib/types";

type Filter = "ALL" | "TRIGGERED" | "WATCH" | "AVOID";

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const fixed = (value: number | null, digits = 2) =>
  value === null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const pct = (value: number | null) =>
  value === null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const actionLabel: Record<ScanAction, string> = {
  TRIGGERED: "Triggered",
  WATCH: "Watch",
  AVOID: "Avoid",
  INSUFFICIENT_DATA: "Need data",
  ERROR: "Data error"
};
const actionOrder: Record<ScanAction, number> = {
  TRIGGERED: 0, WATCH: 1, AVOID: 2, INSUFFICIENT_DATA: 3, ERROR: 4
};
const regimeLabel: Record<MarketRegime, string> = {
  BULLISH: "Bullish", MIXED: "Mixed", BEARISH: "Bearish", UNAVAILABLE: "Unavailable"
};

function downloadCsv(rows: ScanResult[]) {
  const columns: Array<keyof ScanResult> = [
    "symbol", "name", "action", "reason", "lastPrice", "changePct", "sma20", "sma50",
    "sma200", "rsi14", "atr14", "relativeVolume", "trigger", "stop", "target",
    "riskReward", "quantity", "positionValueInr", "riskBudgetInr"
  ];
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `nifty-agent-scan-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function downloadBacktestCsv(trades: BacktestTrade[]) {
  const columns: Array<keyof BacktestTrade> = [
    "symbol", "name", "entryDate", "exitDate", "entryPrice", "exitPrice",
    "quantity", "grossPnlInr", "costsInr", "netPnlInr", "rMultiple", "holdingDays", "exitReason"
  ];
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const csv = [columns.join(","), ...trades.map((trade) => columns.map((column) => escape(trade[column])).join(","))].join("\r\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "nifty-backtest-trades-" + new Date().toISOString().slice(0, 10) + ".csv";
  anchor.click();
  URL.revokeObjectURL(href);
}

function ActionPill({ action }: { action: ScanAction }) {
  return <span className={`action-pill action-${action.toLowerCase().replaceAll("_", "-")}`}>{actionLabel[action]}</span>;
}

function App() {
  const [data, setData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [capital, setCapital] = useState("100000");
  const [risk, setRisk] = useState("1000");
  const [backtestYears, setBacktestYears] = useState("5");
  const [backtestCostBps, setBacktestCostBps] = useState("15");
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestData, setBacktestData] = useState<BacktestResponse | null>(null);
  const [opportunityData, setOpportunityData] = useState<OpportunityScanResponse | null>(null);
  const [opportunityLoading, setOpportunityLoading] = useState(false);
  const [opportunityError, setOpportunityError] = useState<string | null>(null);
  const [marketUniverse, setMarketUniverse] = useState("all");
  const [strategySelection, setStrategySelection] = useState("all");
  const [directionSelection, setDirectionSelection] = useState("both");
  const [scannerTimeframe, setScannerTimeframe] = useState("daily");
  const [minimumTradesForRanking, setMinimumTradesForRanking] = useState("30");
  const activeQualifiedSignalCount = useMemo(
    () => (opportunityData?.candidates ?? []).filter((candidate) => candidate.currentSignal).length,
    [opportunityData]
  );

  const recommendedCandidates = useMemo(
    () => (opportunityData?.candidates ?? [])
      .filter((candidate) =>
        candidate.currentSignal &&
        (candidate.validation.expectancyR ?? -Infinity) > 0 &&
        candidate.validation.profitFactor !== null &&
        candidate.validation.profitFactor >= 1
      )
      .slice(0, 5),
    [opportunityData]
  );

  const scannerReadiness = useMemo(() => {
    const blockers: string[] = [];
    const expectedStrategy = strategySelection as "all" | "trend-following" | "breakout-volume" | "trend-pullback" | "mean-reversion";
    const configMatches = !!opportunityData &&
      opportunityData.config.universe === marketUniverse &&
      opportunityData.config.strategy === expectedStrategy &&
      opportunityData.config.direction === directionSelection &&
      opportunityData.config.timeframe === scannerTimeframe &&
      opportunityData.config.minimumTradesForRanking === Math.max(30, Number(minimumTradesForRanking) || 30) &&
      opportunityData.config.years === (backtestYears === "3" ? 3 : 5) &&
      opportunityData.config.costBpsPerSide === Math.max(0, Math.min(200, Number(backtestCostBps) || 0)) &&
      opportunityData.config.capitalInr === Math.max(1, Number(capital) || 1) &&
      opportunityData.config.riskPerTradeInr === Math.min(Math.max(1, Number(risk) || 1), Math.max(1, Number(capital) || 1) * 0.01);
    if (!opportunityData) {
      blockers.push("Run the opportunity scan to verify historical coverage and evaluate the selected combinations.");
    } else {
      if (!configMatches) blockers.push("Settings changed after the last run; scan again to refresh the rankings.");
      if (opportunityData.coverage.status === "FAIL") {
        blockers.push("No instruments passed the full-window data-coverage gate. Ranking is blocked.");
      }
      if (opportunityData.qualifiedCombinations === 0) {
        blockers.push("No strategy/instrument/direction combination passed the sample-size and accounting gates.");
      }
    }
    return { ready: !!opportunityData && configMatches && opportunityData.coverage.status !== "FAIL" && opportunityData.qualifiedCombinations > 0, blockers };
  }, [opportunityData, marketUniverse, strategySelection, directionSelection, scannerTimeframe, minimumTradesForRanking, backtestYears, backtestCostBps, capital, risk]);

  async function scan(forceRefresh = false) {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ capital, risk });
      if (forceRefresh) query.set("refresh", "1");
      const response = await fetch(`/api/scan?${query.toString()}`, {
        headers: { accept: "application/json" }
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload
          ? String((payload as { error: unknown }).error)
          : "The scan request failed.";
        throw new Error(message);
      }
      setData(payload as ScanResponse);
    } catch (caught) {
      setError(caught instanceof Error
        ? `${caught.message} Ensure the app is running through Vercel Dev or deployed on Vercel.`
        : "Could not connect to the scanner.");
    } finally {
      setLoading(false);
    }
  }

  async function runOpportunityScan() {
    setOpportunityLoading(true);
    setOpportunityError(null);
    try {
      const query = new URLSearchParams({
        years: backtestYears === "3" ? "3" : "5",
        capital: String(Math.max(1, Number(capital) || 100000)),
        risk: String(Math.max(1, Number(risk) || 1000)),
        costBps: String(Math.max(0, Math.min(200, Number(backtestCostBps) || 0))),
        minTrades: String(Math.max(30, Math.min(500, Number(minimumTradesForRanking) || 30))),
        universe: marketUniverse,
        strategy: strategySelection,
        direction: directionSelection,
        timeframe: scannerTimeframe
      });
      const response = await fetch("/api/opportunities?" + query.toString(), {
        headers: { accept: "application/json" }
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const body = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
        throw new Error(typeof body.error === "string" ? body.error : "The opportunity scan failed.");
      }
      setOpportunityData(payload as OpportunityScanResponse);
    } catch (caught) {
      setOpportunityError(caught instanceof Error ? caught.message : "Could not connect to the opportunity scanner.");
    } finally {
      setOpportunityLoading(false);
    }
  }

  async function runBacktest() {
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const query = new URLSearchParams({
        years: backtestYears === "3" ? "3" : "5",
        capital,
        risk,
        costBps: String(backtestCostBps.trim() !== "" && Number.isFinite(Number(backtestCostBps)) ? Math.max(0, Math.min(200, Number(backtestCostBps))) : 15)
      });
      const response = await fetch("/api/backtest?" + query.toString(), {
        headers: { accept: "application/json" }
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const body = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
        const message = typeof body.error === "string" ? body.error : "The backtest request failed.";
        const detail = typeof body.detail === "string" ? body.detail : "";
        throw new Error(detail ? message + " " + detail : message);
      }
      setBacktestData(payload as BacktestResponse);
    } catch (caught) {
      setBacktestError(caught instanceof Error ? caught.message : "Could not connect to the backtest service.");
    } finally {
      setBacktestLoading(false);
    }
  }

  const backtestPlot = useMemo(() => {
    const curve = backtestData?.equityCurve ?? [];
    if (curve.length < 2 || !backtestData) return null;
    const stride = Math.max(1, Math.ceil(curve.length / 120));
    const sampled = curve.filter((_, index) => index === 0 || index === curve.length - 1 || index % stride === 0);
    const values = sampled.map((point) => point.equityInr).concat([backtestData.capitalInr]);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const span = Math.max(1, maximum - minimum);
    const line = sampled.map((point, index) => {
      const x = (index / Math.max(1, sampled.length - 1)) * 720;
      const y = 142 - ((point.equityInr - minimum) / span) * 124;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    const baselineY = 142 - ((backtestData.capitalInr - minimum) / span) * 124;
    return { line, minimum, maximum, baselineY };
  }, [backtestData]);

  const recentBacktestTrades = useMemo(
    () => backtestData ? [...backtestData.trades].slice(-15).reverse() : [],
    [backtestData]
  );

  useEffect(() => {
    void scan(false);
    // Load the first view once; manual refresh is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.results ?? [])
      .filter((row) => filter === "ALL" || row.action === filter)
      .filter((row) => !needle || row.symbol.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle))
      .sort((a, b) => actionOrder[a.action] - actionOrder[b.action] || (b.relativeVolume ?? -1) - (a.relativeVolume ?? -1));
  }, [data, filter, search]);

  const triggeredCount = data?.results.filter((row) => row.action === "TRIGGERED").length ?? 0;
  const watchCount = data?.results.filter((row) => row.action === "WATCH").length ?? 0;
  const errorCount = data?.results.filter((row) => row.action === "ERROR").length ?? 0;
  const riskCapHit = data !== null && data.params.effectiveRiskInr < data.params.requestedRiskInr;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Nifty Trading Agent home">
          <span className="brand-mark"><span></span><span></span><span></span></span>
          <span><strong>NIFTY</strong><small>TRADING AGENT</small></span>
        </a>
        <div className="topbar-right">
          <span className="live-dot"></span>
          <span>RULE-BASED SCANNER</span>
          <span className="topbar-divider"></span>
          <span className="topbar-muted">NSE · Daily timeframe</span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line"></span> MARKET INTELLIGENCE / 01</div>
          <h1>Trade the plan.<br /><em>Not the noise.</em></h1>
          <p>Scan trend, breakout, volume and risk conditions across a focused NSE universe. Every signal has a reason. Every setup has a defined risk.</p>
          <div className="hero-note"><span className="note-icon">↗</span><span>Signals are screening outputs, not orders or investment advice.</span></div>
        </div>
        <div className="hero-stamp" aria-hidden="true">
          <div className="stamp-ring"><span>RULES</span><b>01</b><span>OVER HUNCHES</span></div>
          <svg viewBox="0 0 180 58" role="presentation">
            <path d="M3 45 L27 38 L44 42 L61 20 L77 31 L99 9 L119 24 L139 14 L158 18 L177 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 45 L27 38 L44 42 L61 20 L77 31 L99 9 L119 24 L139 14 L158 18 L177 4 L177 58 L3 58 Z" fill="currentColor" opacity=".08"/>
          </svg>
        </div>
      </section>

      <section className="quick-start" aria-labelledby="quick-start-title">
        <div className="quick-start-heading">
          <div>
            <div className="section-kicker">START HERE / 30-SECOND GUIDE</div>
            <h2 id="quick-start-title">How to use this app</h2>
            <p>Use the watchlist for today’s screening context, and the opportunity scanner to compare fixed rules over history.</p>
          </div>
          <span className="quick-start-badge"><span></span> Research mode · no orders placed</span>
        </div>
        <div className="quick-start-steps">
          <article className="quick-start-step">
            <span className="step-index">01</span>
            <div><strong>Set your risk</strong><p>Enter total trading capital and your maximum planned loss for one trade. The sizing calculator caps requested risk at 1% of capital.</p></div>
          </article>
          <article className="quick-start-step">
            <span className="step-index">02</span>
            <div><strong>Scan today’s watchlist</strong><p>Tap <b>Scan market</b> and read each status plus its reason. “Avoid” means the current rules block a setup; it is not a prediction that the stock will fall.</p></div>
          </article>
          <article className="quick-start-step">
            <span className="step-index">03</span>
            <div><strong>Compare historical evidence</strong><p>Run Market Opportunity Scanner. Check data coverage, sample sizes, validation expectancy and drawdown. The separate shortlist only shows current setups that pass its stated rules.</p></div>
          </article>
        </div>
        <div className="quick-start-note"><span>Good to know</span> A blank shortlist is a valid outcome. Keep the 30-trade minimum, don’t force a winner, and treat results as research—not buy/sell instructions.</div>
      </section>

      <section className="market-strip" aria-label="Market overview">
        <div className="market-card">
          <div className="metric-label">NIFTY 50 <span className="tiny-tag">INDEX</span></div>
          <div className="metric-value">{data?.market.lastPrice === null || data?.market.lastPrice === undefined ? "—" : fixed(data.market.lastPrice)}</div>
          <div className={`metric-change ${(data?.market.changePct ?? 0) >= 0 ? "positive" : "negative"}`}>{pct(data?.market.changePct ?? null)} <span>last daily candle</span></div>
        </div>
        <div className="market-card">
          <div className="metric-label">MARKET REGIME</div>
          <div className="regime-line"><span className={`regime-dot regime-${(data?.market.regime ?? "UNAVAILABLE").toLowerCase()}`}></span><strong>{regimeLabel[data?.market.regime ?? "UNAVAILABLE"]}</strong></div>
          <div className="metric-foot">50 / 200-day trend filter</div>
        </div>
        <div className="market-card">
          <div className="metric-label">INDIA VIX <span className="tiny-tag">VOLATILITY</span></div>
          <div className="metric-value">{fixed(data?.market.vix ?? null)}</div>
          <div className="metric-foot"><span className={`vix-label vix-${(data?.market.vixLabel ?? "UNAVAILABLE").toLowerCase()}`}>{(data?.market.vixLabel ?? "UNAVAILABLE").replace("_", " ")}</span><span> · indicative context</span></div>
        </div>
        <div className="market-card market-card-last">
          <div className="metric-label">SETUPS TRIGGERED</div>
          <div className="metric-value">{data ? String(triggeredCount).padStart(2, "0") : "—"}<span className="metric-suffix"> / 25</span></div>
          <div className="metric-foot">{watchCount} to watch · {errorCount} data errors</div>
        </div>
      </section>

      <section className="control-panel">
        <div className="control-intro">
          <div className="section-kicker">YOUR RISK SETTINGS</div>
          <h2>Position calculator</h2>
          <p>These limits size a theoretical position; they never submit an order.</p>
        </div>
        <label className="field">
          <span>Trading capital <small>INR</small></span>
          <div className="input-wrap"><span>₹</span><input aria-label="Trading capital in rupees" type="number" min="1" max="100000000" step="10000" value={capital} onChange={(event) => setCapital(event.target.value)} /></div>
        </label>
        <label className="field">
          <span>Risk per trade <small>INR</small></span>
          <div className="input-wrap"><span>₹</span><input aria-label="Requested risk per trade in rupees" type="number" min="1" max="1000000" step="100" value={risk} onChange={(event) => setRisk(event.target.value)} /></div>
          <small className="field-hint">Auto-capped at 1% of capital</small>
        </label>
        <button className="scan-button" onClick={() => void scan(true)} disabled={loading || Number(capital) <= 0 || Number(risk) <= 0}>
          {loading ? <><span className="spinner"></span> Scanning…</> : <><span>↻</span> Scan market</>}
        </button>
      </section>

      {riskCapHit && <div className="inline-warning">Your requested risk exceeds 1% of capital. Position sizes use the capped risk of {inr0.format(data?.params.effectiveRiskInr ?? 0)}.</div>}
      {data?.warnings.map((warning) => <div className="inline-warning" key={warning}>{warning}</div>)}
      {error && <div className="error-banner"><strong>Scanner unavailable</strong><span>{error}</span><button onClick={() => void scan(true)}>Try again</button></div>}

      <section className="opportunity-section" aria-labelledby="opportunity-title">
        <div className="backtest-heading">
          <div>
            <div className="section-kicker">MARKET RESEARCH / OPPORTUNITY SCANNER</div>
            <h2 id="opportunity-title">Market Opportunity Scanner</h2>
            <p>Compare fixed daily strategy families using separate training, validation and final-test periods. The final-test results are deliberately not used to sort the leaderboard.</p>
          </div>
          <button className="scan-button" onClick={() => void runOpportunityScan()} disabled={opportunityLoading || Number(capital) <= 0 || Number(risk) <= 0}>
            {opportunityLoading ? <><span className="spinner"></span> Auditing &amp; ranking…</> : <><span>↗</span> Run opportunity scan</>}
          </button>
        </div>
        <div className="opportunity-controls">
          <label className="field">
            <span>Market universe</span>
            <PremiumSelect
              value={marketUniverse}
              onChange={setMarketUniverse}
              ariaLabel="Market universe"
              options={[
                { value: "all", label: "All supported instruments", hint: "Stocks + supported broad/sector indices" },
                { value: "stocks", label: "Current NSE stock universe", hint: "Registered stock list" },
                { value: "indices", label: "Broad / sector indices", hint: "Broad market + sector index price history" },
                { value: "futures", label: "Index futures", hint: "Expiry / roll data pending", disabled: true },
                { value: "options", label: "Options", hint: "Historical premium data pending", disabled: true }
              ]}
            />
          </label>
          <label className="field">
            <span>Strategy</span>
            <PremiumSelect
              value={strategySelection}
              onChange={setStrategySelection}
              ariaLabel="Strategy selection"
              options={[
                { value: "all", label: "All validated strategies", hint: "Compare all four fixed rule sets" },
                { value: "trend-following", label: "Trend following" },
                { value: "breakout-volume", label: "Breakout + volume" },
                { value: "trend-pullback", label: "Trend pullback" },
                { value: "mean-reversion", label: "Mean reversion" }
              ]}
            />
          </label>
          <label className="field">
            <span>Direction</span>
            <PremiumSelect
              value={directionSelection}
              onChange={setDirectionSelection}
              ariaLabel="Trade direction"
              options={[
                { value: "both", label: "Both long and short", hint: "Short results are theoretical" },
                { value: "long", label: "Long only" },
                { value: "short", label: "Short only", hint: "Not execution-ready" }
              ]}
            />
          </label>
          <label className="field">
            <span>Timeframe</span>
            <PremiumSelect
              value={scannerTimeframe}
              onChange={setScannerTimeframe}
              ariaLabel="Scanner timeframe"
              options={[
                { value: "daily", label: "Daily", hint: "Completed daily candles" },
                { value: "15m", label: "15 minutes", hint: "Data adapter pending", disabled: true },
                { value: "5m", label: "5 minutes", hint: "Data adapter pending", disabled: true }
              ]}
            />
          </label>
          <label className="field">
            <span>Minimum closed trades <small>FOR RANKING</small></span>
            <input className="backtest-number" type="number" min="30" max="500" step="5" value={minimumTradesForRanking} onChange={(event) => setMinimumTradesForRanking(String(Math.max(30, Math.min(500, Number(event.target.value) || 30))))} aria-label="Minimum completed trades for ranking" />
          </label>
        </div>
        <div className={`opportunity-readiness ${scannerReadiness.ready ? "opportunity-ready" : "opportunity-blocked"}`}>
          <div>
            <span className={`gate-state ${scannerReadiness.ready ? "gate-open" : "gate-blocked"}`}>{scannerReadiness.ready ? "RESEARCH CANDIDATES QUALIFIED" : "RANKING GATE ACTIVE"}</span>
            <h3>{scannerReadiness.ready ? "Qualified research candidates are available" : "Evidence gates are active"}</h3>
            <p>Defaults: all supported instruments · all validated strategies · both directions · daily · at least {Math.max(30, Number(minimumTradesForRanking) || 30)} training trades. Ranking uses validation expectancy; the final test is displayed separately and never used to sort.</p>
            {opportunityData && <p className="coverage-summary">Data coverage: {opportunityData.coverage.status} · {opportunityData.coverage.symbolsWithFullWindow}/{opportunityData.coverage.symbolsRequested} stocks have full-window history · {opportunityData.evaluatedCombinations} combinations evaluated · {opportunityData.qualifiedCombinations} passed all gates.</p>}
          </div>
          <div className="opportunity-blockers">
            <strong>{scannerReadiness.ready ? "Research cautions" : "Current blockers"}</strong>
            {scannerReadiness.blockers.length > 0
              ? <ul>{scannerReadiness.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              : <ul><li>Short results are hypothetical price-direction simulations, not execution-ready short trades.</li><li>Each candidate is an independent single-instrument simulation, not a combined portfolio.</li></ul>}
          </div>
        </div>
        {opportunityLoading && <div className="backtest-progress"><span className="spinner"></span> Fetching up to five years of daily history, checking data coverage and testing fixed rule sets…</div>}
        {opportunityError && <div className="error-banner"><strong>Opportunity scan unavailable</strong><span>{opportunityError}</span><button onClick={() => void runOpportunityScan()}>Try again</button></div>}
        {opportunityData && <>
          <div className="backtest-period-line">
            <span>REQUESTED PERIOD <strong>{opportunityData.coverage.requestedPeriod.startDate} → {opportunityData.coverage.requestedPeriod.endDate}</strong></span>
            <span>UNIVERSE <strong>{opportunityData.coverage.symbolsWithFullWindow} / {opportunityData.coverage.symbolsRequested} full history</strong></span>
            <span>VALIDATION SPLIT <strong>60% / 20% / 20%</strong></span>
          </div>
          {opportunityData.coverage.notes.map((note) => <div className="inline-warning" key={note}>{note}</div>)}
          {opportunityData.coverage.excludedSymbols.length > 0 && <details className="coverage-details">
            <summary>Excluded symbols / data issues ({opportunityData.coverage.excludedSymbols.length})</summary>
            <ul>{opportunityData.coverage.excludedSymbols.map((item) => <li key={item.symbol}><strong>{item.symbol}</strong>: {item.reason}</li>)}</ul>
          </details>}
          <section className="recommended-section" aria-labelledby="recommended-title">
            <div className="recommended-heading">
              <div>
                <div className="section-kicker">SHORTLIST / CURRENT SETUP + VALIDATION</div>
                <h3 id="recommended-title">Recommended setups to review</h3>
                <p>Separate from the full ranking. A candidate appears only with an active daily signal, positive validation expectancy and validation profit factor of at least 1.0. Candidates stay in validation-rank order; the final-test result is shown but does not decide which setups appear.</p>
              </div>
              <span className="recommended-count">{recommendedCandidates.length} / 5</span>
            </div>
            {recommendedCandidates.length > 0
              ? <div className="recommendation-grid">
                  {recommendedCandidates.map((candidate) => <article className="recommendation-card" key={candidate.symbol + candidate.strategy + candidate.direction}>
                    <div className="recommendation-card-top">
                      <span className="action-pill action-triggered">Passes shortlist rules</span>
                      <span className={`recommendation-direction ${candidate.direction === "LONG" ? "direction-long" : "direction-short"}`}>{candidate.direction}</span>
                    </div>
                    <h4>{candidate.symbol.replace(".NS", "")}</h4>
                    <p className="recommendation-company">{candidate.name}</p>
                    <p className="recommendation-strategy">{candidate.strategyName} · Signal {candidate.signalDate}</p>
                    <div className="recommendation-metrics">
                      <span><small>VALIDATION EXPECTANCY</small><strong className="positive">{fixed(candidate.validation.expectancyR, 3)}R</strong></span>
                      <span><small>VALIDATION PF</small><strong>{candidate.validation.profitFactor === null ? "N/A" : fixed(candidate.validation.profitFactor, 2)}</strong></span>
                    </div>
                    <div className="recommendation-levels">
                      <span>Reference close <b>{fixed(candidate.signalClose)}</b></span>
                      <span>Stop reference <b>{fixed(candidate.referenceStop)}</b></span>
                      <span>Target reference <b>{fixed(candidate.referenceTarget)}</b></span>
                    </div>
                    <div className="recommendation-test">Untouched test: {pct(candidate.finalTest.totalReturnPct)} · {candidate.finalTest.tradeCount} trades</div>
                    <p className="recommendation-disclaimer">{candidate.executionStatus === "SHORT_THEORETICAL_ONLY" ? "Short-side hypothesis only; not execution-ready." : "Research candidate only; not a buy recommendation."}</p>
                  </article>)}
                </div>
              : <div className="no-recommendations">
                  <span className="no-recommendations-mark">—</span>
                  <div>
                    <strong>{activeQualifiedSignalCount === 0 ? "No qualified candidate triggered today" : "Current signals did not pass every shortlist rule"}</strong>
                    <p>{activeQualifiedSignalCount === 0
                      ? `The ${opportunityData.qualifiedCombinations} qualified historical candidates did not produce an entry signal on the latest completed daily candle. That is why the shortlist is empty.`
                      : `${activeQualifiedSignalCount} qualified candidate(s) have a current signal, but none also passed positive validation expectancy and a measurable validation profit factor of at least 1.0.`} Keep the shortlist empty rather than forcing a pick.</p>
                  </div>
                </div>}
          </section>
          <div className="opportunity-results-heading">
            <div><strong>Ranked research candidates</strong><span>Sorted only by validation expectancy in R per trade. Final test is for confirmation, not ranking.</span></div>

          </div>
          <div className="opportunity-mobile-list" aria-label="Ranked research candidates for mobile">
            {opportunityData.candidates.map((candidate) => <article className="opportunity-mobile-card" key={`mobile-${candidate.symbol}-${candidate.strategy}-${candidate.direction}`}>
              <div className="opportunity-mobile-card-head">
                <span className="candidate-rank">#{candidate.rank}</span>
                <div className="opportunity-mobile-stock">
                  <strong>{candidate.symbol.replace(".NS", "")}</strong>
                  <small>{candidate.name}</small>
                </div>
                <span className={`recommendation-direction ${candidate.direction === "LONG" ? "direction-long" : "direction-short"}`}>{candidate.direction}</span>
              </div>
              <div className="opportunity-mobile-strategy">{candidate.strategyName}</div>
              <div className={`opportunity-mobile-signal ${candidate.currentSignal ? "signal-active" : "signal-inactive"}`}>
                <span>{candidate.currentSignal ? "Current daily signal active" : "No current daily signal"}</span>
                <small>{candidate.signalDate}{candidate.currentSignal ? ` · close ${fixed(candidate.signalClose)}` : ""}</small>
              </div>
              <div className="opportunity-mobile-metrics">
                <span><small>VALIDATION EXPECTANCY</small><strong className={(candidate.validation.expectancyR ?? 0) > 0 ? "positive" : "negative"}>{candidate.validation.expectancyR === null ? "N/A" : fixed(candidate.validation.expectancyR, 3) + "R"}</strong></span>
                <span><small>VALIDATION PF</small><strong>{candidate.validation.profitFactor === null ? "N/A" : fixed(candidate.validation.profitFactor, 2)}</strong></span>
                <span><small>VALIDATION RETURN</small><strong className={candidate.validation.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(candidate.validation.totalReturnPct)}</strong></span>
                <span><small>VALIDATION DRAWDOWN</small><strong className="negative">-{fixed(candidate.validation.maxDrawdownPct)}%</strong></span>
              </div>
              <div className="opportunity-mobile-meta">
                <span>Trades <b>{candidate.inSample.tradeCount} / {candidate.validation.tradeCount} / {candidate.finalTest.tradeCount}</b><small>Training / validation / test</small></span>
                <span>Untouched test <b className={candidate.finalTest.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(candidate.finalTest.totalReturnPct)}</b><small>{fixed(candidate.finalTest.expectancyR, 3)}R expectancy</small></span>
              </div>
              <div className="opportunity-mobile-footer">
                {candidate.currentSignal
                  ? <span>Reference stop {fixed(candidate.referenceStop)} · target {fixed(candidate.referenceTarget)}</span>
                  : <span>Not a current entry signal</span>}
                <small>{candidate.executionStatus === "SHORT_THEORETICAL_ONLY" ? "Short-side hypothesis only; not execution-ready." : "Research result only; not a buy recommendation."}</small>
              </div>
            </article>)}
            {opportunityData.candidates.length === 0 && <div className="empty-state">No combinations passed the history, sample-size and accounting gates. This is a valid result; do not lower thresholds just to force a ranking.</div>}
          </div>
          <div className="table-scroll opportunity-table-scroll">
            <table className="opportunity-table">
              <thead><tr><th>RANK</th><th>INSTRUMENT</th><th>STRATEGY</th><th>DIRECTION</th><th>LATEST SETUP</th><th>VALIDATION EXP. R</th><th>VALIDATION PF</th><th>VALIDATION RETURN</th><th>VALIDATION DD</th><th>TRADES TRAIN / VAL / TEST</th><th>FINAL TEST RETURN</th></tr></thead>
              <tbody>
                {opportunityData.candidates.map((candidate) => <tr key={candidate.symbol + candidate.strategy + candidate.direction}>
                  <td className="number-cell">{candidate.rank}</td>
                  <td><div className="stock-cell"><strong>{candidate.symbol.replace(".NS", "")}</strong><small>{candidate.name}</small></div></td>
                  <td>{candidate.strategyName}</td>
                  <td><span className={`action-pill ${candidate.direction === "LONG" ? "action-triggered" : "action-watch"}`}>{candidate.direction}</span><small className="execution-caveat">{candidate.executionStatus === "SHORT_THEORETICAL_ONLY" ? "Theoretical only" : "Research only"}</small></td>
                  <td>{candidate.currentSignal ? <><span className="action-pill action-triggered">Setup</span><small className="execution-caveat">{candidate.signalDate}<br/>Close {fixed(candidate.signalClose)} · Stop {fixed(candidate.referenceStop)} · Target {fixed(candidate.referenceTarget)}</small></> : <span className="muted-cell">No latest trigger</span>}</td>
                  <td className={`number-cell ${(candidate.validation.expectancyR ?? 0) >= 0 ? "positive" : "negative"}`}>{candidate.validation.expectancyR === null ? "—" : fixed(candidate.validation.expectancyR, 3)}R</td>
                  <td className="number-cell">{candidate.validation.profitFactor === null ? "N/A" : fixed(candidate.validation.profitFactor, 2)}</td>
                  <td className={`number-cell ${candidate.validation.totalReturnPct >= 0 ? "positive" : "negative"}`}>{pct(candidate.validation.totalReturnPct)}</td>
                  <td className="number-cell negative">-{fixed(candidate.validation.maxDrawdownPct)}%</td>
                  <td className="number-cell">{candidate.inSample.tradeCount} / {candidate.validation.tradeCount} / {candidate.finalTest.tradeCount}</td>
                  <td className={`number-cell ${candidate.finalTest.totalReturnPct >= 0 ? "positive" : "negative"}`}>{pct(candidate.finalTest.totalReturnPct)}<small className="execution-caveat">{fixed(candidate.finalTest.expectancyR, 3)}R expectancy</small></td>
                </tr>)}
                {opportunityData.candidates.length === 0 && <tr><td colSpan={11} className="empty-state">No combinations passed full-history, minimum trade-count, accounting and validation gates. This is a valid outcome; do not lower thresholds solely to force a leaderboard.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="backtest-assumptions"><strong>Research and execution limitations</strong><p>{opportunityData.limitations.join(" ")}</p></div>
        </>}
      </section>

      <section className="results-section">
        <div className="results-heading">
          <div>
            <div className="section-kicker">SCANNER OUTPUT / 02</div>
            <h2>Setup watchlist <span className="heading-count">{data ? data.results.length : 25}</span></h2>
          </div>
          <div className="results-actions">
            <div className="search-wrap"><span>⌕</span><input aria-label="Search ticker or company" placeholder="Find a stock…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <button className="export-button" disabled={!rows.length} onClick={() => downloadCsv(rows)}><span>↓</span> Export CSV</button>
          </div>
        </div>

        <div className="filter-row" role="tablist" aria-label="Filter scanner results">
          {(["ALL", "TRIGGERED", "WATCH", "AVOID"] as Filter[]).map((item) => (
            <button key={item} role="tab" aria-selected={filter === item} className={`filter-tab ${filter === item ? "selected" : ""}`} onClick={() => setFilter(item)}>
              {item === "ALL" ? "All stocks" : item === "TRIGGERED" ? "Triggered" : item === "WATCH" ? "Watch" : "Avoid"}
              <span>{item === "ALL" ? (data?.results.length ?? 25) : data?.results.filter((row) => row.action === item).length ?? 0}</span>
            </button>
          ))}
          {data && <span className="last-updated">Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{data.cached ? " · cached" : ""}</span>}
        </div>

        <div className="watchlist-mobile-list" aria-label="Stock watchlist for mobile">
          {!loading && rows.map((row) => <article className="watchlist-mobile-card" key={`mobile-${row.symbol}`}>
            <div className="watchlist-mobile-card-head">
              <div className="stock-cell"><strong>{row.symbol.replace(".NS", "")}</strong><small>{row.name}</small></div>
              <ActionPill action={row.action} />
            </div>
            <p className="watchlist-mobile-reason">{row.reason}</p>
            <div className="watchlist-mobile-price">
              <span><small>LAST PRICE</small><strong>{fixed(row.lastPrice)}</strong></span>
              <span><small>DAY CHANGE</small><strong className={(row.changePct ?? 0) >= 0 ? "positive" : "negative"}>{pct(row.changePct)}</strong></span>
            </div>
            <div className="watchlist-mobile-metrics">
              <span><small>RSI 14</small><b>{fixed(row.rsi14, 1)}</b></span>
              <span><small>REL. VOL</small><b>{row.relativeVolume === null ? "—" : `${fixed(row.relativeVolume, 2)}×`}</b></span>
              <span><small>TRIGGER</small><b>{fixed(row.trigger)}</b></span>
              <span><small>STOP</small><b>{fixed(row.stop)}</b></span>
              <span><small>TARGET</small><b>{fixed(row.target)}</b></span>
              <span><small>QTY*</small><b>{row.quantity ? integer.format(row.quantity) : "—"}</b></span>
            </div>
          </article>)}
          {loading && !data && <div className="empty-state">Loading today's watchlist…</div>}
          {!loading && rows.length === 0 && <div className="empty-state">{data ? "No stocks match this filter." : "Preparing scanner…"}</div>}
        </div>
        <div className="table-scroll watchlist-table-scroll">
          <table>
            <thead><tr>
              <th>STOCK</th><th>STATUS / REASON</th><th>LAST PRICE</th><th>DAY %</th><th>RSI (14)</th><th>REL. VOL</th><th>TRIGGER</th><th>STOP</th><th>TARGET</th><th>QTY*</th>
            </tr></thead>
            <tbody>
              {loading && !data && Array.from({ length: 7 }, (_, index) => <tr key={index} className="skeleton-row"><td colSpan={10}><span></span></td></tr>)}
              {!loading && rows.map((row) => (
                <tr key={row.symbol}>
                  <td><div className="stock-cell"><strong>{row.symbol.replace(".NS", "")}</strong><small>{row.name}</small></div></td>
                  <td className="reason-cell"><ActionPill action={row.action} /><small title={row.reason}>{row.reason}</small></td>
                  <td className="number-cell">{fixed(row.lastPrice)}</td>
                  <td className={`number-cell ${(row.changePct ?? 0) >= 0 ? "positive" : "negative"}`}>{pct(row.changePct)}</td>
                  <td className="number-cell">{fixed(row.rsi14, 1)}</td>
                  <td className="number-cell">{row.relativeVolume === null ? "—" : `${fixed(row.relativeVolume, 2)}×`}</td>
                  <td className="number-cell">{fixed(row.trigger)}</td>
                  <td className="number-cell risk-cell">{fixed(row.stop)}</td>
                  <td className="number-cell target-cell">{fixed(row.target)}</td>
                  <td className="number-cell qty-cell">{row.quantity ? integer.format(row.quantity) : "—"}</td>
                </tr>
              ))}
              {(!loading && rows.length === 0) && <tr><td colSpan={10} className="empty-state">{data ? "No stocks match this filter." : "Preparing scanner…"}{!data && <small>Loading the latest daily candles and technical indicators.</small>}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-foot"><span>* Theoretical quantity only, capped at {data?.params.maxPositionPct ?? 10}% of capital and {data?.params.maxRiskPct ?? 1}% risk per trade.</span><span>{data?.dataSource ?? "Awaiting market data"}</span></div>
      </section>

      <section className="backtest-section" aria-labelledby="backtest-title">
        <div className="backtest-heading">
          <div>
            <div className="section-kicker">STRATEGY VALIDATION / 03</div>
            <h2 id="backtest-title">Historical backtest</h2>
            <p>Replay completed daily candles, include estimated costs, and compare the rule set with Nifty 50. This is a simulation, not a forecast.</p>
          </div>
          {backtestData && <button className="export-button" onClick={() => downloadBacktestCsv(backtestData.trades)} disabled={backtestData.trades.length === 0}>↓ Export trades CSV</button>}
        </div>

        <div className="backtest-controls">
          <label className="field">
            <span>Historical period</span>
            <PremiumSelect
              value={backtestYears}
              onChange={setBacktestYears}
              ariaLabel="Backtest historical period"
              options={[
                { value: "3", label: "Last 3 years", hint: "Shorter test window" },
                { value: "5", label: "Last 5 years", hint: "Longer historical window" }
              ]}
            />
          </label>
          <label className="field">
            <span>All-in estimated cost per side <small>BPS</small></span>
            <input className="backtest-number" type="number" min="0" max="200" step="5" value={backtestCostBps} onChange={(event) => setBacktestCostBps(event.target.value)} aria-label="Estimated trading cost per side in basis points" />
          </label>
          <div className="backtest-capital">
            <span>Risk settings</span>
            <strong>{inr0.format(Number(capital) || 0)} capital · {inr0.format(Math.min(Number(risk) || 0, (Number(capital) || 0) * 0.01))} risk/trade</strong>
          </div>
          <button className="scan-button backtest-run-button" onClick={() => void runBacktest()} disabled={backtestLoading || Number(capital) <= 0 || Number(risk) <= 0}>
            {backtestLoading ? <><span className="spinner"></span> Running test…</> : <><span>↗</span> Run backtest</>}
          </button>
        </div>
        <p className="backtest-hint">Historical data requests can take 30–60 seconds. Today's potentially incomplete candle is excluded. Cost is a configurable all-in estimate on each side, not a broker-specific tax calculation.</p>
        {backtestLoading && <div className="backtest-progress"><span className="spinner"></span> Loading multi-year daily history and replaying trades…</div>}
        {backtestError && <div className="error-banner"><strong>Backtest unavailable</strong><span>{backtestError}</span><button onClick={() => void runBacktest()}>Try again</button></div>}
        {backtestData && <>
          <div className="backtest-period-line">
            <span>FULL PERIOD <strong>{backtestData.period.startDate} → {backtestData.period.endDate}</strong></span>
            <span>SYMBOLS LOADED <strong>{backtestData.metrics.loadedSymbols} / 25</strong></span>
            <span>DATA SOURCE <strong>Yahoo Finance daily candles</strong></span>
          </div>
          {backtestData.dataQuality && <div className={`data-quality-panel data-quality-${backtestData.dataQuality.status.toLowerCase()}`}>
            <div className="data-quality-main">
              <div className="section-kicker">DATA &amp; ACCOUNTING GATE</div>
              <h3>{backtestData.dataQuality.status === "PASS" ? "Coverage checks passed" : backtestData.dataQuality.status === "LIMITED" ? "Research coverage is limited" : "Backtest validity hold"}</h3>
              <p>Requested {backtestData.assumptions.yearsRequested} years: {backtestData.dataQuality.requestedPeriod.startDate} → {backtestData.dataQuality.requestedPeriod.endDate}. Actual Nifty candles: {backtestData.dataQuality.marketDataPeriod.startDate} → {backtestData.dataQuality.marketDataPeriod.endDate} ({backtestData.dataQuality.marketCoveragePct}% of requested calendar span).</p>
              <div className="data-quality-stats">
                <span><small>INDEX CANDLES</small><strong>{integer.format(backtestData.dataQuality.actualMarketCandles)}</strong></span>
                <span><small>STOCKS LOADED</small><strong>{backtestData.dataQuality.symbolsLoaded} / {backtestData.dataQuality.symbolsRequested}</strong></span>
                <span><small>FULL-WINDOW STOCKS</small><strong>{backtestData.dataQuality.symbolsWithFullWindow}</strong></span>
                <span><small>ACCOUNTING</small><strong className={backtestData.accounting.reconciled ? "positive" : "negative"}>{backtestData.accounting.reconciled ? "Reconciled" : "Mismatch"}</strong></span>
              </div>
              <p className="accounting-line">Trade net P&amp;L {inr0.format(backtestData.accounting.closedTradeNetPnlInr)} · equity-derived P&amp;L {inr0.format(backtestData.accounting.equityDerivedNetPnlInr)} · difference {inr0.format(backtestData.accounting.reconciliationDifferenceInr)} (tolerance {inr0.format(backtestData.accounting.toleranceInr)}).</p>
            </div>
            <div className="ranking-gate">
              <span className={`gate-state ${backtestData.rankingEligibility?.eligible ? "gate-open" : "gate-blocked"}`}>{backtestData.rankingEligibility?.eligible ? "RANKING ELIGIBLE" : "RANKING BLOCKED"}</span>
              <strong>Minimum {backtestData.rankingEligibility?.minimumTrades ?? 30} completed trades</strong>
              <span>{backtestData.rankingEligibility?.completedTrades ?? backtestData.metrics.tradeCount} full-period · {backtestData.rankingEligibility?.outOfSampleTrades ?? backtestData.outOfSample?.metrics.tradeCount ?? 0} holdout</span>
              {backtestData.rankingEligibility && backtestData.rankingEligibility.reasons.length > 0 && <ul>{backtestData.rankingEligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
              {(!backtestData.rankingEligibility || backtestData.rankingEligibility.reasons.length === 0) && <p>Ranking still requires validated strategy and direction coverage; this report covers the existing long breakout model only.</p>}
            </div>
          </div>}
          <div className="backtest-metrics">
            <div className="backtest-metric"><small>NET STRATEGY RETURN</small><strong className={backtestData.metrics.totalReturnPct >= 0 ? "positive" : "negative"}>{fixed(backtestData.metrics.totalReturnPct)}%</strong><span>{inr0.format(backtestData.metrics.netProfitInr)} net P&amp;L</span></div>
            <div className="backtest-metric"><small>NIFTY 50 BENCHMARK</small><strong className={backtestData.metrics.benchmarkReturnPct >= 0 ? "positive" : "negative"}>{fixed(backtestData.metrics.benchmarkReturnPct)}%</strong><span>Buy-and-hold reference, cost-adjusted</span></div>
            <div className="backtest-metric"><small>MAX DRAWDOWN</small><strong className="negative">-{fixed(backtestData.metrics.maxDrawdownPct)}%</strong><span>Peak-to-trough equity decline</span></div>
            <div className="backtest-metric"><small>WIN RATE</small><strong>{fixed(backtestData.metrics.winRatePct)}%</strong><span>{backtestData.metrics.wins} wins · {backtestData.metrics.losses} losses</span></div>
            <div className="backtest-metric"><small>CLOSED TRADES</small><strong>{backtestData.metrics.tradeCount}</strong><span>One position at a time</span></div>
            <div className="backtest-metric"><small>PROFIT FACTOR</small><strong>{backtestData.metrics.profitFactor === null ? "N/A" : fixed(backtestData.metrics.profitFactor)}</strong><span>Winning P&amp;L ÷ losing P&amp;L</span></div>
            <div className="backtest-metric"><small>ANNUALIZED RETURN</small><strong>{backtestData.metrics.cagrPct === null ? "N/A" : fixed(backtestData.metrics.cagrPct) + "%"}</strong><span>Net of modeled costs</span></div>
            <div className="backtest-metric"><small>ESTIMATED TOTAL COSTS</small><strong>{inr0.format(backtestData.metrics.totalCostsInr)}</strong><span>{backtestData.assumptions.costBpsPerSide} bps per side</span></div>
          </div>

          <div className="backtest-chart-block">
            <div className="backtest-chart-title"><div><strong>Simulated equity curve</strong><span>Includes realized P&amp;L, modeled entry/exit costs, and mark-to-market open trades</span></div><div><small>STARTING CAPITAL</small><strong>{inr0.format(backtestData.capitalInr)}</strong></div></div>
            {backtestPlot && <svg className="backtest-chart" viewBox="0 0 720 160" role="img" aria-label="Historical simulated equity curve compared with starting capital" preserveAspectRatio="none">
              <line x1="0" x2="720" y1={backtestPlot.baselineY} y2={backtestPlot.baselineY} stroke="#6e7c88" strokeDasharray="5 5" strokeWidth="1" />
              <polyline points={backtestPlot.line} fill="none" stroke="#a4f4c5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>}
            <div className="backtest-chart-scale"><span>Low {inr0.format(backtestPlot?.minimum ?? backtestData.capitalInr)}</span><span>High {inr0.format(backtestPlot?.maximum ?? backtestData.capitalInr)}</span></div>
          </div>

          {backtestData.outOfSample && <div className="out-of-sample-panel">
            <div><div className="section-kicker">HOLDOUT CHECK</div><h3>Out-of-sample performance</h3><p>Latest 25% of the available post-warm-up period, evaluated separately from the full-period result.</p><small>{backtestData.outOfSample.period.startDate} → {backtestData.outOfSample.period.endDate}</small></div>
            <div className="out-of-sample-stats">
              <div><small>NET RETURN</small><strong className={backtestData.outOfSample.metrics.totalReturnPct >= 0 ? "positive" : "negative"}>{fixed(backtestData.outOfSample.metrics.totalReturnPct)}%</strong></div>
              <div><small>NIFTY BENCHMARK</small><strong>{fixed(backtestData.outOfSample.metrics.benchmarkReturnPct)}%</strong></div>
              <div><small>MAX DRAWDOWN</small><strong className="negative">-{fixed(backtestData.outOfSample.metrics.maxDrawdownPct)}%</strong></div>
              <div><small>TRADES</small><strong>{backtestData.outOfSample.metrics.tradeCount}</strong></div>
              <div><small>WIN RATE</small><strong>{fixed(backtestData.outOfSample.metrics.winRatePct)}%</strong></div>
              <div><small>PROFIT FACTOR</small><strong>{backtestData.outOfSample.metrics.profitFactor === null ? "N/A" : fixed(backtestData.outOfSample.metrics.profitFactor)}</strong></div>
            </div>
          </div>}

          {backtestData.warnings.length > 0 && <div className="inline-warning backtest-warnings"><strong>Data coverage:</strong> {backtestData.warnings.length} symbol(s) were omitted. Details: {backtestData.warnings.slice(0, 3).join(" · ")}{backtestData.warnings.length > 3 ? " · …" : ""}</div>}

          <div className="backtest-assumptions">
            <strong>Simulation assumptions</strong>
            <p>{backtestData.assumptions.entryRule} {backtestData.assumptions.sameDayStopAndTargetRule} Exit after {backtestData.assumptions.maxHoldingDays} sessions if neither stop nor target is hit. Cost assumption: {backtestData.assumptions.costBpsPerSide} bps per side. Maximum position value: {backtestData.assumptions.maxPositionPct}% of starting capital; risk budget capped at {backtestData.assumptions.maxRiskPct}% per trade.</p>
            <p><strong>Important:</strong> only one position may be open at a time. This is a first-pass research simulation; Yahoo Finance is an unofficial source, and actual fills, corporate actions, charges and slippage may differ. A positive backtest does not guarantee future returns.</p>
          </div>

          <div className="backtest-trades-heading"><div><strong>Recent closed trades</strong><span>Showing up to 15 most recent trades of {backtestData.trades.length}</span></div><button className="export-button" onClick={() => downloadBacktestCsv(backtestData.trades)} disabled={backtestData.trades.length === 0}>↓ Export CSV</button></div>
          <div className="table-scroll backtest-trade-scroll">
            <table className="backtest-trade-table">
              <thead><tr><th>STOCK</th><th>ENTRY DATE</th><th>EXIT DATE</th><th>ENTRY</th><th>EXIT</th><th>QTY</th><th>EXIT REASON</th><th>NET P&amp;L</th><th>R MULTIPLE</th></tr></thead>
              <tbody>
                {recentBacktestTrades.map((trade, index) => <tr key={trade.symbol + trade.entryDate + index}>
                  <td>{trade.symbol.replace(".NS", "")}</td><td>{trade.entryDate}</td><td>{trade.exitDate}</td>
                  <td className="number-cell">{fixed(trade.entryPrice, 2)}</td><td className="number-cell">{fixed(trade.exitPrice, 2)}</td>
                  <td className="number-cell">{integer.format(trade.quantity)}</td><td><span className="action-pill action-watch">{trade.exitReason.replaceAll("_", " ")}</span></td>
                  <td className={"number-cell " + (trade.netPnlInr >= 0 ? "positive" : "negative")}>{inr0.format(trade.netPnlInr)}</td><td className={"number-cell " + (trade.rMultiple >= 0 ? "positive" : "negative")}>{fixed(trade.rMultiple, 2)}R</td>
                </tr>)}
                {backtestData.trades.length === 0 && <tr><td colSpan={9} className="empty-state">No trades met all entry conditions in this period. No trade is a valid result.</td></tr>}
              </tbody>
            </table>
          </div>
        </>}
      </section>

      <section className="rules-grid">
        <div className="rules-heading"><div className="section-kicker">BUILT-IN DISCIPLINE / 04</div><h2>How a trigger is earned</h2><p>No black box. The screening rules are visible and testable.</p></div>
        <div className="rule-card"><span className="rule-number">01</span><div><strong>Trend alignment</strong><p>Close &gt; SMA 20 &gt; SMA 50 &gt; SMA 200.</p></div></div>
        <div className="rule-card"><span className="rule-number">02</span><div><strong>Breakout confirmation</strong><p>Daily close clears the prior 5-session high plus 0.1 × ATR(14), with relative volume at least 1.1×.</p></div></div>
        <div className="rule-card"><span className="rule-number">03</span><div><strong>Market + momentum filter</strong><p>Nifty must be bullish; RSI(14) must be between 50 and 70. A bearish regime blocks new long triggers.</p></div></div>
        <div className="rule-card"><span className="rule-number">04</span><div><strong>Defined risk sizing</strong><p>Stop is 1.5 × ATR below the trigger, target is 2R, risk is capped at 1% and position value at 10% of capital.</p></div></div>
      </section>

      <footer className="footer">
        <div className="footer-brand"><span className="brand-mark"><span></span><span></span><span></span></span><strong>NIFTY TRADING AGENT</strong></div>
        <p>For research and educational screening only. Prices may be delayed, incomplete or wrong. Signals are not personalized financial advice or guaranteed outcomes. Confirm data, liquidity, slippage, corporate actions and your own risk limits before trading. No broker connection or automatic order execution is implemented.</p>
        <span className="footer-version">V1.0 · RULE-BASED</span>
      </footer>
    </main>
  );
}

export default App;
