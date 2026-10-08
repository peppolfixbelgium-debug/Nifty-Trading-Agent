import { averageTrueRange, averageVolume, movingAverage, relativeStrengthIndex } from "./indicators";
import type { Candle, MarketRegime, ScanAction, ScanResult } from "./types";

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
  const trigger = priorFiveDayHigh! + atr14! * 0.1;
  const stop = trigger - atr14! * 1.5;
  const target = trigger + (trigger - stop) * 2;
  const perShareRisk = trigger - stop;
  const quantityByRisk = perShareRisk > 0 ? Math.floor(effectiveRisk / perShareRisk) : 0;
  const quantityByCapital = trigger > 0 ? Math.floor((params.capitalInr * 0.1) / trigger) : 0;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByCapital));
  const positionValueInr = quantity * trigger;
  const changePct = previous.close !== 0 ? ((current.close / previous.close) - 1) * 100 : null;

  let action: ScanAction = "AVOID";
  let reason = "Trend alignment is incomplete; stand aside until conditions improve.";

  if (marketRegime === "BEARISH") {
    action = "AVOID";
    reason = "Nifty regime is bearish; new long setups are blocked by the market filter.";
  } else if (marketRegime === "UNAVAILABLE") {
    action = "WATCH";
    reason = "Nifty regime data is unavailable; wait for market confirmation.";
  } else if (rsi14! > 70) {
    action = trendAligned ? "WATCH" : "AVOID";
    reason = trendAligned
      ? "Trend is aligned, but RSI is extended above 70; avoid chasing."
      : "RSI is extended and trend alignment is incomplete.";
  } else if (trendAligned && marketRegime === "BULLISH" && current.close >= trigger && relativeVolume !== null && relativeVolume >= 1.1 && rsi14! >= 50) {
    action = "TRIGGERED";
    reason = "Daily close cleared the 5-session breakout level with aligned trend, volume, RSI and bullish Nifty regime. This is a screen result, not an order.";
  } else if (trendAligned) {
    action = "WATCH";
    if (marketRegime !== "BULLISH") reason = "Stock trend is aligned, but Nifty is not fully bullish; wait for market confirmation.";
    else if (current.close < trigger) reason = "Trend is aligned; wait for a daily close above the breakout trigger.";
    else if (relativeVolume === null) reason = "Trend and price conditions are aligned, but volume confirmation is unavailable.";
    else if (relativeVolume < 1.1) reason = "Trend is aligned; relative volume is below the 1.1x confirmation threshold.";
    else reason = "Trend is aligned, but the RSI confirmation threshold is not met.";
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
