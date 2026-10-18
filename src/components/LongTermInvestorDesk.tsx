import { useEffect, useMemo, useState } from "react";
import { UNIVERSE } from "../lib/universe.js";
import { planLongTermEntry } from "../lib/long-term-entry.js";

type Action = "BUY" | "HOLD" | "SELL" | "INSUFFICIENT_DATA";
type MetricSet = {
  marketCap: number | null; trailingPe: number | null; forwardPe: number | null; priceToBook: number | null; bookValue: number | null;
  dividendYieldPct: number | null; roePct: number | null; profitMarginPct: number | null; revenueGrowthPct: number | null; earningsGrowthPct: number | null;
  debtToEquityPct: number | null; targetMeanPrice: number | null; targetLowPrice: number | null; targetHighPrice: number | null;
  analystRatingKey: string | null; analystRecommendationMean: number | null; yearHigh: number | null; yearLow: number | null;
  sma50: number | null; sma200: number | null; rsi14: number | null; return1yPct: number | null; return3yPct: number | null; return5yPct: number | null; maxDrawdownPct: number | null;
};
type Factor = { key: string; label: string; score: -1 | 0 | 1 | null; finding: string };
type ResearchResponse = {
  symbol: string; name: string; sector: string | null; industry: string | null; currency: string; price: number; asOf: string; generatedAt: string; source: string;
  sources: Array<{ name: string; url: string }>; metrics: MetricSet;
  analystConsensus: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  brokerHistory: Array<{ firm: string; action: string; fromGrade: string | null; toGrade: string | null; date: string | null }>;
  assessment: { action: Action; score: number; availableFactors: number; totalFactors: number; confidence: string; summary: string; factors: Factor[] };
  dataQuality: { completedDailyCandles: number; fundamentalsAvailable: number; analystHistoryAvailable: boolean; note: string };
};
type Deal = { date: string | null; symbol: string; company: string; clientName: string; side: "BUY" | "SELL"; quantity: number; price: number; valueCrore: number; dealType: "BULK" | "BLOCK" };
type Flow = { category: string; date: string | null; buyCrore: number | null; sellCrore: number | null; netCrore: number | null };
type EntityMove = { symbol: string; company: string; clientName: string; buys: number; sells: number; firstBuyDate: string | null; firstSellDate: string | null; count: number; netBuyCrore: number; observedDirection: string; firstBuyObservedInWindow: boolean };
type Holding = { symbol: string; name: string; date: string; promoterPct: number | null; publicPct: number | null; submissionDate: string | null; filingUrl: string | null; promoterChangePp: number | null; publicChangePp: number | null; previousDate: string | null; previousFilingUrl: string | null };
type ActivityResponse = { ownershipSymbol?: string | null; generatedAt: string; cached: boolean; rangeDays: number; dateRange: { from: string; to: string }; source: string; sources: { deals: string; shareholding: string; fiiDii: string }; deals: Deal[]; entityMoves: EntityMove[]; flows: Flow[]; shareholding: Holding[]; warnings: string[]; notes: string[]; error?: string; detail?: string; hint?: string };

const stocks = UNIVERSE.map((stock) => ({ symbol: stock.symbol.replace(/\.NS$/, ""), fullSymbol: stock.symbol, name: stock.name }));
const n = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const i0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr = (value: number | null, digits = 2) => value === null || !Number.isFinite(value) ? "—"
  : "₹" + value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (value: number | null) => value === null || !Number.isFinite(value) ? "—"
  : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
const signedCrore = (value: number | null) => value === null || !Number.isFinite(value) ? "—"
  : (value > 0 ? "+" : "") + value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " Cr";
