import test from "node:test";
import assert from "node:assert/strict";
import { simulateBacktest, type BacktestStock } from "../src/lib/backtest-engine.js";
import type { Candle } from "../src/lib/types.js";

function makeCandles(count: number, options: { start: number; step?: number; trend?: "up" | "down"; stockVolume?: boolean } ): Candle[] {
  const step = options.step ?? 0.1;
  return Array.from({ length: count }, (_, index) => {
    const direction = options.trend === "down" ? -1 : 1;
    const close = options.start + direction * step * index + (index % 2 === 1 ? direction * 0.5 : 0);
    const previousClose = index === 0 ? close : options.start + direction * step * (index - 1) + ((index - 1) % 2 === 1 ? direction * 0.5 : 0);
    const open = index === 0 ? close : previousClose + (close - previousClose) * 0.5;
    const volume = options.stockVolume && index % 30 === 3 ? 1800 : 1000;
    return {
      time: Date.UTC(2020, 0, 1 + index),
      open,
      high: Math.max(open, close) + 0.1,
      low: Math.min(open, close) - 0.1,
      close,
      volume
    };
  });
}

function run(trend: "up" | "down" = "up", costBpsPerSide = 15) {
  const count = 320;
  const indexCandles = makeCandles(count, { start: 20000, step: 2, trend });
  const stocks: BacktestStock[] = [
    { symbol: "TEST.NS", name: "Test Company", candles: makeCandles(count, { start: 100, step: 0.1, trend: "up", stockVolume: true }) }
  ];
  return simulateBacktest({
    yearsRequested: 3,
    capitalInr: 100000,
    requestedRiskInr: 1000,
    costBpsPerSide,
    indexCandles,
    stocks
  });
}

test("backtest uses next-session open entries and caps position size", () => {
  const result = run();
  assert.ok(result.trades.length > 0, "synthetic up-trend should produce test signals");
  for (const trade of result.trades) {
    const entry = result.equityCurve.find((point) => point.date === trade.entryDate);
    assert.ok(entry);
    assert.ok(trade.quantity * trade.entryPrice <= 10000 + 0.01);
    assert.ok(trade.quantity > 0);
    assert.ok(trade.exitDate >= trade.entryDate);
  }
  assert.equal(result.assumptions.maxPositionPct, 10);
  assert.equal(result.assumptions.maxRiskPct, 1);
});

test("bearish market filter prevents new long trades", () => {
  const result = run("down");
  assert.equal(result.trades.length, 0);
  assert.equal(result.metrics.finalEquityInr, 100000);
});

test("transaction costs reduce or do not improve results versus zero-cost baseline", () => {
  const noCosts = run("up", 0);
  const withCosts = run("up", 15);
  assert.equal(noCosts.metrics.tradeCount, withCosts.metrics.tradeCount);
  assert.ok(withCosts.metrics.finalEquityInr <= noCosts.metrics.finalEquityInr);
  assert.ok(withCosts.metrics.totalCostsInr >= 0);
});

test("closed trade P&L reconciles to ending equity within display-rounding tolerance", () => {
  const result = run();
  const tradePnl = result.trades.reduce((sum, trade) => sum + trade.netPnlInr, 0);
  assert.ok(result.accounting.reconciled);
  assert.ok(Math.abs(result.accounting.equityDerivedNetPnlInr - tradePnl) <= result.accounting.toleranceInr);
});

test("a missing stock candle does not remove an open position from marked equity", () => {
  const baseline = run();
  const heldTrade = baseline.trades.find((trade) => trade.holdingDays >= 4);
  assert.ok(heldTrade, "synthetic series should produce a trade lasting at least four sessions");

  const count = 320;
  const indexCandles = makeCandles(count, { start: 20000, step: 2 });
  const stockCandles = makeCandles(count, { start: 100, step: 0.1, stockVolume: true });
  const missingDate = new Date(Date.parse(heldTrade.entryDate + "T00:00:00Z") + 2 * 86_400_000).toISOString().slice(0, 10);
  const sparseCandles = stockCandles.filter((candle) => new Date(candle.time).toISOString().slice(0, 10) !== missingDate);
  const sparseResult = simulateBacktest({
    yearsRequested: 3,
    capitalInr: 100000,
    requestedRiskInr: 1000,
    costBpsPerSide: 15,
    indexCandles,
    stocks: [{ symbol: "TEST.NS", name: "Test Company", candles: sparseCandles }]
  });
  const point = sparseResult.equityCurve.find((item) => item.date === missingDate);
  assert.ok(point, "equity series should preserve the market-date row");
  assert.ok(point.equityInr > 95000, "the open position should be marked at the last observed close");
  assert.ok(sparseResult.accounting.reconciled);
});

test("same-candle stop and target ambiguity is configured conservatively", () => {
  const result = run();
  assert.match(result.assumptions.sameDayStopAndTargetRule, /assume the stop was hit first/i);
  assert.match(result.assumptions.entryRule, /next session open/i);
});
