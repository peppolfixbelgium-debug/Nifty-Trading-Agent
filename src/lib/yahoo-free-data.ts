import type { Candle } from "./types.js";

export type DataRecord = Record<string, unknown>;
export type YahooHistoryResult = { candles: Candle[]; dataAsOf: string | null };
export type YahooSummaryResult = { summary: DataRecord | null; warning: string | null };

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  referer: "https://finance.yahoo.com/"
};

let authCache: { cookie: string; crumb: string; expiresAt: number } | null = null;
const summaryCache = new Map<string, { expiresAt: number; summary: DataRecord }>();

export function asRecord(value: unknown): DataRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as DataRecord : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function numeric(value: unknown): number | null {
  const unwrapped = asRecord(value).raw ?? value;
  const converted = typeof unwrapped === "number" ? unwrapped : typeof unwrapped === "string" && unwrapped.trim() ? Number(unwrapped) : NaN;
  return Number.isFinite(converted) ? converted : null;
}

export function textValue(value: unknown): string | null {
  const record = asRecord(value);
  const candidate = record.longFmt ?? record.fmt ?? record.raw ?? value;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

export function normalizeNseYahooSymbol(value: string): string {
  const trimmed = value.trim().toUpperCase();
  const stock = trimmed.endsWith(".NS") ? trimmed.slice(0, -3) : trimmed;
  if (!/^[A-Z0-9&-]{1,25}$/.test(stock)) throw new Error("Enter an NSE stock symbol, such as RELIANCE, INFY or HDFCBANK.");
  return stock + ".NS";
}

function cookieParts(response: Response): string[] {
  const extended = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return values.flatMap(value => value.split(/,(?=[^;,]+=)/)).map(value => value.split(";")[0]?.trim() ?? "").filter(Boolean);
}

async function getYahooAuth(): Promise<{ cookie: string; crumb: string }> {
  if (authCache && authCache.expiresAt > Date.now()) return authCache;
  const cookieJar = new Set<string>();
  let bootstrapError: string | null = null;
  try {
    const bootstrap = await fetch("https://fc.yahoo.com/", { headers, signal: AbortSignal.timeout(8_000), redirect: "follow" });
    cookieParts(bootstrap).forEach(cookie => cookieJar.add(cookie));
  } catch (error) {
    bootstrapError = error instanceof Error ? error.message : "Yahoo cookie bootstrap failed.";
  }
  const cookie = [...cookieJar].join("; ");
  const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(8_000)
  });
  if (!crumbResponse.ok) throw new Error("Yahoo Finance fundamentals authentication returned HTTP " + crumbResponse.status + (bootstrapError ? " (" + bootstrapError + ")" : "") + ".");
  const crumb = (await crumbResponse.text()).trim();
  if (!crumb || crumb.startsWith("{") || crumb.length > 200) throw new Error("Yahoo Finance did not issue a usable fundamentals token.");
  cookieParts(crumbResponse).forEach(item => cookieJar.add(item));
  const result = { cookie: [...cookieJar].join("; "), crumb, expiresAt: Date.now() + 20 * 60_000 };
  authCache = result;
  return result;
}

export async function getYahooQuoteSummary(symbolValue: string): Promise<YahooSummaryResult> {
  const symbol = normalizeNseYahooSymbol(symbolValue);
  const cached = summaryCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return { summary: cached.summary, warning: null };
  try {
    const auth = await getYahooAuth();
    const url = new URL("https://query1.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(symbol));
    url.searchParams.set("modules", [
      "price", "quoteType", "summaryDetail", "summaryProfile", "defaultKeyStatistics", "financialData",
      "recommendationTrend", "upgradeDowngradeHistory", "institutionOwnership", "fundOwnership",
      "majorHoldersBreakdown", "earningsTrend", "earningsHistory"
    ].join(","));
    url.searchParams.set("formatted", "false");
    url.searchParams.set("lang", "en-US");
    url.searchParams.set("region", "IN");
    url.searchParams.set("crumb", auth.crumb);
    url.searchParams.set("corsDomain", "finance.yahoo.com");
    const response = await fetch(url, {
      headers: { ...headers, ...(auth.cookie ? { cookie: auth.cookie } : {}) },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) throw new Error("Yahoo Finance quote summary returned HTTP " + response.status + ".");
    const payload = asRecord(await response.json());
    const root = asRecord(payload.quoteSummary);
    const result = asArray(root.result)[0];
    const summary = asRecord(result);
    if (!Object.keys(summary).length) {
      const err = asRecord(root.error);
      throw new Error(textValue(err.description) ?? textValue(err.code) ?? "Yahoo Finance returned no quote-summary modules.");
    }
    summaryCache.set(symbol, { summary, expiresAt: Date.now() + 30 * 60_000 });
    return { summary, warning: null };
  } catch (error) {
    return {
      summary: null,
      warning: error instanceof Error ? error.message : "Yahoo Finance fundamentals are temporarily unavailable."
    };
  }
}

export async function getYahooDailyHistory(symbolValue: string): Promise<YahooHistoryResult> {
  const symbol = normalizeNseYahooSymbol(symbolValue);
  const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
  url.searchParams.set("range", "1y");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("includePrePost", "false");
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("Yahoo Finance price history returned HTTP " + response.status + ".");
  const payload = asRecord(await response.json());
  const chart = asRecord(payload.chart);
  const results = asArray(chart.result);
  const result = asRecord(results[0]);
  if (chart.error) throw new Error(textValue(asRecord(chart.error).description) ?? "Yahoo Finance history is unavailable for this symbol.");
  const timestamps = asArray(result.timestamp);
  const indicators = asRecord(result.indicators);
  const quotes = asArray(indicators.quote);
  const quote = asRecord(quotes[0]);
  const opens = asArray(quote.open);
  const highs = asArray(quote.high);
  const lows = asArray(quote.low);
  const closes = asArray(quote.close);
  const volumes = asArray(quote.volume);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const candles: Candle[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const seconds = numeric(timestamps[index]);
    const open = numeric(opens[index]);
    const high = numeric(highs[index]);
    const low = numeric(lows[index]);
    const close = numeric(closes[index]);
    const volume = numeric(volumes[index]);
    if (seconds === null || open === null || high === null || low === null || close === null) continue;
    const time = seconds * 1000;
    const candleDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
    if (candleDate >= today) continue;
    if (open <= 0 || close <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
    candles.push({ time, open, high, low, close, volume: volume !== null && volume >= 0 ? volume : null });
  }
  candles.sort((a, b) => a.time - b.time);
  if (!candles.length) throw new Error("Yahoo Finance returned no completed daily candles for " + symbol + ".");
  return { candles, dataAsOf: new Date(candles[candles.length - 1]!.time).toISOString() };
}
