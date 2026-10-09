import test from "node:test";
import assert from "node:assert/strict";
import { averageTrueRange, averageVolume, movingAverage, relativeStrengthIndex } from "../src/lib/indicators";
import { analyzeStock, classifyMarket } from "../src/lib/analysis";
import type { Candle } from "../src/lib/types";

function makeCandles(count: number, options: { start?: number; step?: number; volume?: number; finalHigh?: number } = {}): Candle[] {
  const start = options.start ?? 100;
  const step = options.step ?? 1;
  return Array.from({ length: count }, (_, index) => {
    const close = start + index * step;
    const high = index === count - 1 && options.finalHigh !== undefined ? options.finalHigh : close + 1;
    return { time: index * 86_400_000, open: close - 0.25, high, low: close - 1, close, volume: options.volume ?? 1000 };
  });
}

test("moving average uses exactly the trailing window and requires enough observations", () => {
  assert.equal(movingAverage([1, 2, 3, 4, 5], 3), 4);
  assert.equal(movingAverage([1, 2], 3), null);
  assert.equal(movingAverage([1, Number.NaN, 3], 3), null);
});

test("volume average rejects missing or negative values", () => {
  assert.equal(averageVolume([100, 200, 300], 3), 200);
  assert.equal(averageVolume([100, null, 300], 3), null);
  assert.equal(averageVolume([100, -1, 300], 3), null);
});

test("ATR returns the mean of the last true ranges", () => {
  const candles = makeCandles(20, { step: 0 });
  assert.equal(averageTrueRange(candles, 14), 2);
  assert.equal(averageTrueRange(candles.slice(0, 14), 14), null);
});

test("RSI handles flat, rising and insufficient series", () => {
  assert.equal(relativeStrengthIndex(Array(15).fill(10), 14), 50);
  assert.equal(relativeStrengthIndex(Array.from({ length: 15 }, (_, i) => 10 + i), 14), 100);
  assert.equal(relativeStrengthIndex([1, 2, 3], 14), null);
});

test("market regime is conservative when inputs are missing or mixed", () => {
  assert.equal(classifyMarket(120, 110, 100), "BULLISH");
  assert.equal(classifyMarket(80, 90, 100), "BEARISH");
  assert.equal(classifyMarket(105, 100, 101), "MIXED");
  assert.equal(classifyMarket(null, 100, 90), "UNAVAILABLE");
});

test("bearish Nifty turns a structurally strong setup into monitor-only, never a long trigger", () => {
  const result = analyzeStock({
    symbol: "TEST.NS",
    name: "Test Company",
    candles: makeCandles(240, { start: 10, step: 0.5, volume: 1000 }),
    marketRegime: "BEARISH",
    params: { capitalInr: 100000, requestedRiskInr: 1000 }
  });
  assert.equal(result.action, "WATCH");
  assert.match(result.reason, /bearish/i);
  assert.match(result.reason, /stock trend is aligned/i);
  assert.match(result.reason, /RSI/i);
  assert.match(result.reason, /market filter/i);
});

test("bearish market still avoids stocks with weak structure", () => {
  const result = analyzeStock({
    symbol: "WEAK.NS",
    name: "Weak Company",
    candles: makeCandles(240, { start: 250, step: -0.5, volume: 1000 }),
    marketRegime: "BEARISH",
    params: { capitalInr: 100000, requestedRiskInr: 1000 }
  });
  assert.equal(result.action, "AVOID");
  assert.match(result.reason, /market filter/i);
  assert.match(result.reason, /trend is not fully aligned/i);
});

test("risk sizing caps requested risk at 1% of capital and position at 10%", () => {
  const result = analyzeStock({
    symbol: "TEST.NS",
    name: "Test Company",
    candles: makeCandles(240, { start: 100, step: 0.1, volume: 1000 }),
    marketRegime: "BULLISH",
    params: { capitalInr: 10000, requestedRiskInr: 5000 }
  });
  assert.equal(result.riskBudgetInr, 100);
  assert.ok(result.positionValueInr <= 1000);
  assert.ok(result.quantity >= 0);
});

test("fewer than 200 candles cannot produce a trading signal", () => {
  const result = analyzeStock({
    symbol: "TEST.NS",
    name: "Test Company",
    candles: makeCandles(100),
    marketRegime: "BULLISH",
    params: { capitalInr: 100000, requestedRiskInr: 1000 }
  });
  assert.equal(result.action, "INSUFFICIENT_DATA");
  assert.equal(result.quantity, 0);
});
