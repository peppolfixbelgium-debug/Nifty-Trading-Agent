import { useEffect, useMemo, useState } from "react";
import { UNIVERSE } from "../lib/universe.js";

type Tab = "research" | "institutions";
type MetricSet = {
  latestPrice: number; previousPrice: number | null; dailyChangePct: number | null;
  oneYearReturnPct: number | null; threeYearCagrPct: number | null; fiveYearCagrPct: number | null;
  sma50: number | null; sma200: number | null; distanceFromSma200Pct: number | null;
  high52Week: number | null; low52Week: number | null; drawdownFromHighPct: number | null;
  maxDrawdownPct: number | null; annualizedVolatilityPct: number | null; rsi14: number | null; candleCount: number;
};
type Fundamentals = {
  companyName: string | null; currency: string | null; marketCap: number | null;
  trailingPE: number | null; forwardPE: number | null; priceToBook: number | null; dividendYieldPct: number | null;
  returnOnEquityPct: number | null; profitMarginPct: number | null; revenueGrowthPct: number | null;
  earningsGrowthPct: number | null; debtToEquityPct: number | null; totalCash: number | null; totalDebt: number | null;
};
type BrokerRating = { firm: string; action: string | null; fromGrade: string | null; toGrade: string | null; priceTarget: number | null; priorPriceTarget: number | null; publishedAt: string | null };
type AnalystData = {
  recommendation: string | null; totalAnalysts: number | null;
  counts: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  meanTargetPrice: number | null; lowTargetPrice: number | null; highTargetPrice: number | null; impliedUpsidePct: number | null;
  brokerRatings: BrokerRating[]; source: string;
};
type ResearchResponse = {
  symbol: string; name: string; generatedAt: string; source: string; cached: boolean; metrics: MetricSet;
  fundamentals: Fundamentals | null; analysts: AnalystData | null; warnings: string[];
};
type Deal = {
  type: "BULK" | "BLOCK"; symbol: string | null; securityName: string | null; clientName: string | null;
  side: string; quantity: number | null; price: number | null; notional: number | null; date: string | null;
  remarks: string | null; sourceUrl: string; firstReportedBuyInWindow: boolean;
};
type Shareholding = { symbol: string; companyName: string | null; asOf: string | null; submittedAt: string | null; promoterPct: number | null; publicPct: number | null; employeeTrustPct: number | null; filingUrl: string };
type ActivityResponse = {
  generatedAt: string; period: { from: string; to: string; days: number }; symbol: string; deals: Deal[];
  shareholding: Shareholding[]; summary: { reportedDeals: number; buyDeals: number; sellDeals: number; buyNotional: number; sellNotional: number; firstReportedBuysInWindow: number };
  warnings: string[]; sources: { deals: string; shareholding: string }; note: string; cached?: boolean;
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const compactInr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const pct = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? "—" : (value > 0 ? "+" : "") + value.toFixed(digits) + "%";
const value = (input: number | null | undefined, digits = 2) => input == null || !Number.isFinite(input) ? "—" : input.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const currency = (input: number | null | undefined) => input == null || !Number.isFinite(input) ? "—" : inr.format(input);
const moneyShort = (input: number | null | undefined) => input == null || !Number.isFinite(input) ? "—" : compactInr.format(input);
const prettyDate = (text: string | null | undefined) => text ? new Date(text).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const stockNames = UNIVERSE.map((stock) => ({ symbol: stock.symbol.replace(/\.NS$/, ""), name: stock.name }));

function symbolFromInput(input: string): string | null {
  const normal = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!normal) return null;
  const symbol = normal.endsWith(".NS") ? normal : normal + ".NS";
  return /^[A-Z0-9&^-]{1,18}\.NS$/.test(symbol) ? symbol : null;
}

function fundamentalsScore(f: Fundamentals | null) {
  if (!f) return { score: null as number | null, total: 4, label: "Data unavailable", tone: "neutral" };
  const tests = [
    f.returnOnEquityPct !== null ? f.returnOnEquityPct >= 15 : null,
    f.profitMarginPct !== null ? f.profitMarginPct >= 10 : null,
    f.revenueGrowthPct !== null ? f.revenueGrowthPct >= 8 : null,
    f.debtToEquityPct !== null ? f.debtToEquityPct <= 100 : null
  ].filter((result): result is boolean => result !== null);
  if (tests.length < 2) return { score: null, total: 4, label: "Partial data", tone: "neutral" };
  const score = tests.filter(Boolean).length;
  return { score, total: tests.length, label: score >= 3 ? "Healthy signals" : score === 2 ? "Mixed signals" : "Needs caution", tone: score >= 3 ? "good" : score === 2 ? "watch" : "weak" };
}

