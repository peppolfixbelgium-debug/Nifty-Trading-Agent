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

export async function fetchCandles(symbol: string, startSeconds: number, endSeconds: number): Promise<Candle[]> {
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
    if (
      safeOpen <= 0 || safeClose <= 0 || safeHigh < safeLow ||
      safeHigh < Math.max(safeOpen, safeClose) ||
      safeLow > Math.min(safeOpen, safeClose)
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

  const expectedStartDate = startDate.toISOString().slice(0, 10);
  const expectedEndDate = endDate.toISOString().slice(0, 10);
  const marketFirstDate = new Date(indexResult.candles[0]!.time).toISOString().slice(0, 10);
  const marketLastDate = new Date(indexResult.candles.at(-1)!.time).toISOString().slice(0, 10);
  const calendarDays = (later: string, earlier: string) =>
    Math.round((Date.parse(later + "T00:00:00Z") - Date.parse(earlier + "T00:00:00Z")) / 86_400_000);
  const requestedDays = Math.max(1, calendarDays(expectedEndDate, expectedStartDate));
  const actualDays = Math.max(0, calendarDays(marketLastDate, marketFirstDate));
  const marketCoveragePct = Math.max(0, Math.min(100, Math.round((actualDays / requestedDays) * 1000) / 10));
  const startLagDays = calendarDays(marketFirstDate, expectedStartDate);
  const endLagDays = calendarDays(expectedEndDate, marketLastDate);
  // Two weeks at the front and one week at the end allow for exchange holidays.
  const marketHistoryComplete = startLagDays <= 14 && startLagDays >= -7 && endLagDays <= 7 && endLagDays >= -7;
  const fullWindowStocks = stocks.filter((stock) => {
    const first = stock.candles[0];
    const last = stock.candles.at(-1);
    if (!first || !last) return false;
    const firstDate = new Date(first.time).toISOString().slice(0, 10);
    const lastDate = new Date(last.time).toISOString().slice(0, 10);
    return calendarDays(firstDate, expectedStartDate) <= 14 &&
      calendarDays(firstDate, expectedStartDate) >= -7 &&
      calendarDays(marketLastDate, lastDate) <= 7 &&
      stock.candles.length >= indexResult.candles.length * 0.8;
  });

  const sharedOptions = {
    yearsRequested: years,
    capitalInr: input.capitalInr,
    requestedRiskInr: input.riskPerTradeInr,
    costBpsPerSide: input.costBpsPerSide,
    indexCandles: indexResult.candles,
    stocks,
    warnings
  };
  const fullResult = simulateBacktest(sharedOptions);
  const fullStartIndex = indexResult.candles.findIndex((bar) =>
    new Date(bar.time).toISOString().slice(0, 10) >= fullResult.period.startDate
  );
  const evaluationStartIndex = Math.min(
    indexResult.candles.length - 2,
    Math.max(fullStartIndex + 1, fullStartIndex + Math.floor((indexResult.candles.length - fullStartIndex) * 0.75))
  );
  const evaluationStartDate = new Date(indexResult.candles[evaluationStartIndex]!.time).toISOString().slice(0, 10);
  const outOfSampleResult = simulateBacktest({ ...sharedOptions, evaluationStartDate });
  fullResult.outOfSample = {
    period: outOfSampleResult.period,
    metrics: {
      finalEquityInr: outOfSampleResult.metrics.finalEquityInr,
      netProfitInr: outOfSampleResult.metrics.netProfitInr,
      totalReturnPct: outOfSampleResult.metrics.totalReturnPct,
      benchmarkReturnPct: outOfSampleResult.metrics.benchmarkReturnPct,
      maxDrawdownPct: outOfSampleResult.metrics.maxDrawdownPct,
      tradeCount: outOfSampleResult.metrics.tradeCount,
      winRatePct: outOfSampleResult.metrics.winRatePct,
      profitFactor: outOfSampleResult.metrics.profitFactor
    }
  };

  const coverageReasons: string[] = [];
  if (!marketHistoryComplete) {
    coverageReasons.push(
      `Nifty history does not cover the requested ${years}-year window: requested ${expectedStartDate} to ${expectedEndDate}, received ${marketFirstDate} to ${marketLastDate}.`
    );
  }
  if (fullWindowStocks.length < stocks.length) {
    coverageReasons.push(
      `${stocks.length - fullWindowStocks.length} loaded stock(s) do not have sufficiently complete history for the entire requested window.`
    );
  }
  if (warnings.length > 0) {
    coverageReasons.push(`${warnings.length} symbol/data warning(s) occurred during loading; inspect the warning list before trusting comparisons.`);
  }
  if (!fullResult.accounting.reconciled) {
    coverageReasons.push(
      `Accounting did not reconcile: equity-derived P&L differs from closed-trade P&L by ${fullResult.accounting.reconciliationDifferenceInr} INR.`
    );
  }
  const rankingReasons = [...coverageReasons];
  if (fullResult.metrics.tradeCount < 30) {
    rankingReasons.push(`Only ${fullResult.metrics.tradeCount} closed trade(s); at least 30 are required for ranking.`);
  }
  if (outOfSampleResult.metrics.tradeCount < 10) {
    rankingReasons.push(`Only ${outOfSampleResult.metrics.tradeCount} holdout trade(s); at least 10 are required for a minimally informative out-of-sample check.`);
  }
  const coveragePassed = marketHistoryComplete &&
    fullWindowStocks.length === stocks.length &&
    warnings.length === 0 &&
    fullResult.accounting.reconciled;
  fullResult.dataQuality = {
    requestedPeriod: { startDate: expectedStartDate, endDate: expectedEndDate },
    marketDataPeriod: { startDate: marketFirstDate, endDate: marketLastDate },
    marketCoveragePct,
    actualMarketCandles: indexResult.candles.length,
    symbolsRequested: UNIVERSE.length,
    symbolsLoaded: stocks.length,
    symbolsWithFullWindow: fullWindowStocks.length,
    symbolsExcluded: UNIVERSE.length - stocks.length,
    marketHistoryComplete,
    status: !marketHistoryComplete ? "FAIL" : coveragePassed ? "PASS" : "LIMITED",
    reasons: coverageReasons
  };
  fullResult.rankingEligibility = {
    eligible: coveragePassed && fullResult.metrics.tradeCount >= 30 && outOfSampleResult.metrics.tradeCount >= 10,
    minimumTrades: 30,
    completedTrades: fullResult.metrics.tradeCount,
    outOfSampleTrades: outOfSampleResult.metrics.tradeCount,
    reasons: rankingReasons
  };
  return fullResult;
}
