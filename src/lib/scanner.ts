import { analyzeStock, classifyMarket } from "./analysis";
import { movingAverage } from "./indicators";
import { UNIVERSE } from "./universe";
import type { Candle, MarketRegime, MarketSummary, ScanResponse, ScanResult } from "./types";

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
      meta?: { regularMarketPrice?: number };
    }>;
    error?: { description?: string } | null;
  };
};

const DATA_SOURCE = "Yahoo Finance chart data";
const CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_POSITION_PCT = 10;
const MAX_RISK_PCT = 1;
const positiveNumber = (value: number, fallback: number, maximum: number): number =>
  Number.isFinite(value) && value > 0 ? Math.min(value, maximum) : fallback;

let lastCache: { key: string; expiresAt: number; value: ScanResponse } | null = null;

async function fetchCandles(symbol: string): Promise<Candle[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "1y");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div%2Csplits");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; NiftyTradingAgent/1.0)"
    },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`Market data provider returned HTTP ${response.status} for ${symbol}`);

  const payload = await response.json() as YahooChartResponse;
  const chart = payload.chart;
  if (chart?.error) throw new Error(chart.error.description || `Market data unavailable for ${symbol}`);
  const result = chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) throw new Error(`No daily candles returned for ${symbol}`);

  const candles: Candle[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index] ?? null;
    if (
      !Number.isFinite(timestamps[index]) ||
      !Number.isFinite(open) || !Number.isFinite(high) ||
      !Number.isFinite(low) || !Number.isFinite(close)
    ) continue;
    const safeOpen = open as number;
    const safeHigh = high as number;
    const safeLow = low as number;
    const safeClose = close as number;
    if (safeHigh < safeLow || safeClose <= 0) continue;
    candles.push({
      time: (timestamps[index] as number) * 1000,
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
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item !== undefined) results[index] = await worker(item);
    }
  });
  await Promise.all(workers);
  return results;
}

function safeMarket(candles: Candle[], vixCandles: Candle[]): MarketSummary {
  const closes = candles.map((candle) => candle.close);
  const current = closes.at(-1);
  const previous = closes.at(-2);
  const sma50 = movingAverage(closes, 50);
  const sma200 = movingAverage(closes, 200);
  const regime: MarketRegime = classifyMarket(current ?? null, sma50, sma200);
  const vix = vixCandles.at(-1)?.close ?? null;
  const vixLabel: MarketSummary["vixLabel"] = vix === null
    ? "UNAVAILABLE"
    : vix >= 25 ? "HIGH" : vix >= 18 ? "ELEVATED" : "NORMAL";
  return {
    ticker: "^NSEI",
    lastPrice: current ?? null,
    changePct: current !== undefined && previous !== undefined && previous !== 0
      ? Math.round((((current / previous) - 1) * 100) * 100) / 100
      : null,
    sma50: sma50 === null ? null : Math.round(sma50 * 100) / 100,
    sma200: sma200 === null ? null : Math.round(sma200 * 100) / 100,
    regime,
    vix: vix === null ? null : Math.round(vix * 100) / 100,
    vixLabel
  };
}

function errorResult(symbol: string, name: string, reason: string): ScanResult {
  return {
    symbol, name, action: "ERROR", reason,
    lastPrice: null, changePct: null, sma20: null, sma50: null, sma200: null,
    rsi14: null, atr14: null, relativeVolume: null,
    trigger: null, stop: null, target: null, riskReward: null,
    quantity: 0, positionValueInr: 0, riskBudgetInr: 0
  };
}

export async function runScan(input: {
  capitalInr?: number;
  riskPerTradeInr?: number;
  forceRefresh?: boolean;
} = {}): Promise<ScanResponse> {
  const capitalInr = positiveNumber(input.capitalInr ?? 100000, 100000, 100000000);
  const requestedRiskInr = positiveNumber(input.riskPerTradeInr ?? 1000, 1000, 1000000);
  const effectiveRiskInr = Math.min(requestedRiskInr, capitalInr * MAX_RISK_PCT / 100);
  const key = `${capitalInr}:${requestedRiskInr}`;
  const now = Date.now();
  if (!input.forceRefresh && lastCache && lastCache.key === key && lastCache.expiresAt > now) {
    return { ...lastCache.value, cached: true };
  }

  const warnings: string[] = [];
  let indexCandles: Candle[] = [];
  let vixCandles: Candle[] = [];
  const [indexResult, vixResult] = await Promise.allSettled([
    fetchCandles("^NSEI"),
    fetchCandles("^INDIAVIX")
  ]);
  if (indexResult.status === "fulfilled") indexCandles = indexResult.value;
  else warnings.push("Nifty index data could not be loaded. Triggered long setups are disabled.");
  if (vixResult.status === "fulfilled") vixCandles = vixResult.value;
  else warnings.push("India VIX data is unavailable. Volatility context is omitted.");

  const market = safeMarket(indexCandles, vixCandles);
  const params = {
    capitalInr,
    requestedRiskInr,
    effectiveRiskInr,
    maxPositionPct: MAX_POSITION_PCT,
    maxRiskPct: MAX_RISK_PCT
  };
  const stockResults = await mapWithConcurrency(UNIVERSE, 5, async (stock) => {
    try {
      const candles = await fetchCandles(stock.symbol);
      return analyzeStock({
        symbol: stock.symbol,
        name: stock.name,
        candles,
        marketRegime: market.regime,
        params: { capitalInr, requestedRiskInr: effectiveRiskInr }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown market data error";
      return errorResult(stock.symbol, stock.name, `${message}. Try refreshing later if the provider is rate-limiting requests.`);
    }
  });

  if (stockResults.every((result) => result.action === "ERROR")) {
    warnings.push("All stock quotes failed. The market-data provider may be unavailable or rate-limiting requests.");
  }
  const response: ScanResponse = {
    generatedAt: new Date().toISOString(),
    cached: false,
    dataSource: DATA_SOURCE,
    market,
    params,
    results: stockResults,
    warnings
  };
  lastCache = { key, expiresAt: Date.now() + CACHE_TTL_MS, value: response };
  return response;
}
