import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLongTermStock } from "../src/lib/long-term-evaluation.js";

const base = {
  trailingPE: 18, priceToBook: 2.4, dividendYieldPct: 2.1,
  roePct: 19, revenueGrowthPct: 14, earningsGrowthPct: 16, profitMarginPct: 17,
  debtToEquityPct: 35, freeCashFlow: 1200000000, isFinancialSector: false,
  price: 102, ma50: 101, ma200: 100, rsi14: 54, weekLow: 78, weekHigh: 108
};

test("strong fundamentals near the 200-day average identify a staged-entry candidate", () => {
  const result = evaluateLongTermStock(base);
  assert.ok((result.qualityScore ?? 0) >= 68);
  assert.equal(result.timing.assessment, "IN_ZONE");
  assert.equal(result.stance, "BUY");
  assert.ok((result.timing.entryLow ?? Infinity) < 102);
  assert.ok((result.timing.entryHigh ?? -Infinity) > 102);
  assert.ok(result.metrics.some(metric => metric.id === "roe" && metric.assessment === "GOOD"));
});

test("stretched price suggests pullback instead of chasing", () => {
  const result = evaluateLongTermStock({ ...base, price: 125, ma50: 115, ma200: 100, rsi14: 76 });
  assert.equal(result.timing.assessment, "WAIT_PULLBACK");
  assert.notEqual(result.stance, "BUY");
});

test("missing fundamentals never create a buy signal", () => {
  const result = evaluateLongTermStock({
    ...base, trailingPE: null, priceToBook: null, dividendYieldPct: null,
    roePct: null, revenueGrowthPct: null, earningsGrowthPct: null, profitMarginPct: null,
    debtToEquityPct: null, freeCashFlow: null, ma50: null, ma200: null, rsi14: null
  });
  assert.equal(result.stance, "WAIT");
  assert.equal(result.qualityScore, null);
});

test("financial companies do not receive a leverage score from generic debt/equity cut-offs", () => {
  const result = evaluateLongTermStock({ ...base, isFinancialSector: true, debtToEquityPct: 900 });
  const leverage = result.metrics.find(metric => metric.id === "leverage");
  assert.equal(leverage?.weight, 0);
  assert.equal(leverage?.assessment, "WEAK");
  assert.equal(result.metricsAvailable, 8);
});
