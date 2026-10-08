import { useEffect, useMemo, useState } from "react";
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

        <div className="table-scroll">
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

      <section className="rules-grid">
        <div className="rules-heading"><div className="section-kicker">BUILT-IN DISCIPLINE / 03</div><h2>How a trigger is earned</h2><p>No black box. The screening rules are visible and testable.</p></div>
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
