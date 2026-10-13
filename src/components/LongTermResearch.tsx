import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { UNIVERSE } from "../lib/universe.js";
import type { LongTermMetric, LongTermResearchResponse } from "../lib/long-term-types.js";

const integer = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const formatMoney = (value: number | null, currency = "INR") => value === null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2, notation: value >= 100_000_000 ? "compact" : "standard" }).format(value);
const formatPct = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : (value > 0 ? "+" : "") + value.toFixed(1) + "%";
const formatPrice = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : rupees.format(value);
const stanceLabel: Record<string, string> = { BUY: "BUY · STAGED ENTRY", HOLD: "HOLD · REVIEW", WAIT: "WAIT · NEEDS SETUP", SELL: "SELL · REVIEW THESIS" };
const metricLabel: Record<string, string> = { GOOD: "GOOD", NEUTRAL: "MIXED", WEAK: "WEAK", UNAVAILABLE: "NO DATA" };

function MetricCard({ metric }: { metric: LongTermMetric }) {
  return <article className={"lt-metric lt-metric-" + metric.assessment.toLowerCase()}>
    <div className="lt-metric-top"><span>{metric.label}</span><strong>{metricLabel[metric.assessment]}</strong></div>
    <div className="lt-metric-value">{metric.display}</div>
    <p>{metric.reason}</p>
  </article>;
}

