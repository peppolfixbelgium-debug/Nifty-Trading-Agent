import { UNIVERSE } from "./universe.js";
import type { Candle } from "./types.js";
import { simulateBacktest, type BacktestResponse, type BacktestStock } from "./backtest-engine.js";

type YahooChartResponse = {
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

type RequestedSymbol = { symbol: string; name: string };

function indiaDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return String(values.year) + "-" + String(values.month) + "-" + String(values.day);
}

async function fetchCandles(symbol: string, startSeconds: number, endSeconds: number): Promise<Candle[]> {
  const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
  url.searchParams.set("period1", String(startSeconds));
  url.searchParams.set("period2", String(endSeconds));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div,splits");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; NiftyTradingAgentBacktest/1.0)"
    },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error("Market data provider returned HTTP " + response.status + " for " + symbol);

  const payload = await response.json() as YahooChartResponse;
  if (payload.chart?.error) {
    throw new Error(payload.chart.error.description || "Market data unavailable for " + symbol);
  }
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) throw new Error("No historical candles returned for " + symbol);

  const todayInIndia = indiaDate(Date.now());
  const candles: Candle[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index] ?? null;
    if (
      !Number.isFinite(timestamp) || !Number.isFinite(open) || !Number.isFinite(high) ||
      !Number.isFinite(low) || !Number.isFinite(close)
    ) continue;
    const time = (timestamp as number) * 1000;
    // Never use the current Indian calendar day's potentially incomplete candle.
    if (indiaDate(time) >= todayInIndia) continue;
    const safeOpen = open as number;
    const safeHigh = high as number;
    const safeLow = low as number;
    const safeClose = close as number;
    if (safeOpen <= 0 || safeHigh < safeLow || safeClose <= 0) continue;
    candles.push({
      time,
      open: safeOpen,
      high: safeHigh,
      low: safeLow,
      close: safeClose,
      volume: typeof volume === "number" && Number.isFinite(volume) && volume >= 0 ? volume : null
    });
  }
  return candles;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item !== undefined) output[index] = await worker(item);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function runHistoricalBacktest(input: {
  years: number;
  capitalInr: number;
  riskPerTradeInr: number;
  costBpsPerSide: number;
}): Promise<BacktestResponse> {
  const years = input.years === 3 ? 3 : 5;
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - years);
  const startSeconds = Math.floor(startDate.getTime() / 1000);
  const endSeconds = Math.floor(endDate.getTime() / 1000);
  const requested: RequestedSymbol[] = [
    { symbol: "^NSEI", name: "Nifty 50" },
    ...UNIVERSE
  ];

  const fetched = await mapWithConcurrency(requested, 8, async (item) => {
    try {
      return { ...item, candles: await fetchCandles(item.symbol, startSeconds, endSeconds), error: null as string | null };
    } catch (error) {
      return {
        ...item,
        candles: [] as Candle[],
        error: error instanceof Error ? error.message : "Unknown market data error"
      };
    }
  });

  const indexResult = fetched.find((item) => item.symbol === "^NSEI");
  if (!indexResult || indexResult.candles.length < 205) {
    throw new Error("Nifty history could not be loaded with at least 205 completed daily candles.");
  }

  const warnings: string[] = [];
  const stocks: BacktestStock[] = [];
  for (const item of fetched) {
    if (item.symbol === "^NSEI") continue;
    if (item.error || item.candles.length < 200) {
      warnings.push(item.symbol + ": " + (item.error || "fewer than 200 historical candles") + "; excluded from this run.");
      continue;
    }
    stocks.push({ symbol: item.symbol, name: item.name, candles: item.candles });
  }
  if (stocks.length === 0) throw new Error("No stock histories loaded successfully; try again later.");

  return simulateBacktest({
    yearsRequested: years,
    capitalInr: input.capitalInr,
    requestedRiskInr: input.riskPerTradeInr,
    costBpsPerSide: input.costBpsPerSide,
    indexCandles: indexResult.candles,
    stocks,
    warnings
  });
}
