import test from "node:test";
import assert from "node:assert/strict";
import { assessLongTerm } from "../src/lib/long-term-analysis.js";

test("long-term assessment requires a minimum amount of evidence", () => {
  const result = assessLongTerm({
    price: 100, sma50: null, sma200: null, return1yPct: null, return3yPct: null,
    roePct: null, profitMarginPct: null, revenueGrowthPct: null, earningsGrowthPct: null,
    debtToEquityPct: null, sector: null
  });
  assert.equal(result.action, "INSUFFICIENT_DATA");
  assert.equal(result.availableFactors, 0);
});

test("long-term assessment can be constructive only when independent available factors support it", () => {
  const result = assessLongTerm({
    price: 120, sma50: 110, sma200: 90, return1yPct: 15, return3yPct: 30,
    roePct: 18, profitMarginPct: 12, revenueGrowthPct: 10, earningsGrowthPct: 12,
    debtToEquityPct: 35, sector: "Industrials"
  });
  assert.equal(result.action, "BUY");
  assert.equal(result.confidence, "HIGH");
  assert.equal(result.availableFactors, 5);
});

test("bank leverage is not treated as comparable with non-financial debt/equity", () => {
  const result = assessLongTerm({
    price: 90, sma50: 100, sma200: 110, return1yPct: -15, return3yPct: -20,
    roePct: 12, profitMarginPct: 10, revenueGrowthPct: 4, earningsGrowthPct: -2,
    debtToEquityPct: 900, sector: "Financial Services"
  });
  assert.equal(result.factors.find((factor) => factor.key === "leverage")?.score, null);
});
