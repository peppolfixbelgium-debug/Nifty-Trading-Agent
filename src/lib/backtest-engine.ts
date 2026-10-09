import { averageTrueRange, averageVolume, movingAverage, relativeStrengthIndex } from "./indicators.js";
import type { Candle, MarketRegime } from "./types.js";

export type BacktestStock = {
  symbol: string;
  name: string;
  candles: Candle[];
};

export type BacktestTrade = {
  symbol: string;
  name: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnlInr: number;
  costsInr: number;
  netPnlInr: number;
  rMultiple: number;
  holdingDays: number;
  exitReason: "STOP" | "TARGET" | "TIME_EXIT" | "END_OF_DATA";
};

export type EquityPoint = { date: string; equityInr: number };

export type BacktestResponse = {
  generatedAt: string;
  dataSource: string;
  assumptions: {
    yearsRequested: number;
    costBpsPerSide: number;
    maxHoldingDays: number;
    maxPositionPct: number;
    maxRiskPct: number;
    portfolioRule: string;
    entryRule: string;
    sameDayStopAndTargetRule: string;
  };
  period: { startDate: string; endDate: string };
  capitalInr: number;
  riskPerTradeInr: number;
  metrics: {
    finalEquityInr: number;
    netProfitInr: number;
    totalReturnPct: number;
    cagrPct: number | null;
    benchmarkFinalInr: number;
    benchmarkReturnPct: number;
    benchmarkCagrPct: number | null;
    maxDrawdownPct: number;
    tradeCount: number;
    wins: number;
    losses: number;
    winRatePct: number;
    profitFactor: number | null;
    averageR: number | null;
    totalCostsInr: number;
    loadedSymbols: number;
  };
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  warnings: string[];
};

type Signal = {
  symbol: string;
  name: string;
  atr: number;
  relativeVolume: number;
  score: number;
};

type OpenTrade = {
  symbol: string;
  name: string;
  entryDate: string;
  entryDayIndex: number;
  entryPrice: number;
  stop: number;
  target: number;
  quantity: number;
  entryCost: number;
  initialRiskInr: number;
};

type BacktestOptions = {
  yearsRequested: number;
  capitalInr: number;
  requestedRiskInr: number;
  costBpsPerSide: number;
  indexCandles: Candle[];
  stocks: BacktestStock[];
  warnings?: string[];
};

const MAX_POSITION_PCT = 10;
const MAX_RISK_PCT = 1;
const MAX_HOLDING_DAYS = 20;
const rounded = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const dateKey = (time: number): string => new Date(time).toISOString().slice(0, 10);

function marketRegimeAt(indexCandles: Candle[], index: number): MarketRegime {
  if (index < 199) return "UNAVAILABLE";
  const closes = indexCandles.slice(index - 199, index + 1).map((item) => item.close);
  const current = closes.at(-1);
  const sma50 = movingAverage(closes.slice(-50), 50);
  const sma200 = movingAverage(closes, 200);
  if (current === undefined || sma50 === null || sma200 === null) return "UNAVAILABLE";
  if (current > sma50 && sma50 > sma200) return "BULLISH";
  if (current < sma50 && sma50 < sma200) return "BEARISH";
  return "MIXED";
}

function signalAt(
  stock: BacktestStock,
  stockIndex: number,
  indexCandles: Candle[],
  marketIndex: number
): Signal | null {
  if (stockIndex < 199 || marketIndex < 199) return null;
  const candles = stock.candles;
  const current = candles[stockIndex];
  if (!current) return null;

  const history = candles.slice(Math.max(0, stockIndex - 199), stockIndex + 1);
  const closes = history.map((item) => item.close);
  const sma20 = movingAverage(closes.slice(-20), 20);
  const sma50 = movingAverage(closes.slice(-50), 50);
  const sma200 = movingAverage(closes, 200);
  const atr = averageTrueRange(history.slice(-15), 14);
  const rsi = relativeStrengthIndex(closes.slice(-15), 14);
  const previousVolume = averageVolume(
    candles.slice(stockIndex - 20, stockIndex).map((item) => item.volume),
    20
  );
  const recentHighs = candles.slice(stockIndex - 5, stockIndex).map((item) => item.high);
  if (
    sma20 === null || sma50 === null || sma200 === null || atr === null || rsi === null ||
    previousVolume === null || previousVolume <= 0 || recentHighs.length !== 5
  ) return null;

  const relativeVolume = current.volume === null ? null : current.volume / previousVolume;
  const breakoutLevel = Math.max(...recentHighs) + 0.1 * atr;
  const aligned = current.close > sma20 && sma20 > sma50 && sma50 > sma200;
  const regime = marketRegimeAt(indexCandles, marketIndex);
  if (
    !aligned || regime !== "BULLISH" || current.close < breakoutLevel ||
    relativeVolume === null || relativeVolume < 1.1 || rsi < 50 || rsi > 70
  ) return null;

  return {
    symbol: stock.symbol,
    name: stock.name,
    atr,
    relativeVolume,
    score: relativeVolume + Math.max(0, (current.close - breakoutLevel) / Math.max(atr, 0.000001))
  };
}

