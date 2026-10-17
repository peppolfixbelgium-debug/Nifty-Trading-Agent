import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import { buildEntryZone, calculateQualityScore, metricGrade, type FundamentalMetric, type FundamentalKey, type TrendSnapshot } from "../src/lib/long-term.js";

type QuoteSummaryPayload = {
  quoteSummary?: { result?: Array<Record<string, unknown>> | null; error?: { description?: string } | null };
};

type ChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: { currency?: string; longName?: string; shortName?: string; exchangeName?: string };
      indicators?: { quote?: Array<{ close?: Array<number | null>; low?: Array<number | null>; high?: Array<number | null> }> };
    }> | null;
    error?: { description?: string } | null;
  };
};

const MODULES = ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "upgradeDowngradeHistory", "recommendationTrend"];
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36";
let memoryCache: { key: string; expiry: number; value: Record<string, unknown> } | null = null;

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (typeof value === "object" && value !== null && "raw" in value) return toNumber((value as { raw?: unknown }).raw);
  return null;
}

function moduleValue(modules: Record<string, unknown>, moduleName: string, fieldName: string): unknown {
  const module = modules[moduleName];
  if (typeof module !== "object" || module === null) return null;
  return (module as Record<string, unknown>)[fieldName] ?? null;
}

function metricValue(modules: Record<string, unknown>, moduleName: string, fieldName: string): number | null {
  return toNumber(moduleValue(modules, moduleName, fieldName));
}

function dateInIndia(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(timestamp));
}

function joinCookies(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  return raw.split(/,(?=[^;,]+=)/).map((part) => part.split(";")[0] ?? "").filter(Boolean).join("; ");
}

async function getYahooSummary(symbol: string): Promise<Record<string, unknown>> {
  const makeUrl = (crumb?: string) => {
    const url = new URL("https://query1.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(symbol));
    url.searchParams.set("modules", MODULES.join(","));
    url.searchParams.set("formatted", "false");
    if (crumb) url.searchParams.set("crumb", crumb);
    return url.toString();
  };
  const headers = { "User-Agent": USER_AGENT, accept: "application/json,text/plain,*/*", referer: "https://finance.yahoo.com/" };
  let response = await fetch(makeUrl(), { headers, signal: AbortSignal.timeout(10000) });
  let cookie = "";
  if (!response.ok) {
    const landing = await fetch("https://finance.yahoo.com/quote/" + encodeURIComponent(symbol) + "/", {
      headers, signal: AbortSignal.timeout(10000)
    }).catch(() => null);
    if (landing) cookie = joinCookies(landing);
    const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(8000)
    }).catch(() => null);
    const crumb = crumbResponse && crumbResponse.ok ? (await crumbResponse.text()).trim() : "";
    if (crumb && crumb.length < 200) {
      response = await fetch(makeUrl(crumb), {
        headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(10000)
      });
    }
  }
  if (!response.ok) throw new Error("Yahoo Finance fundamentals endpoint returned HTTP " + response.status + ".");
  const payload = await response.json() as QuoteSummaryPayload;
  if (payload.quoteSummary?.error) throw new Error(payload.quoteSummary.error.description ?? "Yahoo Finance could not return this symbol.");
  const first = payload.quoteSummary?.result?.[0];
  if (!first) throw new Error("No fundamentals or broker-rating record was returned for this symbol.");
  return first;
}

function metric(key: FundamentalKey, label: string, value: number | null, displayValue: string, explanation: string, sectorSensitive = false): FundamentalMetric {
  return { key, label, value, displayValue, grade: metricGrade(key, value), explanation, ...(sectorSensitive ? { sectorSensitive: true } : {}) };
}

function percent(value: number | null): string {
  return value === null ? "—" : (value * 100).toFixed(1) + "%";
}

function metricList(modules: Record<string, unknown>): FundamentalMetric[] {
  const roe = metricValue(modules, "financialData", "returnOnEquity");
  const debt = metricValue(modules, "financialData", "debtToEquity");
  const revenueGrowth = metricValue(modules, "financialData", "revenueGrowth");
  const earningsGrowth = metricValue(modules, "financialData", "earningsGrowth");
  const margin = metricValue(modules, "financialData", "profitMargins");
  const currentRatio = metricValue(modules, "financialData", "currentRatio");
  const cash = metricValue(modules, "financialData", "freeCashflow");
  const pe = metricValue(modules, "summaryDetail", "trailingPE");
  return [
    metric("roe", "Return on equity", roe, percent(roe), "Above 15% is screened as strong; 8–15% is mixed. Business models differ."),
    metric("debtToEquity", "Debt / equity", debt, debt === null ? "—" : debt.toFixed(1) + "%", "Lower leverage generally gives more room during weak cycles."),
    metric("revenueGrowth", "Revenue growth", revenueGrowth, percent(revenueGrowth), "Positive growth is preferred; compare against the company’s own history and peers."),
    metric("earningsGrowth", "Earnings growth", earningsGrowth, percent(earningsGrowth), "Growth can be volatile when the base period is unusually high or low."),
    metric("profitMargin", "Profit margin", margin, percent(margin), "A higher margin can indicate pricing power, but sector norms vary."),
    metric("currentRatio", "Current ratio", currentRatio, currentRatio === null ? "—" : currentRatio.toFixed(2) + "×", "Short-term liquidity screen; less informative for some financial businesses."),
    metric("freeCashFlow", "Free cash flow", cash, cash === null ? "—" : "₹" + (cash / 10000000).toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " Cr", "Positive cash flow is preferred; capital-intensive and financial firms need context."),
    metric("peRatio", "Trailing P/E", pe, pe === null ? "—" : pe.toFixed(1) + "×", "Rough screen only. A high P/E can be reasonable for some sectors and dangerous for others.", true)
  ];
}

