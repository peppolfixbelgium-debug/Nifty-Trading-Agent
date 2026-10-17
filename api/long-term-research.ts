import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import { getMarketChart } from "../src/lib/chart-data.js";
import { summarizeLongTerm } from "../src/lib/long-term.js";

type YahooValue = number | string | { raw?: number; fmt?: string; longFmt?: string } | null | undefined;
type YahooRecord = Record<string, unknown>;

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expires: number; value: unknown }>();
const headers = {
  accept: "application/json,text/plain,*/*",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
};

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object" && "raw" in value) {
    const raw = (value as { raw?: unknown }).raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "fmt" in value) {
    const formatted = (value as { fmt?: unknown }).fmt;
    return typeof formatted === "string" && formatted.trim() ? formatted.trim() : null;
  }
  return null;
}

function record(value: unknown): YahooRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as YahooRecord : {};
}

function pct(value: unknown): number | null {
  const raw = num(value);
  return raw === null ? null : raw * 100;
}

function getSetCookies(response: Response): string {
  const h = response.headers as Headers & { getSetCookie?: () => string[] };
  const parts = typeof h.getSetCookie === "function" ? h.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  return parts.map((part) => part.split(";")[0]).filter(Boolean).join("; ");
}

async function yahooFundamentals(symbol: string): Promise<YahooRecord | null> {
  const bootstrap = await fetch("https://fc.yahoo.com", { headers, signal: AbortSignal.timeout(7000), redirect: "follow" });
  const cookies = getSetCookies(bootstrap);
  if (!cookies) throw new Error("Yahoo Finance did not issue a research session cookie.");
  const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...headers, cookie: cookies },
    signal: AbortSignal.timeout(7000)
  });
  const crumb = (await crumbResponse.text()).trim();
  if (!crumb || crumb.length > 200) throw new Error("Yahoo Finance did not provide a valid research session token.");
  const url = new URL("https://query1.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(symbol));
  url.searchParams.set("modules", "price,summaryDetail,defaultKeyStatistics,financialData,recommendationTrend,upgradeDowngradeHistory");
  url.searchParams.set("formatted", "true");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");
  url.searchParams.set("crumb", crumb);
  url.searchParams.set("corsDomain", "finance.yahoo.com");
  const response = await fetch(url, {
    headers: { ...headers, cookie: cookies },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error("Yahoo Finance fundamentals returned HTTP " + response.status + ".");
  const payload = await response.json() as { quoteSummary?: { result?: YahooRecord[]; error?: { description?: string } } };
  const first = payload.quoteSummary?.result?.[0];
  if (!first) throw new Error(payload.quoteSummary?.error?.description ?? "No fundamentals or analyst data were returned for this symbol.");
  return first;
}

function buildFundamentals(payload: YahooRecord | null) {
  if (!payload) return null;
  const price = record(payload.price);
  const summary = record(payload.summaryDetail);
  const keys = record(payload.defaultKeyStatistics);
  const financial = record(payload.financialData);
  return {
    companyName: text(price.longName) ?? text(price.shortName),
    currency: text(price.currency),
    marketCap: num(price.marketCap),
    trailingPE: num(summary.trailingPE) ?? num(keys.trailingPE),
    forwardPE: num(summary.forwardPE) ?? num(keys.forwardPE),
    priceToBook: num(keys.priceToBook),
    dividendYieldPct: pct(summary.dividendYield),
    returnOnEquityPct: pct(financial.returnOnEquity),
    profitMarginPct: pct(financial.profitMargins),
    revenueGrowthPct: pct(financial.revenueGrowth),
    earningsGrowthPct: pct(financial.earningsGrowth),
    debtToEquityPct: num(financial.debtToEquity),
    totalCash: num(financial.totalCash),
    totalDebt: num(financial.totalDebt)
  };
}

function buildAnalysts(payload: YahooRecord | null, currentPrice: number) {
  if (!payload) return null;
  const trend = record(payload.recommendationTrend);
  const rows = Array.isArray(trend.trend) ? trend.trend.map(record) : [];
  const current = rows.find((row) => row.period === "0m") ?? rows[0];
  const counts = current ? {
    strongBuy: num(current.strongBuy) ?? 0,
    buy: num(current.buy) ?? 0,
    hold: num(current.hold) ?? 0,
    sell: num(current.sell) ?? 0,
    strongSell: num(current.strongSell) ?? 0
  } : null;
  const ratingModule = record(payload.upgradeDowngradeHistory);
  const history = Array.isArray(ratingModule.history) ? ratingModule.history.map(record) : [];
  const brokerRatings = history.map((row) => ({
    firm: text(row.firm) ?? "Brokerage not named",
    action: text(row.action),
    fromGrade: text(row.fromGrade),
    toGrade: text(row.toGrade),
    priceTarget: num(row.priceTarget),
    priorPriceTarget: num(row.priorPriceTarget),
    publishedAt: num(row.epochGradeDate) === null ? null : new Date((num(row.epochGradeDate) ?? 0) * 1000).toISOString()
  })).filter((row) => row.toGrade || row.priceTarget !== null)
    .sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0))
    .slice(0, 8);
  const financial = record(payload.financialData);
  const meanTarget = num(financial.targetMeanPrice);
  const totalAnalysts = num(financial.numberOfAnalystOpinions);
  const recommendation = text(financial.recommendationKey);
  return {
    recommendation,
    totalAnalysts,
    counts,
    meanTargetPrice: meanTarget,
    lowTargetPrice: num(financial.targetLowPrice),
    highTargetPrice: num(financial.targetHighPrice),
    impliedUpsidePct: meanTarget !== null && currentPrice > 0 ? (meanTarget / currentPrice - 1) * 100 : null,
    brokerRatings,
    source: "Yahoo Finance analyst coverage (unofficial; coverage varies by symbol)"
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const raw = typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase() : "RELIANCE";
  const symbol = raw.endsWith(".NS") ? raw : raw + ".NS";
  if (!/^[A-Z0-9&^-]{1,18}\.NS$/.test(symbol)) {
    return res.status(400).json({ error: "Enter an NSE ticker (for example RELIANCE, HDFCBANK or M&M). Global tickers are not supported in this India-first research workspace yet." });
  }
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  const cacheKey = "research:" + symbol;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && cached.expires > Date.now()) {
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.status(200).json({ ...record(cached.value), cached: true });
  }

  const warnings: string[] = [];
  let fundamentalsPayload: YahooRecord | null = null;
  let oneYearChart: Awaited<ReturnType<typeof getMarketChart>> | null = null;
  let fiveYearChart: Awaited<ReturnType<typeof getMarketChart>> | null = null;
  const jobs = await Promise.allSettled([
    getMarketChart(symbol, "1Y", refresh),
    getMarketChart(symbol, "5Y", refresh),
    yahooFundamentals(symbol)
  ]);
  if (jobs[0]?.status === "fulfilled") oneYearChart = jobs[0].value;
  else warnings.push("1-year daily price history is unavailable: " + (jobs[0]?.status === "rejected" ? String(jobs[0].reason instanceof Error ? jobs[0].reason.message : jobs[0].reason) : "no response"));
  if (jobs[1]?.status === "fulfilled") fiveYearChart = jobs[1].value;
  else warnings.push("5-year weekly price history is unavailable; long-range return is omitted.");
  if (jobs[2]?.status === "fulfilled") fundamentalsPayload = jobs[2].value;
  else warnings.push("Fundamentals and broker consensus are unavailable right now. Technical metrics remain separate; no missing fundamentals are estimated.");

  const metrics = oneYearChart ? summarizeLongTerm(oneYearChart.candles, fiveYearChart?.candles ?? []) : null;
  if (!metrics) return res.status(502).json({ error: "Long-term research data could not be loaded for " + symbol + ".", detail: warnings.join(" ") });

  const fundamentals = buildFundamentals(fundamentalsPayload);
  const analysts = buildAnalysts(fundamentalsPayload, metrics.latestPrice);
  const output = {
    symbol,
    name: fundamentals?.companyName ?? oneYearChart?.name ?? symbol.replace(/\.NS$/, ""),
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance chart + quote-summary endpoints (unofficial; data coverage and refresh timing vary)",
    cached: false,
    metrics,
    fundamentals,
    analysts,
    warnings
  };
  cache.set(cacheKey, { expires: Date.now() + TTL_MS, value: output });
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).json(output);
}
