import { INDEX_UNIVERSE } from "./index-universe.js";
import { UNIVERSE } from "./universe.js";
import type { Candle } from "./types.js";

export type ChartRange = "1D" | "5D" | "1M" | "6M" | "1Y" | "5Y";
export type ChartSymbol = { symbol: string; name: string };

export type MarketChartResponse = {
  symbol: string;
  name: string;
  range: ChartRange;
  interval: string;
  dataSource: string;
  freshness: "intraday-provider-snapshot" | "completed-candles";
  generatedAt: string;
  candles: Candle[];
};

const ALLOWED_SYMBOLS: ChartSymbol[] = [...INDEX_UNIVERSE, ...UNIVERSE];
const SYMBOLS = new Map(ALLOWED_SYMBOLS.map((item) => [item.symbol, item]));
const PRESETS: Record<ChartRange, { range: string; interval: string; description: string }> = {
  "1D": { range: "1d", interval: "5m", description: "5-minute intraday candles" },
  "5D": { range: "5d", interval: "15m", description: "15-minute intraday candles" },
  "1M": { range: "1mo", interval: "30m", description: "30-minute candles" },
  "6M": { range: "6mo", interval: "1d", description: "Daily candles" },
  "1Y": { range: "1y", interval: "1d", description: "Daily candles" },
  "5Y": { range: "5y", interval: "1wk", description: "Weekly candles" }
};
const CACHE_MS = 60_000;

type YahooPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

function indiaDate(time: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return String(values.year) + "-" + String(values.month) + "-" + String(values.day);
}

let cache: { key: string; expires: number; value: MarketChartResponse } | null = null;

export function listChartSymbols(): ChartSymbol[] {
  return ALLOWED_SYMBOLS;
}

export async function getMarketChart(symbolValue: string, rangeValue: string, forceRefresh = false): Promise<MarketChartResponse> {
  const stock = SYMBOLS.get(symbolValue);
  if (!stock) throw new Error("That instrument is not in the supported chart universe.");
  const range = (Object.keys(PRESETS) as ChartRange[]).includes(rangeValue as ChartRange)
    ? rangeValue as ChartRange : "1Y";
  const preset = PRESETS[range];
  const key = stock.symbol + ":" + range;
  if (!forceRefresh && cache && cache.key === key && cache.expires > Date.now()) return cache.value;

  const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(stock.symbol));
  url.searchParams.set("range", preset.range);
  url.searchParams.set("interval", preset.interval);
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("includePrePost", "false");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; NiftyTradingAgentChart/1.0)"
    },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error("Chart data provider returned HTTP " + response.status + ".");
  const payload = await response.json() as YahooPayload;
  if (payload.chart?.error) {
    throw new Error(payload.chart.error.description || "Chart data unavailable for " + stock.symbol + ".");
  }
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) throw new Error("No candles returned for " + stock.symbol + " in the selected period.");

  const today = indiaDate(Date.now());
  const candles: Candle[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index] ?? null;
    if (![timestamp, open, high, low, close].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    const time = (timestamp as number) * 1000;
    // For daily/weekly bars, avoid presenting the unfinished current session/week as a completed candle.
    if (preset.interval === "1d" && indiaDate(time) >= today) continue;
    const safeOpen = open as number;
    const safeHigh = high as number;
    const safeLow = low as number;
    const safeClose = close as number;
    if (
      safeOpen <= 0 || safeClose <= 0 || safeHigh < Math.max(safeOpen, safeClose) ||
      safeLow > Math.min(safeOpen, safeClose) || safeHigh < safeLow
    ) continue;
    candles.push({
      time,
      open: safeOpen,
      high: safeHigh,
      low: safeLow,
      close: safeClose,
      volume: typeof volume === "number" && Number.isFinite(volume) && volume >= 0 ? volume : null
    });
  }
  // Yahoo's weekly timestamp represents the week's first session; the last weekly bar can still be forming.
  if (range === "5Y" && candles.length > 1) candles.pop();
  if (candles.length === 0) throw new Error("No complete candles are available for this instrument and period.");

  const output: MarketChartResponse = {
    symbol: stock.symbol,
    name: stock.name,
    range,
    interval: preset.interval,
    dataSource: "Yahoo Finance chart endpoint (unofficial)",
    freshness: ["1D", "5D", "1M"].includes(range) ? "intraday-provider-snapshot" : "completed-candles",
    generatedAt: new Date().toISOString(),
    candles
  };
  cache = { key, expires: Date.now() + CACHE_MS, value: output };
  return output;
}
