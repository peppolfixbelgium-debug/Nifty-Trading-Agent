import test from "node:test";
import assert from "node:assert/strict";
import { summarizeLongTerm } from "../src/lib/long-term.js";
import type { Candle } from "../src/lib/types.js";

function candles(count: number, stepMs: number, start: number, startPrice = 100): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = startPrice + index * 0.2;
    return { time: start + index * stepMs, open: close - 0.1, high: close + 1, low: close - 1, close, volume: 1000 + index };
  });
}

test("long-term metrics compute trend, returns, range and drawdown from actual candles", () => {
  const day = 24 * 60 * 60 * 1000;
  const daily = candles(252, day, Date.UTC(2024, 0, 1));
  const weekly = candles(261, 7 * day, Date.UTC(2020, 0, 1));
  const metrics = summarizeLongTerm(daily, weekly);
  assert.ok(metrics);
  assert.equal(metrics.candleCount, 252);
  assert.equal(metrics.latestPrice, daily.at(-1)?.close);
  assert.ok(metrics.sma50 !== null && metrics.sma200 !== null);
  assert.ok((metrics.oneYearReturnPct ?? 0) > 0);
  assert.ok((metrics.fiveYearCagrPct ?? 0) > 0);
  assert.ok((metrics.high52Week ?? 0) >= metrics.latestPrice);
  assert.ok((metrics.low52Week ?? Infinity) <= metrics.latestPrice);
  assert.ok((metrics.drawdownFromHighPct ?? -Infinity) <= 0);
  assert.ok(metrics.annualizedVolatilityPct !== null);
});

test("long-term metrics leave unavailable 50/200-day averages blank for short histories", () => {
  const day = 24 * 60 * 60 * 1000;
  const metrics = summarizeLongTerm(candles(30, day, Date.UTC(2025, 0, 1)));
  assert.ok(metrics);
  assert.equal(metrics.sma50, null);
  assert.equal(metrics.sma200, null);
  assert.equal(metrics.threeYearCagrPct, null);
  assert.equal(metrics.fiveYearCagrPct, null);
});
