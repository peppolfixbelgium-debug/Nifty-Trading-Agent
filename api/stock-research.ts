import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import { assessLongTerm } from "../src/lib/long-term-analysis.js";

type YahooChart = {
  chart?: {
    error?: { description?: string } | null;
    result?: Array<{
      timestamp?: number[];
      meta?: Record<string, unknown>;
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
  };
};
type YahooSummary = { quoteSummary?: { error?: unknown; result?: Array<Record<string, any>> | null } };
type Numeric = number | null;

const headers = {
  accept: "application/json, text/plain, */*",
  "user-agent": "Mozilla/5.0 (compatible; LongTermInvestorDesk/1.0)",
  referer: "https://finance.yahoo.com/"
};
const numberOrNull = (value: unknown): Numeric => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "raw" in value) {
    const raw = (value as { raw?: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const percent = (value: unknown): Numeric => {
  const raw = numberOrNull(value);
  return raw === null ? null : raw * 100;
};
const indiaDate = (time: number) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return String(values.year) + "-" + String(values.month) + "-" + String(values.day);
};
const medianAverage = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const readText = async (url: string, cookie: string, timeout = 6000) => {
  const response = await fetch(url, {
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error("Yahoo Finance returned HTTP " + response.status + ".");
  return response.text();
};

async function yahooCookieAndCrumb(): Promise<{ cookie: string; crumb: string }> {
  let cookie = "";
  for (const url of ["https://fc.yahoo.com/", "https://finance.yahoo.com/"]) {
    try {
      const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(5000) });
      const setCookie = response.headers.get("set-cookie") ?? "";
      cookie = setCookie
        .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
        .map((part) => part.trim().split(";")[0])
        .filter((part) => part.includes("="))
        .join("; ");
      if (cookie) break;
    } catch {
      // Public chart data is still useful even if the summary-cookie handshake is blocked.
    }
  }
  try {
    const crumb = (await readText("https://query1.finance.yahoo.com/v1/test/getcrumb", cookie, 5000)).trim();
    if (crumb && crumb.length < 200 && !crumb.includes("<")) return { cookie, crumb };
  } catch {
    // Try quoteSummary without a crumb below; it may be allowed for this deployment.
  }
  return { cookie, crumb: "" };
}

async function getSummary(symbol: string): Promise<Record<string, any> | null> {
  const auth = await yahooCookieAndCrumb();
  const url = new URL("https://query1.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(symbol));
  url.searchParams.set("modules", "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,recommendationTrend,upgradeDowngradeHistory");
  url.searchParams.set("formatted", "false");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");
  if (auth.crumb) url.searchParams.set("crumb", auth.crumb);

  try {
    const response = await fetch(url, {
      headers: { ...headers, ...(auth.cookie ? { cookie: auth.cookie } : {}) },
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) return null;
    const payload = await response.json() as YahooSummary;
    return payload.quoteSummary?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

function returnAtYears(timestamps: number[], values: number[], years: number): Numeric {
  if (timestamps.length < 2 || values.length < 2) return null;
  const finalTime = timestamps[timestamps.length - 1]!;
  const finalValue = values[values.length - 1]!;
  const target = finalTime - years * 365.25 * 24 * 60 * 60;
  let chosen = -1;
  for (let i = 0; i < timestamps.length; i += 1) {
    if (timestamps[i]! <= target && Number.isFinite(values[i]!)) chosen = i;
  }
  if (chosen < 0 || values[chosen]! <= 0 || finalValue <= 0) return null;
  return (finalValue / values[chosen]! - 1) * 100;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const rawSymbol = typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase() : "";
  const symbol = rawSymbol.endsWith(".NS") ? rawSymbol : rawSymbol + ".NS";
  if (!rawSymbol || !/^[A-Z0-9&-]{1,20}(?:\.NS)?$/.test(symbol)) {
    return res.status(400).json({ error: "Enter an NSE ticker such as RELIANCE, HDFCBANK or INFY." });
  }
  try {
    const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
    url.searchParams.set("range", "5y");
    url.searchParams.set("interval", "1d");
    url.searchParams.set("events", "div,splits");
    url.searchParams.set("includeAdjustedClose", "true");
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(14000) });
    if (!response.ok) throw new Error("Public price history returned HTTP " + response.status + ".");
    const chartPayload = await response.json() as YahooChart;
    if (chartPayload.chart?.error) throw new Error(chartPayload.chart.error.description ?? "No chart data was returned.");
    const chart = chartPayload.chart?.result?.[0];
    const timestampsRaw = chart?.timestamp ?? [];
    const closesRaw = chart?.indicators?.quote?.[0]?.close ?? [];
    const adjustedRaw = chart?.indicators?.adjclose?.[0]?.adjclose ?? [];
    const timestamps: number[] = [];
    const closes: number[] = [];
    const adjusted: number[] = [];
    const today = indiaDate(Date.now());

    for (let i = 0; i < timestampsRaw.length; i += 1) {
      const time = timestampsRaw[i];
      const close = closesRaw[i];
      const adjClose = adjustedRaw[i] ?? close;
      if (typeof time !== "number" || typeof close !== "number" || !Number.isFinite(close) || close <= 0 ||
          typeof adjClose !== "number" || !Number.isFinite(adjClose) || adjClose <= 0) continue;
      if (indiaDate(time * 1000) >= today) continue;
      timestamps.push(time);
      closes.push(close);
      adjusted.push(adjClose);
    }
    if (closes.length < 60) {
      throw new Error("Not enough completed daily candles for long-term research. Try another NSE symbol later.");
    }

    const lastPrice = closes[closes.length - 1]!;
    const sma = (length: number): Numeric => closes.length >= length ? medianAverage(closes.slice(-length)) : null;
    const sma50 = sma(50);
    const sma200 = sma(200);
    const return1yPct = returnAtYears(timestamps, adjusted, 1);
    const return3yPct = returnAtYears(timestamps, adjusted, 3);
    const return5yPct = returnAtYears(timestamps, adjusted, 5);
    const yearStart = timestamps[timestamps.length - 1]! - 365.25 * 24 * 60 * 60;
    const oneYearCloses = adjusted.filter((_, i) => timestamps[i]! >= yearStart);
    let highWater = 0;
    let maxDrawdownPct: number | null = null;
    for (const close of oneYearCloses) {
      highWater = Math.max(highWater, close);
      if (highWater > 0) {
        const dd = (close / highWater - 1) * 100;
        maxDrawdownPct = maxDrawdownPct === null ? dd : Math.min(maxDrawdownPct, dd);
      }
    }

    const summary = await getSummary(symbol);
    const price = summary?.price ?? {};
    const detail = summary?.summaryDetail ?? {};
    const stats = summary?.defaultKeyStatistics ?? {};
    const financial = summary?.financialData ?? {};
    const profile = summary?.assetProfile ?? {};
    const targetHistory = summary?.upgradeDowngradeHistory?.history ?? [];
    const recommendationTrend = summary?.recommendationTrend?.trend ?? [];
    const latestTrend = recommendationTrend.find((item: Record<string, any>) => item.period === "0m") ?? recommendationTrend[0] ?? null;
    const brokerHistory = (Array.isArray(targetHistory) ? targetHistory : [])
      .slice()
      .sort((a: Record<string, any>, b: Record<string, any>) => (numberOrNull(b.epochGradeDate) ?? 0) - (numberOrNull(a.epochGradeDate) ?? 0))
      .slice(0, 12)
      .map((item: Record<string, any>) => ({
        firm: typeof item.firm === "string" ? item.firm : "Analyst firm not supplied",
        action: typeof item.action === "string" ? item.action : "Rating update",
        fromGrade: typeof item.fromGrade === "string" ? item.fromGrade : null,
        toGrade: typeof item.toGrade === "string" ? item.toGrade : null,
        date: numberOrNull(item.epochGradeDate) === null ? null : new Date((numberOrNull(item.epochGradeDate) ?? 0) * 1000).toISOString().slice(0, 10)
      }));

    const pe = numberOrNull(detail.trailingPE) ?? numberOrNull(stats.trailingPE);
    const forwardPe = numberOrNull(detail.forwardPE) ?? numberOrNull(stats.forwardPE);
    const roePct = percent(financial.returnOnEquity);
    const profitMarginPct = percent(financial.profitMargins);
    const revenueGrowthPct = percent(financial.revenueGrowth);
    const earningsGrowthPct = percent(financial.earningsGrowth);
    const debtToEquityPct = numberOrNull(financial.debtToEquity);
    const dividendYieldPct = percent(detail.dividendYield);
    const bookValue = numberOrNull(stats.bookValue);
    const priceToBook = numberOrNull(detail.priceToBook) ?? numberOrNull(stats.priceToBook);
    const marketCap = numberOrNull(price.marketCap);
    const sector = typeof profile.sector === "string" ? profile.sector : null;
    const name = typeof price.longName === "string" ? price.longName
      : typeof price.shortName === "string" ? price.shortName : symbol.replace(/\.NS$/, "");
    const currency = typeof price.currency === "string" ? price.currency : "INR";
    const targetMeanPrice = numberOrNull(financial.targetMeanPrice);
    const targetLowPrice = numberOrNull(financial.targetLowPrice);
    const targetHighPrice = numberOrNull(financial.targetHighPrice);
    const analystRatingKey = typeof financial.recommendationKey === "string" ? financial.recommendationKey : null;
    const analystRecommendationMean = numberOrNull(financial.recommendationMean);
    const metrics = {
      price: lastPrice, sma50, sma200, return1yPct, return3yPct, roePct,
      profitMarginPct, revenueGrowthPct, earningsGrowthPct, debtToEquityPct, sector
    };
    const assessment = assessLongTerm(metrics);
    const meta = chart?.meta ?? {};
    const chartHigh = closes.length ? Math.max(...closes.slice(-252)) : null;
    const chartLow = closes.length ? Math.min(...closes.slice(-252)) : null;

    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({
      symbol,
      name,
      sector,
      industry: typeof profile.industry === "string" ? profile.industry : null,
      currency,
      price: lastPrice,
      asOf: new Date(timestamps[timestamps.length - 1]! * 1000).toISOString(),
      generatedAt: new Date().toISOString(),
      source: "Yahoo Finance chart and public analyst/fundamental modules (unofficial data interface)",
      sources: [
        { name: "Yahoo Finance quote and analyst data", url: "https://finance.yahoo.com/quote/" + encodeURIComponent(symbol) + "/" },
        { name: "NSE corporate filings and shareholding patterns", url: "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern?symbol=" + encodeURIComponent(symbol.replace(/\.NS$/, "")) }
      ],
      metrics: {
        marketCap, trailingPe: pe, forwardPe, priceToBook, bookValue,
        dividendYieldPct, roePct, profitMarginPct, revenueGrowthPct, earningsGrowthPct,
        debtToEquityPct, targetMeanPrice, targetLowPrice, targetHighPrice,
        analystRatingKey, analystRecommendationMean,
        yearHigh: numberOrNull(meta.fiftyTwoWeekHigh) ?? chartHigh,
        yearLow: numberOrNull(meta.fiftyTwoWeekLow) ?? chartLow,
        sma50, sma200, return1yPct, return3yPct, return5yPct, maxDrawdownPct
      },
      analystConsensus: latestTrend ? {
        period: latestTrend.period ?? "latest",
        strongBuy: numberOrNull(latestTrend.strongBuy) ?? 0,
        buy: numberOrNull(latestTrend.buy) ?? 0,
        hold: numberOrNull(latestTrend.hold) ?? 0,
        sell: numberOrNull(latestTrend.sell) ?? 0,
        strongSell: numberOrNull(latestTrend.strongSell) ?? 0
      } : null,
      brokerHistory,
      assessment,
      dataQuality: {
        completedDailyCandles: closes.length,
        fundamentalsAvailable: [pe, forwardPe, priceToBook, roePct, profitMarginPct, revenueGrowthPct, earningsGrowthPct, debtToEquityPct].filter((v) => v !== null).length,
        analystHistoryAvailable: brokerHistory.length > 0,
        note: summary
          ? "Some fundamental or analyst fields may be blank because providers do not publish every metric for every stock."
          : "Yahoo Finance fundamental/analyst modules were unavailable. This response contains price-history metrics only; the assessment may deliberately return insufficient data."
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown research error";
    const code = message.includes("Not enough") || message.includes("No chart data") ? 502 : 502;
    return res.status(code).json({
      error: "Long-term stock research could not be loaded.",
      detail: message,
      hint: "Use an NSE ticker such as RELIANCE, HDFCBANK or INFY. Public market-data sources can throttle requests; retry later if this is temporary."
    });
  }
}