function longTermView(data: ResearchResponse | null) {
  if (!data) return null;
  const m = data.metrics;
  const quality = fundamentalsScore(data.fundamentals);
  if (m.sma200 === null || m.sma50 === null || m.candleCount < 200) {
    return { title: "Wait for more data", tone: "neutral", detail: "At least 200 completed daily candles are needed for a long-term trend assessment.", low: null as number | null, high: null as number | null, quality };
  }
  const trendGood = m.latestPrice > m.sma200 && m.sma50 > m.sma200;
  const trendWeak = m.latestPrice < m.sma200 && m.sma50 < m.sma200;
  const distance = m.distanceFromSma200Pct ?? 0;
  const fundamentalsWeak = quality.tone === "weak";
  let title = "Hold / wait for a better entry";
  let tone = "watch";
  let detail = "The long-term trend is not strong enough to justify chasing a new position. Review the business thesis and wait for a clearer setup.";
  let low: number | null = null;
  let high: number | null = null;
  if (trendGood && !fundamentalsWeak && distance <= 12) {
    title = "Accumulate gradually";
    tone = "good";
    detail = "The price is above its 200-day average and the 50-day average is above the 200-day average. Consider staged entries only if the business metrics fit your thesis.";
    low = m.sma200 * 0.98;
    high = m.sma200 * 1.05;
  } else if (trendGood && distance > 12) {
    title = "Wait for a pullback";
    tone = "watch";
    detail = "Price is extended above the 200-day average. Avoid chasing strength; a staged entry closer to the long-term trend may offer a better risk/reward.";
    low = m.sma200 * 1.02;
    high = m.sma200 * 1.08;
  } else if (trendWeak && fundamentalsWeak) {
    title = "Caution — review before adding";
    tone = "weak";
    detail = "Price and trend averages are below the long-term trend line, while available business-quality metrics are weak. Recheck the thesis before committing fresh capital.";
  } else if (trendWeak) {
    title = "Wait for trend recovery";
    tone = "weak";
    detail = "Price and 50-day trend are below the 200-day average. This rules-based view does not suggest a fresh entry; wait for price strength and reassess the business.";
  } else if (trendGood) {
    title = "Hold / staged entry only";
    tone = "watch";
    detail = "Price trend is constructive, but available fundamental indicators are mixed or incomplete. Avoid making a buy decision from price action alone.";
    low = m.sma200 * 0.98;
    high = m.sma200 * 1.05;
  }
  return { title, tone, detail, low, high, quality };
}

function MetricCard({ label, main, foot, tone = "neutral" }: { label: string; main: string; foot?: string; tone?: string }) {
  return <article className={"lt-metric-card tone-" + tone}><span>{label}</span><strong>{main}</strong>{foot && <small>{foot}</small>}</article>;
}

function SignalTag({ label, tone }: { label: string; tone: string }) {
  return <span className={"lt-signal-tag tone-" + tone}>{label}</span>;
}