function marketCap(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1000000000000) return "₹" + (value / 1000000000000).toFixed(2) + " T";
  if (value >= 10000000000) return "₹" + (value / 10000000000).toFixed(2) + " K Cr";
  return "₹" + (value / 10000000).toFixed(0) + " Cr";
}
function dateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : value;
}
function plainPct(value: number | null): string { return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2) + "%"; }
function actionName(action: Action): string {
  return action === "INSUFFICIENT_DATA" ? "Not enough data" : action === "BUY" ? "Buy / accumulate" : action === "SELL" ? "Sell / review thesis" : "Hold / monitor";
}
type MetricTone = "positive" | "negative" | "neutral";
type MetricSignal = { tone: MetricTone; status: string };
function higherIsBetter(value: number | null, goodAt: number, weakBelow: number): MetricSignal {
  if (value === null || !Number.isFinite(value)) return { tone: "neutral", status: "NO DATA" };
  if (value >= goodAt) return { tone: "positive", status: "GOOD" };
  if (value < weakBelow) return { tone: "negative", status: "WEAK" };
  return { tone: "neutral", status: "MIXED" };
}
function lowerIsBetter(value: number | null, goodAtMost: number, neutralAtMost: number): MetricSignal {
  if (value === null || !Number.isFinite(value)) return { tone: "neutral", status: "NO DATA" };
  if (value <= 0) return { tone: "negative", status: "LOSS / N.M." };
  if (value <= goodAtMost) return { tone: "positive", status: "LOWER MULTIPLE" };
  if (value <= neutralAtMost) return { tone: "neutral", status: "MIXED" };
  return { tone: "negative", status: "RICH MULTIPLE" };
}
function returnSignal(value: number | null): MetricSignal {
  if (value === null || !Number.isFinite(value)) return { tone: "neutral", status: "NO DATA" };
  if (value > 0) return { tone: "positive", status: "POSITIVE" };
  if (value < 0) return { tone: "negative", status: "NEGATIVE" };
  return { tone: "neutral", status: "FLAT" };
}
function drawdownSignal(value: number | null): MetricSignal {
  if (value === null || !Number.isFinite(value)) return { tone: "neutral", status: "NO DATA" };
  if (value >= -15) return { tone: "positive", status: "MORE MODEST" };
  if (value >= -30) return { tone: "neutral", status: "ELEVATED" };
  return { tone: "negative", status: "DEEP DRAWDOWN" };
}
function MetricCard(props: { label: string; value: string; detail: string; tone?: MetricTone; status?: string }) {
  const tone = props.tone ?? "neutral";
  const status = props.status ?? (tone === "positive" ? "GOOD" : tone === "negative" ? "WEAK" : "CONTEXT");
  return <article className={"lt-metric-card lt-metric-card-" + tone}>
    <div className="lt-metric-label"><span>{props.label}</span><strong className={"lt-metric-status lt-metric-status-" + tone}>{status}</strong></div>
    <strong className={"lt-metric-value lt-" + tone}>{props.value}</strong>
    <p>{props.detail}</p>
  </article>;
}
function sourceLink(name: string, url: string) {
  return <a key={name} href={url} target="_blank" rel="noreferrer">{name} ↗</a>;
}
function sentimentClass(value: number | null): string {
  return value === null || value === 0 ? "lt-neutral" : value > 0 ? "lt-positive" : "lt-negative";
}

