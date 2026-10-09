import type { Candle } from "./types.js";

export function movingAverage(values: number[], period: number): number | null {
  if (!Number.isInteger(period) || period < 1 || values.length < period) return null;
  const window = values.slice(-period);
  if (window.some((value) => !Number.isFinite(value))) return null;
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export function averageVolume(values: Array<number | null>, period: number): number | null {
  if (!Number.isInteger(period) || period < 1 || values.length < period) return null;
  const window = values.slice(-period);
  if (window.some((value) => value === null || !Number.isFinite(value) || value < 0)) return null;
  return window.reduce<number>((sum, value) => sum + (value ?? 0), 0) / period;
}

export function averageTrueRange(candles: Candle[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 1 || candles.length < period + 1) return null;
  const ranges: number[] = [];
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (!candle || !previous) return null;
    ranges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close)
    ));
  }
  if (ranges.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return ranges.reduce((sum, value) => sum + value, 0) / period;
}

export function relativeStrengthIndex(closes: number[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 1 || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];
    if (previous === undefined || current === undefined || !Number.isFinite(previous + current)) return null;
    const change = current - previous;
    if (change > 0) gains += change;
    else losses -= change;
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}