export default function LongTermResearch() {
  const [symbolInput, setSymbolInput] = useState("RELIANCE");
  const [querySymbol, setQuerySymbol] = useState("RELIANCE");
  const [research, setResearch] = useState<LongTermResearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadStock(ticker = querySymbol) {
    const clean = ticker.trim().toUpperCase();
    if (!clean) { setError("Enter a stock ticker, for example RELIANCE or INFY."); return; }
    setQuerySymbol(clean);
    setSymbolInput(clean);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/long-term-research?symbol=" + encodeURIComponent(clean), { headers: { accept: "application/json" } });
      const body = await response.json() as LongTermResearchResponse & { error?: string; detail?: string };
      if (!response.ok) throw new Error([body.error, body.detail].filter(Boolean).join(" "));
      setResearch(body);
    } catch (caught) {
      setResearch(null);
      setError(caught instanceof Error ? caught.message : "Could not load this stock's research.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadStock("RELIANCE"); }, []);

  const sortedMetrics = useMemo(() => {
    if (!research) return [];
    const priority = ["roe", "revenue-growth", "earnings-growth", "profit-margin", "free-cash-flow", "leverage", "valuation-pe", "price-to-book", "dividend-yield"];
    return [...research.metrics].sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));
  }, [research]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadStock(symbolInput);
  }

  return <section className="long-term-workspace" aria-labelledby="long-term-research-title">
    <div className="lt-workspace-header">
      <div>
        <div className="section-kicker">LONG-TERM INVESTING / RESEARCH DESK</div>
        <h1 id="long-term-research-title">Own great businesses.<br /><em>Buy with a plan.</em></h1>
        <p>Understand business quality, valuation and long-term price context before adding a stock. Every metric is labelled, every entry zone is rule-based, and missing data stays missing.</p>
      </div>
      <div className="lt-header-stamp"><span>RESEARCH, NOT EXECUTION</span><strong>10Y</strong><small>Think in years</small></div>
    </div>

    <form className="lt-search-bar" onSubmit={submit}>
      <label htmlFor="lt-stock-search"><span>SEARCH A STOCK</span><input id="lt-stock-search" value={symbolInput} list="lt-stock-suggestions" onChange={event => setSymbolInput(event.target.value)} placeholder="Company name or NSE ticker" autoComplete="off" /></label>
      <datalist id="lt-stock-suggestions">{UNIVERSE.map(stock => <option key={stock.symbol} value={stock.symbol.replace(/\.NS$/, "")}>{stock.name}</option>)}</datalist>
      <button type="submit" className="scan-button" disabled={loading}>{loading ? <><span className="spinner" /> Analysing…</> : <><span>⌕</span> Analyse stock</>}</button>
      <small>Supports NSE symbols ending in .NS; common tickers can be entered without the suffix.</small>
    </form>

    {error && <div className="error-banner"><strong>Research could not load</strong><span>{error}</span><button type="button" onClick={() => void loadStock(symbolInput)}>Retry</button></div>}
    {loading && !research && <div className="lt-loading"><span className="spinner" /> Loading completed daily prices, fundamentals and broker actions…</div>}

    {research && <>
      <div className="lt-stock-heading">
        <div className="lt-company-title"><span className="lt-company-symbol">{research.symbol.replace(/\.NS$/, "")}</span><div><h2>{research.name}</h2><p>{research.sector ?? "Sector not returned"} · Daily closing data through {research.timing.dataAsOf ? new Date(research.timing.dataAsOf).toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }) : "date unavailable"}</p></div></div>
        <div className={"lt-stance lt-stance-" + research.stance.toLowerCase()}><span>SCREENING STANCE</span><strong>{stanceLabel[research.stance]}</strong><small>{research.qualityScore === null ? "Quality score unavailable" : "Quality score " + research.qualityScore + "/100"} · {research.metricsAvailable} scored metrics</small></div>
      </div>

      <div className="lt-decision-grid">
        <article className="lt-decision-card lt-entry-card">
          <div className="section-kicker">LONG-TERM ENTRY PLAN</div>
          <div className={"lt-entry-status lt-entry-" + research.timing.assessment.toLowerCase().replaceAll("_", "-")}>{research.timing.assessment.replaceAll("_", " ")}</div>
          <div className="lt-entry-zone"><span>MONITOR ACCUMULATION ZONE</span><strong>{research.timing.entryLow === null || research.timing.entryHigh === null ? "Not enough price history" : formatPrice(research.timing.entryLow) + " – " + formatPrice(research.timing.entryHigh)}</strong></div>
          <p>{research.timing.message}</p>
          <div className="lt-entry-levels"><div><small>LAST COMPLETED CLOSE</small><strong>{formatPrice(research.price)}</strong></div><div><small>50-DAY AVG</small><strong>{formatPrice(research.timing.ma50)}</strong></div><div><small>200-DAY AVG</small><strong>{formatPrice(research.timing.ma200)}</strong></div></div>
          <div className="lt-disclaimer">A price zone is a watch level, not an intrinsic-value estimate or guarantee. Split entries only after verifying the latest financial results and risks.</div>
        </article>
        <article className="lt-decision-card lt-quality-card">
          <div className="section-kicker">BUSINESS QUALITY SCREEN</div>
          <div className="lt-score-row"><div className={"lt-score-ring " + (research.qualityScore === null ? "lt-score-unknown" : research.qualityScore >= 68 ? "lt-score-good" : research.qualityScore >= 45 ? "lt-score-mid" : "lt-score-weak")}><strong>{research.qualityScore ?? "—"}</strong><small>/ 100</small></div><div><h3>{research.qualityScore === null ? "Not enough evidence" : research.qualityScore >= 68 ? "Fundamentals look supportive" : research.qualityScore >= 45 ? "Mixed fundamental picture" : "Several fundamentals are weak"}</h3><p>{research.stanceReason}</p></div></div>
          <div className="lt-score-legend"><span><i className="lt-dot-good" /> Good = stronger under the screen</span><span><i className="lt-dot-neutral" /> Mixed = inspect context</span><span><i className="lt-dot-weak" /> Weak = needs review</span></div>
          <div className="lt-price-context"><div><span>RSI (14), daily</span><strong>{research.timing.rsi14 === null ? "—" : research.timing.rsi14.toFixed(1)}</strong></div><div><span>Distance from 200-day</span><strong>{formatPct(research.timing.distanceFrom200Pct)}</strong></div><div><span>52-week low / high</span><strong>{formatPrice(research.timing.weekLow)} / {formatPrice(research.timing.weekHigh)}</strong></div></div>
        </article>
      </div>

      <section className="lt-metrics-section">
        <div className="lt-section-heading"><div><div className="section-kicker">FUNDAMENTALS / EACH METRIC EXPLAINED</div><h2>Good, mixed or weak?</h2><p>General screening thresholds, not universal truths. Compare metrics with companies in the same sector and read the latest filings.</p></div><span>{research.metricsAvailable} scored / {research.metrics.length} metrics</span></div>
        <div className="lt-metric-grid">{sortedMetrics.map(metric => <MetricCard key={metric.id} metric={metric} />)}</div>
      </section>

      <section className="lt-broker-section">
        <div className="lt-section-heading"><div><div className="section-kicker">ANALYST COVERAGE / SOURCE-DATED</div><h2>Broker ratings & price targets</h2><p>Individual broker actions are shown only when the free source returns the firm, rating and date. This is not a live consensus guarantee.</p></div><span>{research.brokerRatings.length} broker actions · 12 months</span></div>
        <div className="lt-consensus-strip">
          <div><small>AGGREGATE VIEW</small><strong>{research.analystConsensus ? research.analystConsensus.replaceAll("_", " ").toUpperCase() : "NOT AVAILABLE"}</strong></div>
          <div><small>MEAN ANALYST TARGET</small><strong>{formatPrice(research.analystTarget)}</strong></div>
          <div><small>IMPLIED UPSIDE / DOWNSIDE</small><strong className={research.analystTargetUpsidePct === null ? "" : research.analystTargetUpsidePct >= 0 ? "positive" : "negative"}>{formatPct(research.analystTargetUpsidePct)}</strong></div>
          {research.recommendationCounts && <div className="lt-rating-counts"><small>ANALYST COUNT · STRONG BUY / BUY / HOLD / SELL / STRONG SELL</small><strong>{[research.recommendationCounts.strongBuy, research.recommendationCounts.buy, research.recommendationCounts.hold, research.recommendationCounts.sell, research.recommendationCounts.strongSell].join(" / ")}</strong></div>}
        </div>
        {research.brokerRatings.length > 0 ? <div className="lt-table-wrap"><table className="lt-table"><thead><tr><th>DATE</th><th>BROKER / RESEARCH FIRM</th><th>ACTION</th><th>PREVIOUS</th><th>CURRENT RATING</th></tr></thead><tbody>{research.brokerRatings.map((rating, index) => <tr key={rating.firm + (rating.date ?? "") + index}><td>{rating.date ?? "—"}</td><td>{rating.firm}</td><td>{rating.action}</td><td>{rating.fromGrade ?? "—"}</td><td><strong>{rating.toGrade ?? "—"}</strong></td></tr>)}</tbody></table></div> : <div className="lt-empty-state"><strong>No broker-by-broker ratings returned</strong><p>The free public source did not provide recent firm-level actions for this stock. We do not substitute guessed ratings or a fabricated consensus.</p></div>}
      </section>

      {research.warnings.length > 0 && <div className="lt-warning-list"><strong>Coverage notes</strong>{research.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      <div className="lt-source-row"><span>DATA SOURCES</span>{research.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div>
    </>}
  </section>;
}