/**
 * Historical simulation with no look-ahead: signals are decided at the completed
 * daily close and may only enter at the following session's open.
 * A single open position is allowed to keep portfolio exposure unambiguous.
 */
export function simulateBacktest(options: BacktestOptions): BacktestResponse {
  const capitalInr = Math.max(1, options.capitalInr);
  const requestedRiskInr = Math.max(1, options.requestedRiskInr);
  const riskBudgetInr = Math.min(requestedRiskInr, capitalInr * MAX_RISK_PCT / 100);
  const costRate = Math.max(0, options.costBpsPerSide) / 10_000;
  const indexCandles = [...options.indexCandles].sort((a, b) => a.time - b.time);
  const dates = indexCandles.map((item) => dateKey(item.time));
  if (dates.length < 205) throw new Error("At least 205 completed Nifty daily candles are required.");
  const indexByDate = new Map<string, number>();
  indexCandles.forEach((item, index) => indexByDate.set(dateKey(item.time), index));

  const usableStocks = options.stocks
    .filter((stock) => stock.candles.length >= 200)
    .map((stock) => ({
      ...stock,
      candles: [...stock.candles].sort((a, b) => a.time - b.time),
      indexByDate: new Map<string, number>()
    }));
  for (const stock of usableStocks) {
    stock.candles.forEach((bar, index) => stock.indexByDate.set(dateKey(bar.time), index));
  }
  if (usableStocks.length === 0) throw new Error("No stock has enough historical candles to evaluate the strategy.");

  const timelineStartIndex = Math.max(199, dates.findIndex((date) => {
    const marketIndex = indexByDate.get(date);
    if (marketIndex === undefined || marketIndex < 199) return false;
    return usableStocks.some((stock) => (stock.indexByDate.get(date) ?? -1) >= 199);
  }));
  if (timelineStartIndex < 199 || timelineStartIndex >= dates.length - 1) {
    throw new Error("Not enough overlapping historical data after indicator warm-up.");
  }

  let cash = capitalInr;
  let openTrade: OpenTrade | null = null;
  let pendingSignal: Signal | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let totalCostsInr = 0;
  const startDate = dates[timelineStartIndex];
  const endDate = dates[dates.length - 1];
  const initialRiskPct = riskBudgetInr / capitalInr;

  const closePosition = (exitDate: string, exitPrice: number, exitReason: BacktestTrade["exitReason"], dayIndex: number) => {
    if (!openTrade) return;
    const exitCost = openTrade.quantity * exitPrice * costRate;
    cash += openTrade.quantity * exitPrice - exitCost;
    const grossPnl = openTrade.quantity * (exitPrice - openTrade.entryPrice);
    const costs = openTrade.entryCost + exitCost;
    const netPnl = grossPnl - costs;
    totalCostsInr += costs;
    trades.push({
      symbol: openTrade.symbol,
      name: openTrade.name,
      entryDate: openTrade.entryDate,
      exitDate,
      entryPrice: rounded(openTrade.entryPrice, 4),
      exitPrice: rounded(exitPrice, 4),
      quantity: openTrade.quantity,
      grossPnlInr: rounded(grossPnl),
      costsInr: rounded(costs),
      netPnlInr: rounded(netPnl),
      rMultiple: rounded(netPnl / Math.max(openTrade.initialRiskInr, 0.01), 3),
      holdingDays: Math.max(1, dayIndex - openTrade.entryDayIndex + 1),
      exitReason
    });
    openTrade = null;
  };

  for (let dayIndex = timelineStartIndex; dayIndex < dates.length; dayIndex += 1) {
    const date = dates[dayIndex];
    if (date === undefined) continue;

    if (pendingSignal && !openTrade) {
      const candidate = usableStocks.find((stock) => stock.symbol === pendingSignal?.symbol);
      const candidateIndex = candidate?.indexByDate.get(date);
      const bar = candidateIndex === undefined ? undefined : candidate?.candles[candidateIndex];
      if (candidate && bar && bar.open > 0) {
        const stopDistance = 1.5 * pendingSignal.atr;
        const notionalLimit = capitalInr * MAX_POSITION_PCT / 100;
        const quantityByRisk = Math.floor(riskBudgetInr / stopDistance);
        const quantityByPosition = Math.floor(notionalLimit / bar.open);
        const quantityByCash = Math.floor(cash / (bar.open * (1 + costRate)));
        const quantity = Math.max(0, Math.min(quantityByRisk, quantityByPosition, quantityByCash));
        if (quantity > 0) {
          const entryCost = quantity * bar.open * costRate;
          cash -= quantity * bar.open + entryCost;
          openTrade = {
            symbol: candidate.symbol,
            name: candidate.name,
            entryDate: date,
            entryDayIndex: dayIndex,
            entryPrice: bar.open,
            stop: bar.open - stopDistance,
            target: bar.open + stopDistance * 2,
            quantity,
            entryCost,
            initialRiskInr: stopDistance * quantity
          };
        }
      }
      pendingSignal = null;
    }

    if (openTrade) {
      const stock = usableStocks.find((item) => item.symbol === openTrade?.symbol);
      const stockIndex = stock?.indexByDate.get(date);
      const bar = stockIndex === undefined ? undefined : stock?.candles[stockIndex];
      if (bar) {
        const trade = openTrade;
        let exitPrice: number | null = null;
        let exitReason: BacktestTrade["exitReason"] | null = null;

        if (bar.open <= trade.stop) {
          exitPrice = bar.open;
          exitReason = "STOP";
        } else if (bar.open >= trade.target) {
          exitPrice = bar.open;
          exitReason = "TARGET";
        } else if (bar.low <= trade.stop && bar.high >= trade.target) {
          // With OHLC bars the intraday order is unknown; assume the adverse level won.
          exitPrice = trade.stop;
          exitReason = "STOP";
        } else if (bar.low <= trade.stop) {
          exitPrice = trade.stop;
          exitReason = "STOP";
        } else if (bar.high >= trade.target) {
          exitPrice = trade.target;
          exitReason = "TARGET";
        } else if (dayIndex - trade.entryDayIndex + 1 >= MAX_HOLDING_DAYS) {
          exitPrice = bar.close;
          exitReason = "TIME_EXIT";
        } else if (dayIndex === dates.length - 1) {
          exitPrice = bar.close;
          exitReason = "END_OF_DATA";
        }

        if (exitPrice !== null && exitReason !== null) {
          closePosition(date, exitPrice, exitReason, dayIndex);
        }
      } else if (dayIndex === dates.length - 1 && openTrade) {
        closePosition(date, openTrade.entryPrice, "END_OF_DATA", dayIndex);
      }
    }

    if (!openTrade && !pendingSignal && dayIndex < dates.length - 1) {
      const marketIndex = indexByDate.get(date);
      if (marketIndex !== undefined && marketRegimeAt(indexCandles, marketIndex) === "BULLISH") {
        const candidates: Signal[] = [];
        for (const stock of usableStocks) {
          const stockIndex = stock.indexByDate.get(date);
          if (stockIndex === undefined) continue;
          const signal = signalAt(stock, stockIndex, indexCandles, marketIndex);
          if (signal) candidates.push(signal);
        }
        candidates.sort((a, b) => b.score - a.score);
        pendingSignal = candidates[0] ?? null;
      }
    }

    const currentTradeStock = openTrade ? usableStocks.find((stock) => stock.symbol === openTrade?.symbol) : undefined;
    const currentTradeIndex = currentTradeStock?.indexByDate.get(date);
    const mark = currentTradeIndex === undefined ? undefined : currentTradeStock?.candles[currentTradeIndex]?.close;
    const equityInr = cash + (openTrade && mark !== undefined ? openTrade.quantity * mark : 0);
    equityCurve.push({ date, equityInr: rounded(equityInr) });
  }

  const finalEquityInr = equityCurve.at(-1)?.equityInr ?? cash;
  const netProfitInr = finalEquityInr - capitalInr;
  const totalReturnPct = (finalEquityInr / capitalInr - 1) * 100;
  let peak = capitalInr;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equityInr);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equityInr) / peak) * 100);
  }

  const wins = trades.filter((trade) => trade.netPnlInr > 0).length;
  const losses = trades.filter((trade) => trade.netPnlInr < 0).length;
  const totalWinningPnl = trades.reduce((sum, trade) => sum + Math.max(0, trade.netPnlInr), 0);
  const totalLosingPnl = trades.reduce((sum, trade) => sum + Math.max(0, -trade.netPnlInr), 0);
  const profitFactor = totalLosingPnl > 0 ? totalWinningPnl / totalLosingPnl : totalWinningPnl > 0 ? null : 0;
  const averageR = trades.length ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length : null;
  const elapsedDays = Math.max(1, (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000);
  const yearsElapsed = elapsedDays / 365.25;
  const cagrPct = finalEquityInr > 0 ? (Math.pow(finalEquityInr / capitalInr, 1 / yearsElapsed) - 1) * 100 : null;

  const indexStart = indexByDate.get(startDate);
  const indexEnd = indexByDate.get(endDate);
  const startIndexClose = indexStart === undefined ? undefined : indexCandles[indexStart]?.close;
  const endIndexClose = indexEnd === undefined ? undefined : indexCandles[indexEnd]?.close;
  const benchmarkFactor = startIndexClose && endIndexClose
    ? (endIndexClose / startIndexClose) * (1 - costRate) / (1 + costRate)
    : 1;
  const benchmarkFinalInr = capitalInr * benchmarkFactor;
  const benchmarkReturnPct = (benchmarkFactor - 1) * 100;
  const benchmarkCagrPct = benchmarkFinalInr > 0
    ? (Math.pow(benchmarkFinalInr / capitalInr, 1 / yearsElapsed) - 1) * 100
    : null;

  return {
    generatedAt: new Date().toISOString(),
    dataSource: "Yahoo Finance chart data (unofficial; completed daily candles only)",
    assumptions: {
      yearsRequested: options.yearsRequested,
      costBpsPerSide: options.costBpsPerSide,
      maxHoldingDays: MAX_HOLDING_DAYS,
      maxPositionPct: MAX_POSITION_PCT,
      maxRiskPct: MAX_RISK_PCT,
      portfolioRule: "One open position at a time; strongest relative-volume signal is selected.",
      entryRule: "Signal calculated after a completed daily close; entry at the next session open.",
      sameDayStopAndTargetRule: "If both stop and target fall within the same OHLC candle, assume the stop was hit first."
    },
    period: { startDate, endDate },
    capitalInr: rounded(capitalInr),
    riskPerTradeInr: rounded(riskBudgetInr),
    metrics: {
      finalEquityInr: rounded(finalEquityInr),
      netProfitInr: rounded(netProfitInr),
      totalReturnPct: rounded(totalReturnPct),
      cagrPct: cagrPct === null ? null : rounded(cagrPct),
      benchmarkFinalInr: rounded(benchmarkFinalInr),
      benchmarkReturnPct: rounded(benchmarkReturnPct),
      benchmarkCagrPct: benchmarkCagrPct === null ? null : rounded(benchmarkCagrPct),
      maxDrawdownPct: rounded(maxDrawdownPct),
      tradeCount: trades.length,
      wins,
      losses,
      winRatePct: trades.length ? rounded((wins / trades.length) * 100) : 0,
      profitFactor: profitFactor === null ? null : rounded(profitFactor, 3),
      averageR: averageR === null ? null : rounded(averageR, 3),
      totalCostsInr: rounded(totalCostsInr),
      loadedSymbols: usableStocks.length
    },
    equityCurve,
    trades,
    warnings: options.warnings ?? []
  };
}