export default function LongTermWorkspace() {
  const [tab, setTab] = useState<Tab>("research");
  const [query, setQuery] = useState("RELIANCE");
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [research, setResearch] = useState<ResearchResponse | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [activityFilter, setActivityFilter] = useState("ALL");
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityRefresh, setActivityRefresh] = useState(0);

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return stockNames.slice(0, 8);
    return stockNames.filter((stock) => stock.symbol.toLowerCase().includes(needle) || stock.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setResearchBusy(true);
    setResearchError(null);
    fetch("/api/long-term-research?symbol=" + encodeURIComponent(symbol) + (refresh ? "&refresh=1" : ""), { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ResearchResponse & { error?: string; detail?: string };
        if (!response.ok) throw new Error([body.error, body.detail].filter(Boolean).join(" "));
        return body;
      })
      .then((body) => { setResearch(body); setResearchError(null); })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setResearch(null);
        setResearchError(caught instanceof Error ? caught.message : "Could not load long-term research.");
      })
      .finally(() => { if (!controller.signal.aborted) setResearchBusy(false); });
    return () => controller.abort();
  }, [symbol, refresh]);

  useEffect(() => {
    if (tab !== "institutions") return;
    const controller = new AbortController();
    setActivityBusy(true);
    setActivityError(null);
    const params = new URLSearchParams({ symbol: activityFilter });
    if (activityRefresh) params.set("refresh", "1");
    fetch("/api/institutional-activity?" + params.toString(), { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ActivityResponse & { error?: string; detail?: string };
        if (!response.ok) throw new Error([body.error, body.detail].filter(Boolean).join(" "));
        return body;
      })
      .then((body) => { setActivity(body); setActivityError(null); })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setActivity(null);
        setActivityError(caught instanceof Error ? caught.message : "Could not load institutional activity.");
      })
      .finally(() => { if (!controller.signal.aborted) setActivityBusy(false); });
    return () => controller.abort();
  }, [tab, activityFilter, activityRefresh]);

  const stance = useMemo(() => longTermView(research), [research]);
  const f = research?.fundamentals ?? null;
  const m = research?.metrics;
  const analyst = research?.analysts ?? null;
  const countTotal = analyst?.counts ? Object.values(analyst.counts).reduce((sum, item) => sum + item, 0) : 0;
  const buyWeight = analyst?.counts ? analyst.counts.strongBuy + analyst.counts.buy : 0;
  const sellWeight = analyst?.counts ? analyst.counts.sell + analyst.counts.strongSell : 0;
  const brokerRows = analyst?.brokerRatings ?? [];
  const activityRows = activity?.deals ?? [];
  const maxDealValue = Math.max(1, ...activityRows.map((deal) => deal.notional ?? 0));
  const holdingRows = activity?.shareholding ?? [];

  function searchStock(nextQuery = query) {
    const normal = symbolFromInput(nextQuery);
    if (!normal) {
      setResearchError("Enter an NSE ticker (for example RELIANCE, HDFCBANK or M&M).");
      return;
    }
    setQuery(normal.replace(/\.NS$/, ""));
    setSymbol(normal);
    setSuggestionsOpen(false);
    setResearchError(null);
    setTab("research");
  }

  return <section className="lt-workspace" aria-label="Long-term investment workspace">
    <div className="lt-intro">
      <div>
        <div className="lt-eyebrow">INVESTOR DESK / INDIA EQUITIES</div>
        <h1>Invest with <em>conviction.</em></h1>
        <p>Business quality, long-term price context and disclosed large-deal activity—organised for patient investors, not intraday trading.</p>
      </div>
      <div className="lt-intro-stat"><small>RESEARCH HORIZON</small><strong>3–5 years</strong><span>Research, not orders</span></div>
    </div>

    <div className="lt-tabs" role="tablist" aria-label="Investment research sections">
      <button type="button" role="tab" aria-selected={tab === "research"} className={tab === "research" ? "active" : ""} onClick={() => setTab("research")}><span className="lt-tab-icon">↗</span><span><strong>Stock Research</strong><small>Metrics · entry view · brokers</small></span></button>
      <button type="button" role="tab" aria-selected={tab === "institutions"} className={tab === "institutions" ? "active" : ""} onClick={() => setTab("institutions")}><span className="lt-tab-icon">◎</span><span><strong>Institutional Activity</strong><small>Bulk/block deals · disclosures</small></span></button>
    </div>

    {tab === "research" && <div id="stock-research" className="lt-page" role="tabpanel">
      <div className="lt-page-heading">
        <div><div className="lt-section-label">01 / RESEARCH A STOCK</div><h2>Know the business before the price.</h2><p>Search a listed NSE ticker, review the fundamentals and get a transparent long-term entry view.</p></div>
        <button type="button" className="lt-refresh-button" disabled={researchBusy} onClick={() => setRefresh((previous) => previous + 1)}>{researchBusy ? "Refreshing…" : "↻ Refresh data"}</button>
      </div>
      <div className="lt-search-panel">
        <div className="lt-search-copy"><strong>Find a stock</strong><span>Current support: NSE-listed shares · type a company name or ticker</span></div>
        <div className="lt-search-combo">
          <span className="lt-search-icon">⌕</span>
          <input aria-label="Search NSE stock or ticker" value={query} onChange={(event) => { setQuery(event.target.value); setSuggestionsOpen(true); }} onFocus={() => setSuggestionsOpen(true)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchStock(); } if (event.key === "Escape") setSuggestionsOpen(false); }} placeholder="e.g. HDFC Bank, RELIANCE, INFY" />
          <button type="button" onClick={() => searchStock()}>Research stock</button>
          {suggestionsOpen && suggestions.length > 0 && <div className="lt-suggestions">{suggestions.map((stock) => <button type="button" key={stock.symbol} onClick={() => { setQuery(stock.symbol); searchStock(stock.symbol); }}><strong>{stock.symbol}</strong><span>{stock.name}</span><small>↗</small></button>)}<div className="lt-suggestion-hint">Type any NSE symbol and press Enter to search beyond the quick list.</div></div>}
        </div>
      </div>
      {researchError && <div className="lt-error"><strong>Research feed unavailable</strong><span>{researchError}</span></div>}
      {researchBusy && <div className="lt-loading"><span className="lt-spinner" /> Gathering daily history, fundamentals and analyst coverage…</div>}
      {!researchBusy && research && <>
        {research.warnings.length > 0 && <div className="lt-notice"><strong>Some metrics may be missing.</strong><span>{research.warnings.join(" ")}</span></div>}
        <div className="lt-stock-title">
          <div className="lt-stock-avatar">{research.symbol.replace(".NS", "").slice(0, 2)}</div>
          <div className="lt-stock-name"><span>{research.symbol.replace(".NS", "")} <span className="lt-market-pill">NSE</span></span><h3>{research.name}</h3><small>As of {new Date(research.generatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>
          <div className="lt-live-price"><small>LAST COMPLETED DAILY CLOSE</small><strong>{currency(m?.latestPrice)}</strong><span className={m?.dailyChangePct != null && m.dailyChangePct >= 0 ? "lt-positive" : "lt-negative"}>{pct(m?.dailyChangePct)} vs prior close</span></div>
        </div>

        <div className="lt-metric-grid">
          <MetricCard label="1-YEAR RETURN" main={pct(m?.oneYearReturnPct)} foot="Completed daily candles" tone={m?.oneYearReturnPct != null && m.oneYearReturnPct >= 0 ? "good" : "weak"} />
          <MetricCard label="3-YEAR CAGR" main={pct(m?.threeYearCagrPct)} foot="Annualised · where history permits" tone={m?.threeYearCagrPct != null && m.threeYearCagrPct >= 10 ? "good" : "watch"} />
          <MetricCard label="5-YEAR CAGR" main={pct(m?.fiveYearCagrPct)} foot="Weekly history · not guaranteed future" tone={m?.fiveYearCagrPct != null && m.fiveYearCagrPct >= 10 ? "good" : "watch"} />
          <MetricCard label="DISTANCE FROM 200-DMA" main={pct(m?.distanceFromSma200Pct)} foot="Long-term price trend" tone={m?.distanceFromSma200Pct != null && m.distanceFromSma200Pct >= 0 ? "good" : "weak"} />
        </div>

        <div className="lt-main-grid">
          <article className="lt-panel lt-verdict-panel">
            <div className="lt-panel-heading"><div><div className="lt-section-label">LONG-TERM RESEARCH VIEW</div><h3>Is this a sensible entry now?</h3></div>{stance && <SignalTag label={stance.title} tone={stance.tone} />}</div>
            <p className="lt-verdict-copy">{stance?.detail ?? "Waiting for enough verified history to prepare a research view."}</p>
            <div className="lt-entry-zone">
              <div><span>INDICATIVE TECHNICAL ENTRY ZONE</span><small>200-day average based · not intrinsic fair value</small></div>
              <strong>{stance?.low != null && stance.high != null ? currency(stance.low) + " – " + currency(stance.high) : "No fresh-entry zone"}</strong>
              {m?.sma200 != null && <small>200-DMA: {currency(m.sma200)} · current price is {pct(m.distanceFromSma200Pct)} from it</small>}
            </div>
            <div className="lt-steps-row">
              <div><b>01</b><strong>Start small</strong><span>Split entries into tranches instead of investing all at once.</span></div>
              <div><b>02</b><strong>Check fundamentals</strong><span>Never treat a price level as proof a business is undervalued.</span></div>
              <div><b>03</b><strong>Reassess the thesis</strong><span>Revisit earnings, debt, governance and material disclosures.</span></div>
            </div>
            <div className="lt-method-note">This is an explainable screening rule, not personalised investment advice. Entry levels are technical reference zones and do not estimate intrinsic value.</div>
          </article>

          <article className="lt-panel lt-quality-panel">
            <div className="lt-panel-heading"><div><div className="lt-section-label">BUSINESS METRICS</div><h3>Good or bad?</h3></div>{stance?.quality && <SignalTag label={stance.quality.label} tone={stance.quality.tone} />}</div>
            <p className="lt-muted-copy">Every status uses the threshold shown; missing values stay unavailable.</p>
            <div className="lt-metric-list">
              <div><span>Return on equity</span><strong>{f?.returnOnEquityPct == null ? "—" : value(f.returnOnEquityPct) + "%"}</strong><SignalTag label={f?.returnOnEquityPct == null ? "No data" : f.returnOnEquityPct >= 15 ? "Good · ≥15%" : f.returnOnEquityPct >= 8 ? "Watch · 8–15%" : "Weak · <8%"} tone={f?.returnOnEquityPct == null ? "neutral" : f.returnOnEquityPct >= 15 ? "good" : f.returnOnEquityPct >= 8 ? "watch" : "weak"} /></div>
              <div><span>Profit margin</span><strong>{f?.profitMarginPct == null ? "—" : value(f.profitMarginPct) + "%"}</strong><SignalTag label={f?.profitMarginPct == null ? "No data" : f.profitMarginPct >= 10 ? "Good · ≥10%" : f.profitMarginPct >= 5 ? "Watch · 5–10%" : "Weak · <5%"} tone={f?.profitMarginPct == null ? "neutral" : f.profitMarginPct >= 10 ? "good" : f.profitMarginPct >= 5 ? "watch" : "weak"} /></div>
              <div><span>Revenue growth</span><strong>{f?.revenueGrowthPct == null ? "—" : pct(f.revenueGrowthPct)}</strong><SignalTag label={f?.revenueGrowthPct == null ? "No data" : f.revenueGrowthPct >= 8 ? "Good · ≥8%" : f.revenueGrowthPct >= 0 ? "Watch" : "Weak · shrinking"} tone={f?.revenueGrowthPct == null ? "neutral" : f.revenueGrowthPct >= 8 ? "good" : f.revenueGrowthPct >= 0 ? "watch" : "weak"} /></div>
              <div><span>Debt / equity</span><strong>{f?.debtToEquityPct == null ? "—" : value(f.debtToEquityPct / 100) + "×"}</strong><SignalTag label={f?.debtToEquityPct == null ? "No data" : f.debtToEquityPct <= 50 ? "Good · ≤0.5×" : f.debtToEquityPct <= 100 ? "Watch · ≤1×" : "High debt"} tone={f?.debtToEquityPct == null ? "neutral" : f.debtToEquityPct <= 50 ? "good" : f.debtToEquityPct <= 100 ? "watch" : "weak"} /></div>
              <div><span>Trailing P/E</span><strong>{f?.trailingPE == null ? "—" : value(f.trailingPE) + "×"}</strong><SignalTag label={f?.trailingPE == null ? "No data" : "Compare within sector"} tone="neutral" /></div>
              <div><span>Dividend yield</span><strong>{f?.dividendYieldPct == null ? "—" : value(f.dividendYieldPct) + "%"}</strong><SignalTag label={f?.dividendYieldPct == null ? "No data" : f.dividendYieldPct > 0 ? "Income context" : "No yield reported"} tone="neutral" /></div>
            </div>
            <div className="lt-range-note"><span>52-week range</span><strong>{currency(m?.low52Week)} <i /> {currency(m?.high52Week)}</strong><small>Drawdown from 52-week high: {pct(m?.drawdownFromHighPct)}</small></div>
          </article>
        </div>

        <div className="lt-main-grid lt-second-grid">
          <article className="lt-panel lt-broker-panel">
            <div className="lt-panel-heading"><div><div className="lt-section-label">ANALYST / BROKER COVERAGE</div><h3>What are analysts saying?</h3></div><span className="lt-source-tag">Source: Yahoo Finance</span></div>
            {analyst?.counts && countTotal > 0 ? <>
              <div className="lt-consensus-head"><div><span>CONSENSUS</span><strong>{(analyst.recommendation ?? "Mixed").replaceAll("_", " ")}</strong><small>{analyst.totalAnalysts ?? countTotal} analyst opinions reported</small></div><div className="lt-target-box"><small>MEAN PRICE TARGET</small><strong>{currency(analyst.meanTargetPrice)}</strong><span className={(analyst.impliedUpsidePct ?? 0) >= 0 ? "lt-positive" : "lt-negative"}>{pct(analyst.impliedUpsidePct)} implied change</span></div></div>
              <div className="lt-rating-bar" aria-label="Analyst recommendation distribution">{analyst.counts.strongBuy > 0 && <span className="rating-strong-buy" style={{ width: (analyst.counts.strongBuy / countTotal * 100) + "%" }} />}{analyst.counts.buy > 0 && <span className="rating-buy" style={{ width: (analyst.counts.buy / countTotal * 100) + "%" }} />}{analyst.counts.hold > 0 && <span className="rating-hold" style={{ width: (analyst.counts.hold / countTotal * 100) + "%" }} />}{analyst.counts.sell > 0 && <span className="rating-sell" style={{ width: (analyst.counts.sell / countTotal * 100) + "%" }} />}{analyst.counts.strongSell > 0 && <span className="rating-strong-sell" style={{ width: (analyst.counts.strongSell / countTotal * 100) + "%" }} />}</div>
              <div className="lt-rating-legend"><span><i className="rating-strong-buy" /> Strong buy {analyst.counts.strongBuy}</span><span><i className="rating-buy" /> Buy {analyst.counts.buy}</span><span><i className="rating-hold" /> Hold {analyst.counts.hold}</span><span><i className="rating-sell" /> Sell {analyst.counts.sell}</span><span><i className="rating-strong-sell" /> Strong sell {analyst.counts.strongSell}</span></div>
            </> : <div className="lt-empty"><strong>Broker consensus not available</strong><span>This symbol has no analyst counts in the free feed, or Yahoo Finance has temporarily blocked this request. No ratings are invented.</span></div>}
            <div className="lt-broker-table-wrap"><table className="lt-table"><thead><tr><th>Broker / firm</th><th>Latest rating</th><th>Price target</th><th>Published</th></tr></thead><tbody>
              {brokerRows.map((row, index) => <tr key={row.firm + "-" + (row.publishedAt ?? index)}><td>{row.firm}</td><td><span className="lt-grade">{row.toGrade ?? "—"}</span><small>{row.action ?? ""}</small></td><td>{currency(row.priceTarget)}{row.priorPriceTarget != null && row.priorPriceTarget !== row.priceTarget && <small>Prior {currency(row.priorPriceTarget)}</small>}</td><td>{prettyDate(row.publishedAt)}</td></tr>)}
              {!brokerRows.length && <tr><td colSpan={4} className="lt-table-empty">No recent broker upgrades/downgrades returned.</td></tr>}
            </tbody></table></div>
            <p className="lt-footnote">Coverage is not available for every NSE stock. Consensus/target prices may be delayed, refer to non-Indian broker coverage, and are not guarantees or recommendations. Verify the original research report before relying on it.</p>
          </article>

          <article className="lt-panel lt-risk-panel">
            <div className="lt-panel-heading"><div><div className="lt-section-label">RISK &amp; PRICE CONTEXT</div><h3>What could go wrong?</h3></div></div>
            <div className="lt-risk-metric"><span>Maximum drawdown in available 1Y window</span><strong className="lt-negative">{pct(m?.maxDrawdownPct)}</strong></div>
            <div className="lt-risk-metric"><span>Annualised volatility · approx.</span><strong>{pct(m?.annualizedVolatilityPct)}</strong></div>
            <div className="lt-risk-metric"><span>RSI (14) · momentum only</span><strong>{value(m?.rsi14)}</strong></div>
            <div className="lt-risk-metric"><span>Price / book</span><strong>{f?.priceToBook == null ? "—" : value(f.priceToBook) + "×"}</strong></div>
            <div className="lt-risk-callout"><strong>Do not buy only because a price is down.</strong><p>Falling prices can reflect permanent business impairment. Verify cash flow, competitive position, debt, governance and current disclosures before averaging down.</p></div>
          </article>
        </div>
        <div className="lt-data-footer">Data as of {research.generatedAt}. Sources: <a href="https://finance.yahoo.com/" target="_blank" rel="noreferrer">Yahoo Finance</a> price history and analyst summary · Price data is an unofficial best-effort feed and may be delayed or incomplete. <span>Cache: {research.cached ? "cached" : "fresh request"}.</span></div>
      </>}
      {!researchBusy && !research && !researchError && <div className="lt-empty"><strong>Choose a stock to start.</strong><span>The research workspace will load its available history and fundamentals.</span></div>}
    </div>}

    {tab === "institutions" && <div id="institutional-activity" className="lt-page" role="tabpanel">
      <div className="lt-page-heading">
        <div><div className="lt-section-label">02 / FOLLOW DISCLOSED MONEY</div><h2>See what large holders disclose.</h2><p>Bulk and block deals, client names and quarterly shareholding filings from NSE public disclosures.</p></div>
        <button type="button" className="lt-refresh-button" disabled={activityBusy} onClick={() => setActivityRefresh((previous) => previous + 1)}>{activityBusy ? "Refreshing…" : "↻ Refresh activity"}</button>
      </div>
      <div className="lt-activity-toolbar">
        <div><strong>Deal activity</strong><span>Last 30 days · official NSE reports when reachable</span></div>
        <label><span>FILTER STOCK</span><select aria-label="Filter institutional deals by stock" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}><option value="ALL">All reported stocks</option>{stockNames.map((stock) => <option key={stock.symbol} value={stock.symbol}>{stock.symbol} · {stock.name}</option>)}</select></label>
      </div>
      {activityError && <div className="lt-error"><strong>Institutional feed unavailable</strong><span>{activityError}</span></div>}
      {activityBusy && <div className="lt-loading"><span className="lt-spinner" /> Loading public large-deal reports and shareholding filings…</div>}
      {!activityBusy && activity && <>
        {activity.warnings.length > 0 && <div className="lt-notice"><strong>Partial disclosure response.</strong><span>{activity.warnings.join(" ")}</span></div>}
        <div className="lt-metric-grid lt-activity-metrics">
          <MetricCard label="REPORTED DEALS" main={integer.format(activity.summary.reportedDeals)} foot={activity.period.from + " to " + activity.period.to} tone="neutral" />
          <MetricCard label="BUY PRINTS" main={integer.format(activity.summary.buyDeals)} foot={"Reported notional " + moneyShort(activity.summary.buyNotional)} tone="good" />
          <MetricCard label="SELL PRINTS" main={integer.format(activity.summary.sellDeals)} foot={"Reported notional " + moneyShort(activity.summary.sellNotional)} tone="weak" />
          <MetricCard label="FIRST BUY PRINTS" main={integer.format(activity.summary.firstReportedBuysInWindow)} foot="First observed in this 30-day feed window" tone="watch" />
        </div>

        <div className="lt-panel lt-deals-panel">
          <div className="lt-panel-heading"><div><div className="lt-section-label">REPORTED LARGE TRANSACTIONS</div><h3>{activityFilter === "ALL" ? "Who bought or sold?" : activityFilter + " · deal history"}</h3></div><a className="lt-nse-link" href={activity.sources.deals} target="_blank" rel="noreferrer">Open NSE large deals ↗</a></div>
          <div className="lt-table-wrap"><table className="lt-table lt-deals-table"><thead><tr><th>Date</th><th>Stock / type</th><th>Client named in disclosure</th><th>Side</th><th>Quantity</th><th>Price</th><th>Approx. value</th><th>Signal</th></tr></thead><tbody>
            {activityRows.map((deal, index) => <tr key={(deal.symbol ?? "stock") + "-" + (deal.clientName ?? "client") + "-" + (deal.date ?? index) + "-" + index}>
              <td>{deal.date ?? "—"}</td>
              <td><strong>{deal.symbol ?? "—"}</strong><small>{deal.securityName ?? "NSE listed stock"} · {deal.type}</small></td>
              <td>{deal.clientName ?? "Client not returned"}</td>
              <td><SignalTag label={deal.side} tone={deal.side === "BUY" ? "good" : deal.side === "SELL" ? "weak" : "neutral"} /></td>
              <td>{deal.quantity == null ? "—" : integer.format(deal.quantity)}</td>
              <td>{currency(deal.price)}</td>
              <td><div className="lt-notional-cell"><strong>{moneyShort(deal.notional)}</strong><i><span style={{ width: ((deal.notional ?? 0) / maxDealValue * 100) + "%" }} /></i></div></td>
              <td>{deal.firstReportedBuyInWindow ? <SignalTag label="First buy print*" tone="watch" /> : <SignalTag label="Reported deal" tone="neutral" />}</td>
            </tr>)}
            {!activityRows.length && <tr><td colSpan={8} className="lt-table-empty">No large-deal records were returned for this filter and period. This does not mean institutions did not trade.</td></tr>}
          </tbody></table></div>
          <p className="lt-footnote">{activity.note}</p>
        </div>

        {activityFilter !== "ALL" && <div className="lt-panel lt-holdings-panel">
          <div className="lt-panel-heading"><div><div className="lt-section-label">QUARTERLY OWNERSHIP DISCLOSURE</div><h3>{activityFilter} shareholding pattern</h3></div><a className="lt-nse-link" href={activity.sources.shareholding} target="_blank" rel="noreferrer">Open NSE filing ↗</a></div>
          <p className="lt-muted-copy">Latest published filings for promoters/public holders. The filing date is not the trade date, and total public ownership is not the same as FII/DII ownership.</p>
          <div className="lt-table-wrap"><table className="lt-table"><thead><tr><th>As on date</th><th>Submission</th><th>Promoter group</th><th>Public float</th><th>Employee trust</th><th>Filing</th></tr></thead><tbody>
            {holdingRows.map((holding, index) => <tr key={(holding.asOf ?? "date") + index}><td>{holding.asOf ?? "—"}</td><td>{holding.submittedAt ?? "—"}</td><td>{holding.promoterPct == null ? "—" : value(holding.promoterPct) + "%"}</td><td>{holding.publicPct == null ? "—" : value(holding.publicPct) + "%"}</td><td>{holding.employeeTrustPct == null ? "—" : value(holding.employeeTrustPct) + "%"}</td><td><a href={holding.filingUrl} target="_blank" rel="noreferrer">View ↗</a></td></tr>)}
            {!holdingRows.length && <tr><td colSpan={6} className="lt-table-empty">Quarterly filing data is unavailable through the live endpoint. Open the official NSE filing page to inspect published details.</td></tr>}
          </tbody></table></div>
        </div>}

        <div className="lt-institution-explainer-grid">
          <article><span className="lt-explainer-mark green">↗</span><div><strong>Bulk / block buys</strong><p>Useful for finding named buyers and large reported transactions. A trade print does not prove a new long-term holding.</p></div></article>
          <article><span className="lt-explainer-mark yellow">◷</span><div><strong>Quarterly holdings</strong><p>Ownership filings arrive periodically and can be revised. Compare the report date and submission date before inferring a trend.</p></div></article>
          <article><span className="lt-explainer-mark red">!</span><div><strong>Follow the disclosure, not the celebrity</strong><p>Client names may be funds, companies, promoters or individuals. Check the exact filing and the size relative to liquidity.</p></div></article>
        </div>
        <div className="lt-data-footer">Sources: <a href={activity.sources.deals} target="_blank" rel="noreferrer">NSE bulk/block deal disclosures</a> and <a href={activity.sources.shareholding} target="_blank" rel="noreferrer">NSE shareholding-pattern filings</a>. Data is limited to what the public endpoints returned and may be revised or unavailable.</div>
      </>}
      {!activityBusy && !activity && !activityError && <div className="lt-empty"><strong>No activity loaded yet.</strong><span>Refresh to query the latest publicly available NSE disclosures.</span></div>}
    </div>}
  </section>;
}
