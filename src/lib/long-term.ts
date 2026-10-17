import type { Candle } from "./types.js";

export type LongTermMetrics = {
  latestPrice: number;
  previousPrice: number | null;
  dailyChangePct: number | null;
  oneYearReturnPct: number | null;
  threeYearCagrPct: number | null;
  fiveYearCagrPct: number | null;
  sma50: number | null;
  sma200: number | null;
  distanceFromSma200Pct: number | null;
  high52Week: number | null;
  low52Week: number | null;
  drawdownFromHighPct: number | null;
  maxDrawdownPct: number | null;
  annualizedVolatilityPct: number | null;
  rsi14: number | null;
  candleCount: number;
};

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function cagr(candles: Candle[], years: number): number | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1]!;
  const cutoff = last.time - years * 365.25 * 24 * 60 * 60 * 1000;
  const first = candles.find((item) => item.time >= cutoff);
  if (!first || first.close <= 0 || last.close <= 0) return null;
  const actualYears = (last.time - first.time) / (365.25 * 24 * 60 * 60 * 1000);
  if (actualYears < years * 0.8) return null;
  return (Math.pow(last.close / first.close, 1 / actualYears) - 1) * 100;
}

function rsi(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) return null;
  const changes = candles.slice(1).map((item, index) => item.close - candles[index]!.close);
  const last = changes.slice(-period);
  const gains = last.map((change) => Math.max(0, change));
  const losses = last.map((change) => Math.max(0, -change));
  const averageGain = mean(gains);
  const averageLoss = mean(losses);
  if (averageGain === null || averageLoss === null) return null;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

export function summarizeLongTerm(dailyInput: Candle[], weeklyInput: Candle[] = []): LongTermMetrics | null {
  const daily = [...dailyInput].filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close) && item.close > 0).sort((a, b) => a.time - b.time);
  if (!daily.length) return null;
  const last = daily[daily.length - 1]!;
  const previous = daily.length > 1 ? daily[daily.length - 2]!.close : null;
  const closes = daily.map((item) => item.close);
  const lastN = (count: number) => closes.length >= count ? mean(closes.slice(-count)) : null;
  const sma50 = lastN(50);
  const sma200 = lastN(200);
  const high52Week = Math.max(...daily.slice(-252).map((item) => item.high));
  const low52Week = Math.min(...daily.slice(-252).map((item) => item.low));
  let peak = closes[0]!;
  let worstDrawdown = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    worstDrawdown = Math.min(worstDrawdown, (close / peak - 1) * 100);
  }
  const dailyReturns = closes.slice(1).map((close, index) => close / closes[index]! - 1).filter(Number.isFinite);
  const averageReturn = mean(dailyReturns);
  const variance = averageReturn === null ? null : mean(dailyReturns.map((value) => (value - averageReturn) ** 2));
  const weekly = [...weeklyInput].filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close) && item.close > 0).sort((a, b) => a.time - b.time);
  return {
    latestPrice: last.close,
    previousPrice: previous,
    dailyChangePct: previous && previous > 0 ? (last.close / previous - 1) * 100 : null,
    oneYearReturnPct: closes.length > 1 ? (last.close / closes[0]! - 1) * 100 : null,
    threeYearCagrPct: cagr(weekly, 3),
    fiveYearCagrPct: cagr(weekly, 5),
    sma50,
    sma200,
    distanceFromSma200Pct: sma200 && sma200 > 0 ? (last.close / sma200 - 1) * 100 : null,
    high52Week,
    low52Week,
    drawdownFromHighPct: high52Week > 0 ? (last.close / high52Week - 1) * 100 : null,
    maxDrawdownPct: worstDrawdown,
    annualizedVolatilityPct: variance !== null ? Math.sqrt(variance) * Math.sqrt(252) * 100 : null,
    rsi14: rsi(daily),
    candleCount: daily.length
  };
}