type DeskTab = "research" | "institutional";
type LongTermInvestorDeskProps = { initialTab?: DeskTab; initialSymbol?: string; showTabs?: boolean; onNavigateStock?: (symbol: string) => void };
export default function LongTermInvestorDesk({ initialTab = "research", initialSymbol = "RELIANCE", showTabs = true, onNavigateStock }: LongTermInvestorDeskProps) {
  const [tab, setTab] = useState<DeskTab>(initialTab);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [research, setResearch] = useState<ResearchResponse | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [activitySymbol, setActivitySymbol] = useState("RELIANCE");
  const [activitySearch, setActivitySearch] = useState("");
  const [minimumDealCrore, setMinimumDealCrore] = useState("1");

  async function loadResearch(raw = symbol) {
    const next = raw.trim().toUpperCase().replace(/\.NS$/, "");
    if (!/^[A-Z0-9&-]{1,20}$/.test(next)) {
      setResearchError("Enter a valid NSE ticker, such as RELIANCE, HDFCBANK or INFY.");
      return;
    }
    setSymbol(next);
    setResearchBusy(true);
    setResearchError(null);
    try {
      const response = await fetch("/api/stock-research?symbol=" + encodeURIComponent(next), { headers: { accept: "application/json" } });
      const payload = await response.json() as ResearchResponse & { error?: string; detail?: string };
      if (!response.ok) throw new Error([payload.error, payload.detail].filter(Boolean).join(" "));
      setResearch(payload);
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Stock research could not be loaded.");
      setResearch(null);
    } finally {
      setResearchBusy(false);
    }
  }

  async function loadActivity(nextDays = days, nextSymbol = activitySymbol) {
    setActivityBusy(true);
    setActivityError(null);
    try {
      const query = new URLSearchParams({ days: String(nextDays) });
      const cleanSymbol = nextSymbol.trim().toUpperCase().replace(/\.NS$/, "");
      if (cleanSymbol && /^[A-Z0-9&-]{1,20}$/.test(cleanSymbol)) query.set("symbol", cleanSymbol);
      const response = await fetch("/api/institutional-activity?" + query.toString(), { headers: { accept: "application/json" } });
      const payload = await response.json() as ActivityResponse;
      if (!response.ok) throw new Error([payload.error, payload.detail, payload.hint].filter(Boolean).join(" "));
      setActivity(payload);
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : "Institutional activity could not be loaded.");
      setActivity(null);
    } finally {
      setActivityBusy(false);
    }
  }

  useEffect(() => {
    if (initialTab === "research") void loadResearch(initialSymbol);
    else void loadActivity(days, activitySymbol);
    // This component is remounted when the focused page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const filteredDeals = useMemo(() => {
    const needle = activitySearch.trim().toLowerCase();
    const minimum = Math.max(0, Number(minimumDealCrore) || 0);
    return (activity?.deals ?? []).filter((deal) => deal.valueCrore >= minimum)
      .filter((deal) => !needle || deal.clientName.toLowerCase().includes(needle) || deal.symbol.toLowerCase().includes(needle) || deal.company.toLowerCase().includes(needle))
      .slice(0, 100);
  }, [activity, activitySearch, minimumDealCrore]);
  const filteredMoves = useMemo(() => {
    const needle = activitySearch.trim().toLowerCase();
    return (activity?.entityMoves ?? []).filter((move) => !needle || move.clientName.toLowerCase().includes(needle) || move.symbol.toLowerCase().includes(needle) || move.company.toLowerCase().includes(needle));
  }, [activity, activitySearch]);
  const entryPlan = useMemo(
    () => research ? planLongTermEntry(research.price, research.metrics.sma50, research.metrics.sma200, research.metrics.rsi14) : null,
    [research]
  );

  function openStockFromActivity(next: string) {
    if (!showTabs && onNavigateStock) { onNavigateStock(next); return; }
    setSymbol(next);
    setActivitySymbol(next);
    setTab("research");
    void loadResearch(next);
  }

  return <section id="long-term-desk" className="long-term-desk" aria-labelledby="long-term-title">
    <div className="lt-heading">
      <div>
        <div className="section-kicker">LONG-HORIZON INVESTING / RESEARCH DESK</div>
        <h2 id="long-term-title">Own the business, not the daily noise.</h2>
        <p>Research a stock’s business metrics and valuation, then cross-check disclosed large transactions and institutional flows. Data gaps stay visible; nothing is invented to force a Buy call.</p>
      </div>
      <div className="lt-heading-stamp"><span>LONG TERM</span><strong>01–05Y</strong><small>NSE · public data</small></div>
    </div>

    {showTabs && <div id="long-term-tabs" className="lt-tabs" role="tablist" aria-label="Long-term investing tools">
      <button type="button" role="tab" aria-selected={tab === "research"} className={tab === "research" ? "active" : ""} onClick={() => setTab("research")}>
        <span className="lt-tab-num">01</span><span><strong>Stock research</strong><small>Fundamentals · valuation · analyst views</small></span>
      </button>
      <button type="button" role="tab" aria-selected={tab === "institutional"} className={tab === "institutional" ? "active" : ""} onClick={() => { setTab("institutional"); if (!activity && !activityBusy) void loadActivity(days, activitySymbol); }}>
        <span className="lt-tab-num">02</span><span><strong>Institutional activity</strong><small>Large deals · FII/DII flows · disclosures</small></span>
      </button>
    </div>}

    {tab === "research" ? <div className="lt-panel" role="tabpanel" aria-label="Stock research">
      <form className="lt-search-form" onSubmit={(event) => { event.preventDefault(); void loadResearch(); }}>
        <label className="lt-search-field"><span>SEARCH AN NSE STOCK</span><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="e.g. RELIANCE, INFY, HDFCBANK" list="lt-stock-suggestions" autoComplete="off" /></label>
        <datalist id="lt-stock-suggestions">{stocks.map((stock) => <option key={stock.fullSymbol} value={stock.symbol}>{stock.name}</option>)}</datalist>
        <button className="lt-primary-btn" type="submit" disabled={researchBusy}>{researchBusy ? <><span className="spinner" /> Researching…</> : "Research stock ↗"}</button>
        <button className="lt-ghost-btn" type="button" onClick={() => void loadResearch(symbol)} disabled={researchBusy} aria-label="Refresh stock research">↻</button>
      </form>
      <div className="lt-stock-shortcuts" aria-label="Popular stocks">
        <span>QUICK LOOK</span>
        {stocks.slice(0, 8).map((stock) => <button key={stock.fullSymbol} type="button" className={symbol === stock.symbol ? "active" : ""} onClick={() => void loadResearch(stock.symbol)}>{stock.symbol}</button>)}
      </div>
      {researchError && <div className="lt-error"><strong>Research feed unavailable</strong><span>{researchError}</span><button type="button" onClick={() => void loadResearch(symbol)}>Retry</button></div>}
      {researchBusy && !research && <div className="lt-loading"><span className="spinner" /> Loading price history, fundamentals and public analyst data…</div>}
      {research && <>
        <div className="lt-stock-hero">
          <div className="lt-stock-identity">
            <div className="lt-ticker">{research.symbol.replace(/\.NS$/, "")}</div>
            <div><h3>{research.name}</h3><p>{[research.sector, research.industry].filter(Boolean).join(" · ") || "NSE equity"} · {research.currency}</p></div>
          </div>
          <div className="lt-current-price"><small>LAST COMPLETED DAILY CLOSE</small><strong>{inr(research.price)}</strong><span>As of {dateLabel(research.asOf)}</span></div>
          <div className={"lt-decision lt-decision-" + research.assessment.action.toLowerCase().replaceAll("_", "-")}>
            <small>LONG-TERM SCREEN</small><strong>{research.assessment.action === "BUY" && entryPlan && entryPlan.status !== "IN_ZONE" ? "BUY CANDIDATE · WAIT FOR ENTRY" : actionName(research.assessment.action)}</strong>
            <span>{research.assessment.confidence.replaceAll("_", " ")} confidence · score {research.assessment.score > 0 ? "+" : ""}{research.assessment.score}</span>
          </div>
        </div>
        <div className="lt-assessment-summary"><strong>What the screen says</strong><p>{research.assessment.summary}</p><span>Evidence available: {research.assessment.availableFactors} / {research.assessment.totalFactors} factors · {research.dataQuality.completedDailyCandles} completed daily candles.</span></div>
        {entryPlan && <section className={"lt-entry-plan lt-entry-plan-" + entryPlan.status.toLowerCase().replaceAll("_", "-")} aria-label="Long-term entry timing">
          <div className="lt-entry-plan-header">
            <div><span className="section-kicker">ENTRY TIMING / COMPLETED DAILY DATA</span><h3>Suggested long-term entry zone</h3><p>Technical watch zone only. Business quality, valuation and filings must still support the thesis.</p></div>
            <span className="lt-entry-status">{entryPlan.status.replaceAll("_", " ")}</span>
          </div>
          <div className="lt-entry-zone-main">
            <div><small>LOWER WATCH LEVEL</small><strong>{inr(entryPlan.low)}</strong></div>
            <span className="lt-entry-zone-separator">TO</span>
            <div><small>UPPER WATCH LEVEL</small><strong>{inr(entryPlan.high)}</strong></div>
          </div>
          <div className="lt-entry-timing-grid">
            <div><span>Current close</span><strong>{inr(research.price)}</strong></div>
            <div><span>50-day average</span><strong>{inr(research.metrics.sma50)}</strong></div>
            <div><span>200-day average</span><strong>{inr(research.metrics.sma200)}</strong></div>
            <div><span>RSI (14)</span><strong>{research.metrics.rsi14 === null ? "—" : research.metrics.rsi14.toFixed(1)}</strong></div>
            <div><span>Distance from 200D</span><strong>{pct(entryPlan.distanceFrom200Pct)}</strong></div>
          </div>
          <p className="lt-entry-plan-message">{entryPlan.message}</p>
          <small className="lt-entry-plan-caveat">The zone is calculated from 50D/200D moving averages and RSI—not intrinsic value. Consider staged entries rather than investing the full amount at once; stop and re-evaluate if the business thesis or data changes.</small>
        </section>}
        <div className="lt-factor-grid">
          {research.assessment.factors.map((factor) => <article className="lt-factor" key={factor.key}>
            <div><span className="lt-factor-dot" data-score={factor.score === null ? "na" : factor.score > 0 ? "positive" : factor.score < 0 ? "negative" : "neutral"}></span><strong>{factor.label}</strong></div>
            <p>{factor.finding}</p>
            <span className={"lt-factor-score " + (factor.score === null ? "lt-neutral" : factor.score > 0 ? "lt-positive" : factor.score < 0 ? "lt-negative" : "lt-neutral")}>{factor.score === null ? "NOT SCORED" : factor.score > 0 ? "SUPPORTIVE" : factor.score < 0 ? "WEAK" : "MIXED"}</span>
          </article>)}
        </div>
        <div className="lt-subheading"><div><span className="section-kicker">BUSINESS AND VALUATION</span><h3>Fundamentals at a glance</h3></div><small>Missing fields display as —</small></div>
        <div className="lt-metric-grid">
          <MetricCard label="MARKET CAPITALISATION" value={marketCap(research.metrics.marketCap)} detail="Company size in listed equity value; size alone is not good or bad." status="CONTEXT ONLY" />
          <MetricCard label="TRAILING P/E" value={research.metrics.trailingPe === null ? "—" : n.format(research.metrics.trailingPe) + "×"} detail="A broad valuation screen: lower is not automatically better; compare with growth, sector and the stock's own history." {...lowerIsBetter(research.metrics.trailingPe, 20, 35)} />
          <MetricCard label="FORWARD P/E" value={research.metrics.forwardPe === null ? "—" : n.format(research.metrics.forwardPe) + "×"} detail="Uses analyst estimates, which can be wrong or revised. Compare with growth and sector peers." {...lowerIsBetter(research.metrics.forwardPe, 20, 35)} />
          <MetricCard label="PRICE / BOOK" value={research.metrics.priceToBook === null ? "—" : n.format(research.metrics.priceToBook) + "×"} detail="Lower can be attractive in some sectors; asset-light companies may naturally trade higher." {...lowerIsBetter(research.metrics.priceToBook, 3, 6)} />
          <MetricCard label="RETURN ON EQUITY" value={plainPct(research.metrics.roePct)} detail="General screen: 15%+ is strong, 5–15% mixed, below 5% weak. Sector context matters." {...higherIsBetter(research.metrics.roePct, 15, 5)} />
          <MetricCard label="PROFIT MARGIN" value={plainPct(research.metrics.profitMarginPct)} detail="General screen: 15%+ is strong, 5–15% mixed, below 5% weak." {...higherIsBetter(research.metrics.profitMarginPct, 15, 5)} />
          <MetricCard label="REVENUE GROWTH" value={plainPct(research.metrics.revenueGrowthPct)} detail="Latest public year-on-year reading; positive growth below 10% is labelled mixed." {...higherIsBetter(research.metrics.revenueGrowthPct, 10, 0)} />
          <MetricCard label="EARNINGS GROWTH" value={plainPct(research.metrics.earningsGrowthPct)} detail="Latest public year-on-year reading; earnings can be volatile due to one-offs." {...higherIsBetter(research.metrics.earningsGrowthPct, 10, 0)} />
          <MetricCard label="DEBT / EQUITY" value={plainPct(research.metrics.debtToEquityPct)} detail={/bank|financial|insurance|credit|capital market/i.test((research.sector ?? "") + " " + (research.industry ?? "")) ? "Financial-company leverage is structurally different; do not compare directly with non-financial firms." : "Lower leverage can improve resilience; very high leverage deserves scrutiny."} tone={/bank|financial|insurance|credit|capital market/i.test((research.sector ?? "") + " " + (research.industry ?? "")) ? "neutral" : research.metrics.debtToEquityPct === null ? "neutral" : research.metrics.debtToEquityPct < 60 ? "positive" : research.metrics.debtToEquityPct > 150 ? "negative" : "neutral"} status={/bank|financial|insurance|credit|capital market/i.test((research.sector ?? "") + " " + (research.industry ?? "")) ? "SECTOR CONTEXT" : research.metrics.debtToEquityPct === null ? "NO DATA" : research.metrics.debtToEquityPct < 60 ? "LOWER LEVERAGE" : research.metrics.debtToEquityPct > 150 ? "HIGH LEVERAGE" : "MIXED"} />
          <MetricCard label="DIVIDEND YIELD" value={plainPct(research.metrics.dividendYieldPct)} detail="A low yield is not necessarily bad for a growth company; verify actual declared dividends." tone={research.metrics.dividendYieldPct !== null && research.metrics.dividendYieldPct >= 3 ? "positive" : "neutral"} status={research.metrics.dividendYieldPct === null ? "NO DATA" : research.metrics.dividendYieldPct >= 3 ? "INCOME" : research.metrics.dividendYieldPct >= 1 ? "MODEST" : "LOW / OPTIONAL"} />
        </div>
        <div className="lt-subheading"><div><span className="section-kicker">HISTORICAL PRICE CONTEXT</span><h3>Returns and range</h3></div><small>Adjusted for dividends where Yahoo reports adjusted closes.</small></div>
        <div className="lt-metric-grid lt-returns-grid">
          <MetricCard label="1-YEAR RETURN" value={pct(research.metrics.return1yPct)} detail="Adjusted price performance over roughly one year; past return does not predict future results." {...returnSignal(research.metrics.return1yPct)} />
          <MetricCard label="3-YEAR RETURN" value={pct(research.metrics.return3yPct)} detail="Longer-horizon performance, not a forecast." {...returnSignal(research.metrics.return3yPct)} />
          <MetricCard label="5-YEAR RETURN" value={pct(research.metrics.return5yPct)} detail="Long-range result; past performance is not a guarantee." {...returnSignal(research.metrics.return5yPct)} />
          <MetricCard label="MAX 1-YEAR DRAWDOWN" value={pct(research.metrics.maxDrawdownPct)} detail="Largest peak-to-trough fall within the observed year. A deeper drawdown means more historical downside." {...drawdownSignal(research.metrics.maxDrawdownPct)} />
          <MetricCard label="52-WEEK LOW" value={inr(research.metrics.yearLow)} detail="Observed trailing range low. Being near a low can mean value or worsening fundamentals." status="PRICE CONTEXT" />
          <MetricCard label="52-WEEK HIGH" value={inr(research.metrics.yearHigh)} detail="Observed trailing range high. Being near a high is not automatically good or bad." status="PRICE CONTEXT" />
        </div>
        <div className="lt-subheading"><div><span className="section-kicker">BROKER / ANALYST VIEW</span><h3>Published ratings</h3></div><small>Third-party analyst data can lag and does not guarantee results.</small></div>
        {research.analystConsensus ? <div className="lt-analyst-summary">
          <div className="lt-analyst-key"><small>CONSENSUS LABEL</small><strong>{research.metrics.analystRatingKey ? research.metrics.analystRatingKey.replaceAll("_", " ").toUpperCase() : "No consensus label"}</strong><span>Rating period: {research.analystConsensus.period}</span></div>
          {[
            ["STRONG BUY", research.analystConsensus.strongBuy],
            ["BUY", research.analystConsensus.buy],
            ["HOLD", research.analystConsensus.hold],
            ["SELL", research.analystConsensus.sell],
            ["STRONG SELL", research.analystConsensus.strongSell]
          ].map(([label, count]) => <div className="lt-rating-count" key={String(label)}><span>{label}</span><strong>{count}</strong></div>)}
          <div className="lt-target-range"><small>ANALYST PRICE TARGETS</small><strong>{inr(research.metrics.targetMeanPrice)}</strong><span>Low {inr(research.metrics.targetLowPrice)} · High {inr(research.metrics.targetHighPrice)}</span></div>
        </div> : <div className="lt-empty"><strong>Analyst consensus unavailable for this symbol.</strong><p>The feed did not publish current consensus counts. Open the source link to verify ratings directly; none are inferred.</p></div>}
        {research.brokerHistory.length ? <div className="lt-table-wrap"><table className="lt-table">
          <thead><tr><th>Broker / research firm</th><th>Action</th><th>Previous view</th><th>Published view</th><th>Date</th></tr></thead>
          <tbody>{research.brokerHistory.map((row, index) => <tr key={row.firm + row.date + index}>
            <td>{row.firm}</td><td>{row.action}</td><td>{row.fromGrade ?? "—"}</td><td><strong>{row.toGrade ?? "—"}</strong></td><td>{dateLabel(row.date)}</td>
          </tr>)}</tbody>
        </table></div> : <div className="lt-empty"><strong>No named-broker rating history returned.</strong><p>That is a data limitation, not a negative rating. Check the published analyst page for any available coverage.</p></div>}
        <div className="lt-source-row">{research.sources.map((source) => sourceLink(source.name, source.url))}</div>
        <div className="lt-data-note"><strong>Source / freshness</strong><p>{research.source}. Data as of {dateLabel(research.asOf)}; retrieved {dateLabel(research.generatedAt)}. {research.dataQuality.note}</p><p>This is a transparent screening aid, not personalised investment advice. Sector-adjust ratios, review annual reports and quarterly filings, and do not buy/sell on this score alone.</p></div>
      </>}
    </div> : <div className="lt-panel" role="tabpanel" aria-label="Institutional activity">
      <form className="lt-activity-controls" onSubmit={(event) => { event.preventDefault(); void loadActivity(days, activitySymbol); }}>
        <label className="lt-search-field"><span>OWNERSHIP DISCLOSURE FOR STOCK</span><input value={activitySymbol} onChange={(event) => setActivitySymbol(event.target.value.toUpperCase())} placeholder="e.g. RELIANCE" /></label>
        <label className="lt-search-field lt-days-select"><span>DEAL LOOKBACK</span><select value={String(days)} onChange={(event) => setDays(Number(event.target.value))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="60">Last 60 days</option><option value="90">Last 90 days</option></select></label>
        <button className="lt-primary-btn" type="submit" disabled={activityBusy}>{activityBusy ? <><span className="spinner" /> Loading disclosures…</> : "Refresh institutional data ↻"}</button>
      </form>
      <div className="lt-activity-search">
        <label className="lt-search-field"><span>FIND AN INVESTOR OR STOCK</span><input value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder="Investor name, ticker or company…" /></label>
        <label className="lt-search-field lt-days-select"><span>MINIMUM DEAL VALUE</span><select value={minimumDealCrore} onChange={(event) => setMinimumDealCrore(event.target.value)}><option value="0">Any disclosed value</option><option value="1">₹1 Cr+</option><option value="5">₹5 Cr+</option><option value="10">₹10 Cr+</option><option value="25">₹25 Cr+</option><option value="100">₹100 Cr+</option></select></label>
      </div>
      {activityError && <div className="lt-error"><strong>NSE disclosure feed unavailable</strong><span>{activityError}</span><a href={activity?.sources.deals ?? "https://www.nseindia.com/report-detail/display-bulk-and-block-deals"} target="_blank" rel="noreferrer">Open official NSE deals page ↗</a></div>}
      {activityBusy && !activity && <div className="lt-loading"><span className="spinner" /> Requesting public NSE disclosures…</div>}
      {activity && <>
        <div className="lt-subheading lt-flow-heading"><div><span className="section-kicker">MARKET-WIDE INSTITUTIONAL FLOWS</span><h3>FII / FPI and DII activity</h3></div><small>Latest available NSE report · These are market-wide, not stock-specific flows.</small></div>
        <div className="lt-flow-grid">
          {(activity.flows.length ? activity.flows : [{ category: "FII/FPI", date: null, buyCrore: null, sellCrore: null, netCrore: null }, { category: "DII", date: null, buyCrore: null, sellCrore: null, netCrore: null }]).map((flow) => <article className="lt-flow-card" key={flow.category}>
            <div className="lt-flow-top"><span>{flow.category}</span><small>{dateLabel(flow.date)}</small></div>
            <strong className={sentimentClass(flow.netCrore)}>{signedCrore(flow.netCrore)}</strong>
            <div className="lt-flow-values"><span>Buy <b>{signedCrore(flow.buyCrore)}</b></span><span>Sell <b>{signedCrore(flow.sellCrore)}</b></span></div>
            <p>{flow.netCrore === null ? "Net flow not available." : flow.netCrore > 0 ? "Net buying in the reported market segment." : flow.netCrore < 0 ? "Net selling in the reported market segment." : "Reported buying and selling are balanced."}</p>
          </article>)}
        </div>
        <div className="lt-subheading"><div><span className="section-kicker">DISCLOSED LARGE TRANSACTIONS</span><h3>Who bought or sold what?</h3></div><small>{filteredDeals.length} rows shown · Value is quantity × disclosed price.</small></div>
        {filteredDeals.length ? <div className="lt-table-wrap"><table className="lt-table lt-deal-table">
          <thead><tr><th>Date</th><th>Stock</th><th>Client / reported institution</th><th>Type</th><th>Side</th><th>Quantity</th><th>Price</th><th>Value</th></tr></thead>
          <tbody>{filteredDeals.map((deal, index) => <tr key={deal.symbol + deal.clientName + deal.date + index}>
            <td>{dateLabel(deal.date)}</td><td><button type="button" className="lt-ticker-link" onClick={() => openStockFromActivity(deal.symbol)}>{deal.symbol}</button><small className="lt-company-name">{deal.company}</small></td><td><strong>{deal.clientName}</strong></td><td><span className="lt-deal-type">{deal.dealType}</span></td><td><span className={"lt-side lt-" + deal.side.toLowerCase()}>{deal.side}</span></td><td>{i0.format(deal.quantity)}</td><td>{inr(deal.price)}</td><td><strong>₹{n.format(deal.valueCrore)} Cr</strong></td>
          </tr>)}</tbody>
        </table></div> : <div className="lt-empty"><strong>No disclosed deals match these filters.</strong><p>Try a smaller minimum deal value, a longer lookback, or search another client/stock. An empty result is valid; the app does not fabricate transactions.</p></div>}
        <div className="lt-subheading"><div><span className="section-kicker">OBSERVED BUYING / SELLING</span><h3>Net activity by client and stock</h3></div><small>Aggregated only within this selected date window.</small></div>
        {filteredMoves.length ? <div className="lt-table-wrap"><table className="lt-table">
          <thead><tr><th>Client / institution</th><th>Stock</th><th>Buys</th><th>Sells</th><th>Net disclosed value</th><th>Window clue</th></tr></thead>
          <tbody>{filteredMoves.slice(0, 40).map((move, index) => <tr key={move.clientName + move.symbol + index}>
            <td><strong>{move.clientName}</strong><small className="lt-company-name">{move.count} disclosed deals</small></td><td><button type="button" className="lt-ticker-link" onClick={() => openStockFromActivity(move.symbol)}>{move.symbol}</button></td>
            <td>₹{n.format(move.buys)} Cr</td><td>₹{n.format(move.sells)} Cr</td><td className={move.netBuyCrore > 0 ? "lt-positive" : move.netBuyCrore < 0 ? "lt-negative" : "lt-neutral"}><strong>{signedCrore(move.netBuyCrore)}</strong><small className="lt-company-name">{move.observedDirection}</small></td>
            <td><div className="lt-window-clues">{move.firstBuyDate && <span className="lt-side lt-buy">Buy reported from {dateLabel(move.firstBuyDate)}</span>}{move.firstSellDate && <span className="lt-side lt-sell">Sell reported from {dateLabel(move.firstSellDate)}</span>}{!move.firstBuyDate && !move.firstSellDate && "—"}</div></td>
          </tr>)}</tbody>
        </table></div> : <div className="lt-empty"><strong>No institution/client moves match the search.</strong></div>}
        <div className="lt-subheading"><div><span className="section-kicker">QUARTERLY OWNERSHIP CHANGE</span><h3>{(activity.ownershipSymbol ?? activitySymbol).toUpperCase().replace(/\.NS$/, "")} shareholding trail</h3></div><small>Latest exchange-filed summary rows.</small></div>
        {activity.shareholding.length ? <div className="lt-table-wrap"><table className="lt-table">
          <thead><tr><th>As of</th><th>Promoter group</th><th>Change QoQ</th><th>Public shareholding</th><th>Change QoQ</th><th>Official filing</th></tr></thead>
          <tbody>{activity.shareholding.map((row) => <tr key={row.symbol + row.date}>
            <td><strong>{dateLabel(row.date)}</strong><small className="lt-company-name">{row.name}</small></td>
            <td>{pct(row.promoterPct)}</td><td className={sentimentClass(row.promoterChangePp)}>{row.promoterChangePp === null ? "—" : (row.promoterChangePp > 0 ? "+" : "") + row.promoterChangePp.toFixed(2) + " pp"}</td>
            <td>{pct(row.publicPct)}</td><td className={sentimentClass(row.publicChangePp)}>{row.publicChangePp === null ? "—" : (row.publicChangePp > 0 ? "+" : "") + row.publicChangePp.toFixed(2) + " pp"}</td>
            <td>{row.filingUrl ? <a href={row.filingUrl} target="_blank" rel="noreferrer">View XBRL filing ↗</a> : <a href={activity.sources.shareholding + "?symbol=" + encodeURIComponent(row.symbol)} target="_blank" rel="noreferrer">View NSE filings ↗</a>}</td>
          </tr>)}</tbody>
        </table></div> : <div className="lt-empty"><strong>Quarterly shareholding summary unavailable for {activitySymbol || "this stock"}.</strong><p>Search the official NSE shareholding pattern page directly. The summary feed reports promoter/public totals; the linked filing provides the detailed holder categories.</p><a href={activity.sources.shareholding + "?symbol=" + encodeURIComponent(activitySymbol.toUpperCase().replace(/\.NS$/, ""))} target="_blank" rel="noreferrer">Open official shareholding disclosures ↗</a></div>}
        <div className="lt-source-row">{sourceLink("NSE bulk / block deals", activity.sources.deals)}{sourceLink("NSE shareholding filings", activity.sources.shareholding)}{sourceLink("NSE FII / DII flows", activity.sources.fiiDii)}</div>
        {activity.warnings.map((warning) => <div className="lt-warning" key={warning}>{warning}</div>)}
        <div className="lt-data-note"><strong>How to interpret this tab</strong><ul>{activity.notes.map((note) => <li key={note}>{note}</li>)}</ul><p>“First buy observed” only means the earliest buy record in the selected window. It must not be described as a confirmed fresh entry unless filings or earlier holding data support that conclusion. The NSE public feed can be delayed or temporarily throttled.</p></div>
      </>}
    </div>}
  </section>;
}
