import test from "node:test";
import assert from "node:assert/strict";
import { buildOpportunityFeatures, matchesOpportunitySignal, type OpportunityFeature } from "../src/lib/opportunities.js";
import { INDEX_UNIVERSE } from "../src/lib/index-universe.js";
import type { Candle } from "../src/lib/types.js";

function feature(overrides: Partial<OpportunityFeature> = {}): OpportunityFeature {
  return {
    index: 220,
    date: "2025-01-01",
    close: 120,
    high: 122,
    low: 118,
    atr14: 2,
    rsi14: 60,
    sma20: 115,
    sma50: 110,
    sma200: 100,
    relativeVolume: 1.3,
    priorHigh20: 119,
    priorLow20: 98,
    previousClose: 114,
    ...overrides
  };
}

function makeCandles(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.08 + Math.sin(index / 3) * 1.2;
    const previous = index === 0 ? close : 100 + (index - 1) * 0.08 + Math.sin((index - 1) / 3) * 1.2;
    const open = (close + previous) / 2;
    return {
      time: Date.UTC(2021, 0, 1 + index),
      open,
      high: Math.max(open, close) + 0.7,
      low: Math.min(open, close) - 0.7,
      close,
      volume: 1000 + (index % 23 === 0 ? 700 : 0)
    };
  });
}

test("the four fixed strategy families use distinct entry conditions", () => {
  const trend = feature();
  assert.equal(matchesOpportunitySignal(trend, null, "trend-following", "LONG"), true);

  const breakout = feature({ close: 121, priorHigh20: 118, rsi14: 65, relativeVolume: 1.5 });
  assert.equal(matchesOpportunitySignal(breakout, null, "breakout-volume", "LONG"), true);
  assert.equal(matchesOpportunitySignal({ ...breakout, relativeVolume: null }, null, "breakout-volume", "LONG"), false);

  const previous = feature({ close: 113, sma20: 115, sma50: 110, sma200: 100 });
  const pullback = feature({ close: 116, low: 115, sma20: 115, sma50: 110, sma200: 100, rsi14: 55 });
  assert.equal(matchesOpportunitySignal(pullback, previous, "trend-pullback", "LONG"), true);

  const reversion = feature({ close: 90, sma20: 100, sma50: 95, sma200: 90, atr14: 2, rsi14: 30 });
  assert.equal(matchesOpportunitySignal(reversion, null, "mean-reversion", "LONG"), true);
});

test("short signals are directionally symmetric and reject contradictory trend context", () => {
  const bearish = feature({
    close: 80,
    high: 82,
    low: 78,
    rsi14: 40,
    sma20: 85,
    sma50: 90,
    sma200: 100,
    priorLow20: 82,
    relativeVolume: 1.4
  });
  assert.equal(matchesOpportunitySignal(bearish, null, "trend-following", "SHORT"), true);
  assert.equal(matchesOpportunitySignal(bearish, null, "breakout-volume", "SHORT"), true);
  assert.equal(matchesOpportunitySignal(bearish, null, "trend-following", "LONG"), false);
});

test("feature preparation uses prior candles and waits for a full 200-bar warm-up", () => {
  const candles = makeCandles(250);
  const features = buildOpportunityFeatures(candles);
  assert.equal(features.length, candles.length);
  assert.equal(features[198], null);
  assert.ok(features[199]);
  assert.ok(features.at(-1));
  assert.equal(features.at(-1)?.date, new Date(candles.at(-1)!.time).toISOString().slice(0, 10));
});

test("broad and sector index universe is populated and has unique symbols", () => {
  assert.ok(INDEX_UNIVERSE.length >= 15);
  assert.ok(INDEX_UNIVERSE.some((item) => item.symbol === "^NSEI"));
  assert.ok(INDEX_UNIVERSE.some((item) => item.name === "Nifty Bank"));
  assert.ok(INDEX_UNIVERSE.some((item) => item.name === "Nifty IT"));
  assert.equal(new Set(INDEX_UNIVERSE.map((item) => item.symbol)).size, INDEX_UNIVERSE.length);
  assert.ok(INDEX_UNIVERSE.every((item) => item.symbol.startsWith("^") && item.name.length > 0));
});