function buildTrend(chart: ChartPayload, fallbackName: string): { trend: TrendSnapshot; name: string; currency: string } {
  const result = chart.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];
  const today = dateInIndia(Date.now());
  const rows: Array<{ time: number; close: number; low: number; high: number }> = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const time = timestamps[i];
    const close = quote?.close?.[i];
    const low = quote?.low?.[i];
    const high = quote?.high?.[i];
    if (typeof time !== "number" || typeof close !== "number" || typeof low !== "number" || typeof high !== "number") continue;
    if (![close, low, high].every(Number.isFinite) || close <= 0 || low <= 0 || high < Math.max(low, close)) continue;
    if (dateInIndia(time * 1000) >= today) continue;
    rows.push({ time, close, low, high });
  }
  rows.sort((a, b) => a.time - b.time);
  const closes = rows.map((row) => row.close);
  const average = (period: number): number | null => closes.length < period ? null : closes.slice(-period).reduce((sum, value) => sum + value, 0) / period;
  const lastPrice = closes.at(-1) ?? null;
  const priceAgo = (sessions: number) => closes.length > sessions ? closes[closes.length - 1 - sessions]! : null;
  const low60 = rows.length ? Math.min(...rows.slice(-60).map((row) => row.low)) : null;
  const high52w = rows.length ? Math.max(...rows.slice(-252).map((row) => row.high)) : null;
  const low52w = rows.length ? Math.min(...rows.slice(-252).map((row) => row.low)) : null;
  return {
    name: result?.meta?.longName || result?.meta?.shortName || fallbackName,
    currency: result?.meta?.currency || "INR",
    trend: {
      lastPrice,
      sma50: average(50),
      sma200: average(200),
      return3mPct: lastPrice !== null && priceAgo(63) !== null && priceAgo(63)! > 0 ? (lastPrice / priceAgo(63)! - 1) * 100 : null,
      return1yPct: lastPrice !== null && closes.length > 200 && closes[0]! > 0 ? (lastPrice / closes[0]! - 1) * 100 : null,
      support60d: low60,
      high52w,
      low52w,
      samples: closes.length
    }
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const raw = typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase() : "RELIANCE";
  const cleaned = raw.replace(/\s+/g, "");
  const symbol = cleaned.endsWith(".NS") || cleaned.endsWith(".BO") ? cleaned : cleaned + ".NS";
  if (!/^[A-Z0-9&-]{1,20}\.(NS|BO)$/.test(symbol)) {
    return res.status(400).json({ error: "Enter an NSE/BSE ticker such as RELIANCE, HDFCBANK or RELIANCE.BO." });
  }
  const cacheKey = symbol;
  if (req.query.refresh !== "1" && memoryCache?.key === cacheKey && memoryCache.expiry > Date.now()) {
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.status(200).json(memoryCache.value);
  }

  try {
    const chartUrl = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
    chartUrl.searchParams.set("range", "1y");
    chartUrl.searchParams.set("interval", "1d");
    chartUrl.searchParams.set("events", "div,splits");
    const chartResponse = await fetch(chartUrl, {
      headers: { "User-Agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (!chartResponse.ok) throw new Error("Price-history provider returned HTTP " + chartResponse.status + ".");
    const chart = await chartResponse.json() as ChartPayload;
    if (chart.chart?.error) throw new Error(chart.chart.error.description || "Price history is unavailable for " + symbol + ".");
    const computed = buildTrend(chart, symbol.replace(/\.(NS|BO)$/, ""));
    if (!computed.trend.samples) throw new Error("No completed daily price candles were returned for " + symbol + ".");

    let modules: Record<string, unknown> = {};
    let fundamentalError: string | null = null;
    try {
      modules = await getYahooSummary(symbol);
    } catch (error) {
      fundamentalError = error instanceof Error ? error.message : "Fundamental data could not be loaded.";
    }
    const metrics = metricList(modules);
    const quality = calculateQualityScore(metrics);
    const trend = computed.trend;
    const entryZone = buildEntryZone(trend);
    const bullishTrend = trend.lastPrice !== null && trend.sma50 !== null && trend.sma200 !== null && trend.lastPrice > trend.sma50 && trend.sma50 > trend.sma200;
    const pe = metricValue(modules, "summaryDetail", "trailingPE");
    let assessment = { label: "INSUFFICIENT DATA", tone: "neutral", reason: "Not enough independently available fundamentals and price history to produce a rules-based long-term screen." };
    if (quality.score !== null && trend.samples >= 200 && trend.sma200 !== null) {
      if (quality.score >= 70 && bullishTrend && (pe === null || pe <= 35) && quality.weak <= 1) {
        assessment = { label: "BUY GRADUALLY", tone: "good", reason: "The available quality metrics screen well and the price is above rising long-term trend references. Use staged entries; the P/E filter is sector-sensitive." };
      } else if (quality.score < 35 && trend.lastPrice !== null && trend.lastPrice < trend.sma200) {
        assessment = { label: "SELL / REVIEW THESIS", tone: "bad", reason: "Several available quality metrics screen weak and price is below its 200-day average. Recheck the business thesis, balance sheet and latest filings before deciding." };
      } else {
        assessment = { label: "HOLD / WAIT", tone: "neutral", reason: "The evidence is mixed or the price is not in a strong long-term trend. Review valuation, quarterly filings and entry price rather than forcing a decision." };
      }
    }

    const ratingHistoryModule = moduleValue(modules, "upgradeDowngradeHistory", "history");
    const ratingHistory = Array.isArray(ratingHistoryModule) ? ratingHistoryModule.map((item) => {
      const row = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
      const rawDate = toNumber(row.epochGradeDate);
      return {
        firm: typeof row.firm === "string" ? row.firm : "Analyst firm not supplied",
        action: typeof row.action === "string" ? row.action : "updated",
        fromGrade: typeof row.fromGrade === "string" ? row.fromGrade : null,
        toGrade: typeof row.toGrade === "string" ? row.toGrade : "Not supplied",
        date: rawDate === null ? null : new Date(rawDate * 1000).toISOString().slice(0, 10)
      };
    }).filter((row) => row.toGrade !== "Not supplied" && (row.date === null || Date.now() - Date.parse(row.date) <= 550 * 86400000))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 20) : [];
    const recommendationTrend = moduleValue(modules, "recommendationTrend", "trend");
    const recTrend = Array.isArray(recommendationTrend) ? recommendationTrend.map((item) => {
      const row = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
      return {
        period: typeof row.period === "string" ? row.period : "",
        strongBuy: toNumber(row.strongBuy) ?? 0,
        buy: toNumber(row.buy) ?? 0,
        hold: toNumber(row.hold) ?? 0,
        sell: toNumber(row.sell) ?? 0,
        strongSell: toNumber(row.strongSell) ?? 0
      };
    }).filter((row) => row.period === "0m" || row.period === "-1m").slice(0, 2) : [];
    const targetMean = metricValue(modules, "financialData", "targetMeanPrice");
    const targetLow = metricValue(modules, "financialData", "targetLowPrice");
    const targetHigh = metricValue(modules, "financialData", "targetHighPrice");
    const currency = computed.currency;
    const output: Record<string, unknown> = {
      symbol,
      name: computed.name,
      currency,
      source: "Yahoo Finance chart and quote summary endpoints (unofficial; availability and freshness may vary)",
      generatedAt: new Date().toISOString(),
      trend,
      entryZone,
      metrics,
      quality,
      assessment,
      analyst: {
        consensusLabel: typeof moduleValue(modules, "financialData", "recommendationKey") === "string" ? moduleValue(modules, "financialData", "recommendationKey") : null,
        meanTargetPrice: targetMean,
        lowTargetPrice: targetLow,
        highTargetPrice: targetHigh,
        analystCount: metricValue(modules, "financialData", "numberOfAnalystOpinions"),
        consensusPeriodCounts: recTrend,
        brokerActions: ratingHistory
      },
      fundamentalError,
      caveats: [
        "This is an explainable screen, not personalised investment advice or a guarantee of returns.",
        "Entry zones are technical references based on the 50-day average, not intrinsic value or assured support.",
        "P/E thresholds are sector-sensitive; compare with sector peers, cash flows, debt maturities and official filings.",
        "Yahoo Finance is an unofficial data source. Verify current figures in exchange/company filings before acting."
      ]
    };
    memoryCache = { key: cacheKey, expiry: Date.now() + 15 * 60 * 1000, value: output };
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json(output);
  } catch (error) {
    return res.status(502).json({
      error: "Long-term research data could not be loaded.",
      detail: error instanceof Error ? error.message : "Unknown provider error",
      hint: "Try a standard NSE ticker such as RELIANCE or HDFCBANK. The research feed is free and unauthenticated, but upstream availability is not guaranteed."
    });
  }
}
