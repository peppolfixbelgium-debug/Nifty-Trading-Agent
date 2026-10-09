import { averageTrueRange, averageVolume, movingAverage, relativeStrengthIndex } from "./indicators.js";
import type { Candle, MarketRegime, ScanAction, ScanResult } from "./types.js";

export type AnalysisParams = {
  capitalInr: number;
  requestedRiskInr: number;
};

export function classifyMarket(price: number | null, sma50: number | null, sma200: number | null): MarketRegime {
  if (price === null || sma50 === null || sma200 === null) return "UNAVAILABLE";
  if (price > sma50 && sma50 > sma200) return "BULLISH";
  if (price < sma50 && sma50 < sma200) return "BEARISH";
  return "MIXED";
}

const round = (value: number | null, places = 2): number | null => {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

function emptyResult(
  symbol: string,
  name: string,
  action: ScanAction,
  reason: string,
  candles: Candle[],
  riskBudgetInr: number
): ScanResult {
  const current = candles.at(-1);
  const previous = candles.at(-2);
  const changePct = current && previous && previous.close !== 0
    ? ((current.close / previous.close) - 1) * 100
    : null;
  return {
    symbol, name, action, reason,
    lastPrice: round(current?.close ?? null),
    changePct: round(changePct),
    sma20: null, sma50: null, sma200: null, rsi14: null, atr14: null, relativeVolume: null,
    trigger: null, stop: null, target: null, riskReward: null,
    quantity: 0, positionValueInr: 0, riskBudgetInr
  };
}

export function analyzeStock(input: {
  symbol: string;
  name: string;
  candles: Candle[];
  marketRegime: MarketRegime;
  params: AnalysisParams;
}): ScanResult {
  const { symbol, name, candles, marketRegime, params } = input;
  const effectiveRisk = Math.min(params.requestedRiskInr, params.capitalInr * 0.01);
  if (candles.length < 200) {
    return emptyResult(
      symbol,
      name,
      "INSUFFICIENT_DATA",
      "Fewer than 200 daily candles are available; no setup evaluated.",
      candles,
      effectiveRisk
    );
  }

  const closes = candles.map((candle) => candle.close);
  const current = candles.at(-1);
  const previous = candles.at(-2);
  if (!current || !previous) {
    return emptyResult(symbol, name, "INSUFFICIENT_DATA", "Latest daily candles are unavailable.", candles, effectiveRisk);
  }

  const sma20 = movingAverage(closes, 20);
  const sma50 = movingAverage(closes, 50);
  const sma200 = movingAverage(closes, 200);
  const atr14 = averageTrueRange(candles, 14);
  const rsi14 = relativeStrengthIndex(closes, 14);
  const averageVolume20 = averageVolume(candles.slice(0, -1).map((candle) => candle.volume), 20);
  const relativeVolume = current.volume !== null && averageVolume20 !== null && averageVolume20 > 0
    ? current.volume / averageVolume20
    : null;
  const priorHighCandles = candles.slice(-6, -1);
  const priorFiveDayHigh = priorHighCandles.length === 5
    ? Math.max(...priorHighCandles.map((candle) => candle.high))
    : null;

  if ([sma20, sma50, sma200, atr14, rsi14, priorFiveDayHigh].some((value) => value === null)) {
    return {
      ...emptyResult(symbol, name, "INSUFFICIENT_DATA", "Required technical indicators could not be calculated.", candles, effectiveRisk),
      sma20: round(sma20), sma50: round(sma50), sma200: round(sma200),
      rsi14: round(rsi14), atr14: round(atr14), relativeVolume: round(relativeVolume, 3)
    };
  }

  const trendAligned = current.close > sma20! && sma20! > sma50! && sma50! > sma200!;
  const nearBreakout = current.close < priorFiveDayHigh! + atr14! * 0.1 &&
    current.close >= (priorFiveDayHigh! + atr14! * 0.1) * 0.975;
  const momentumUsable = rsi14! >= 40 && rsi14! <= 72;
  const developingTrend = current.close > sma20! &&
    sma20! >= sma50! * 0.995 &&
    sma50! >= sma200! * 0.97;
  // Early-watch candidates are visible when structure is close to aligning or price is
  // approaching the breakout. This broadens monitoring, but never relaxes trigger rules.
  const watchableStructure = trendAligned ||
    (momentumUsable && (developingTrend || (nearBreakout && current.close > sma50!)));
  const trigger = priorFiveDayHigh! + atr14! * 0.1;
  const stop = trigger - atr14! * 1.5;
  const target = trigger + (trigger - stop) * 2;
  const perShareRisk = trigger - stop;
  const quantityByRisk = perShareRisk > 0 ? Math.floor(effectiveRisk / perShareRisk) : 0;
  const quantityByCapital = trigger > 0 ? Math.floor((params.capitalInr * 0.1) / trigger) : 0;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByCapital));
  const positionValueInr = quantity * trigger;
  const changePct = previous.close !== 0 ? ((current.close / previous.close) - 1) * 100 : null;

  // Diagnose the stock independently first. The market regime is a separate risk gate,
  // so a bearish index must not hide whether an individual stock is strong or weak.
  let stockReason: string;
  if (!trendAligned) {
    const failed = [
      current.close <= sma20! ? `close ${round(current.close)} is not above SMA20 ${round(sma20!)}` : null,
      sma20! <= sma50! ? `SMA20 ${round(sma20!)} is not above SMA50 ${round(sma50!)}` : null,
      sma50! <= sma200! ? `SMA50 ${round(sma50!)} is not above SMA200 ${round(sma200!)}` : null
    ].filter((part): part is string => part !== null);
    stockReason = `Stock trend is not fully aligned: ${failed.join("; ")}.`;
  } else if (rsi14! > 70) {
    stockReason = `Stock trend is aligned, but RSI is overbought at ${round(rsi14!)} (rule: 70 or lower).`;
  } else if (current.close < trigger) {
    stockReason = `Stock trend is aligned; close ${round(current.close)} is below breakout trigger ${round(trigger)}.`;
  } else if (relativeVolume === null) {
    stockReason = "Price has cleared the breakout level, but relative volume cannot be confirmed from available data.";
  } else if (relativeVolume < 1.1) {
    stockReason = `Breakout level cleared, but relative volume is ${round(relativeVolume, 2)}x; at least 1.1x is required.`;
  } else if (rsi14! < 50) {
    stockReason = `Trend, price and volume are aligned, but RSI is ${round(rsi14!)}; at least 50 is required.`;
  } else {
    stockReason = "Stock-specific trend, breakout, volume and momentum conditions are satisfied.";
  }

  let action: ScanAction = "AVOID";
  let reason = stockReason;

  if (marketRegime === "BEARISH") {
    action = watchableStructure ? "WATCH" : "AVOID";
    reason = `${stockReason} Market filter: Nifty regime is bearish, so new long entries remain blocked. ${watchableStructure ? "WATCH means monitor-only; the stock has developing/aligned structure, not a permitted entry." : "The stock structure also fails the early-watch rules."}`;
  } else if (marketRegime === "UNAVAILABLE") {
    action = watchableStructure ? "WATCH" : "AVOID";
    reason = `${stockReason} Market confirmation is unavailable; no long trigger can be issued until index data is restored.`;
  } else if (rsi14! > 70) {
    action = watchableStructure ? "WATCH" : "AVOID";
    reason = `${stockReason} Monitor only; RSI must cool into the entry band before a long trigger can qualify.`;
  } else if (trendAligned && marketRegime === "BULLISH" && current.close >= trigger && relativeVolume !== null && relativeVolume >= 1.1 && rsi14! >= 50 && rsi14! <= 70) {
    action = "TRIGGERED";
    reason = "Daily close cleared the 5-session breakout level with aligned trend, volume, RSI and bullish Nifty regime. This is a screen result, not an order.";
  } else if (watchableStructure) {
    action = "WATCH";
    reason = `${stockReason} Early-watch candidate only; it has not passed every entry requirement.`;
  }

  return {
    symbol, name, action, reason,
    lastPrice: round(current.close), changePct: round(changePct),
    sma20: round(sma20), sma50: round(sma50), sma200: round(sma200),
    rsi14: round(rsi14), atr14: round(atr14), relativeVolume: round(relativeVolume, 3),
    trigger: round(trigger), stop: round(stop), target: round(target), riskReward: round((target - trigger) / (trigger - stop), 2),
    quantity, positionValueInr: round(positionValueInr) ?? 0,
    riskBudgetInr: round(effectiveRisk) ?? 0
  };
}
