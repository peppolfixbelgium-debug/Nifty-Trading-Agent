import test from "node:test";
import assert from "node:assert/strict";
import { getMarketChart, listChartSymbols } from "../src/lib/chart-data.js";

test("market chart universe includes stocks and broad/sector indices", () => {
  const instruments = listChartSymbols();
  const symbols = instruments.map((item) => item.symbol);
  assert.ok(instruments.length >= 40);
  assert.equal(new Set(symbols).size, symbols.length);
  assert.ok(symbols.includes("^NSEI"));
  assert.ok(symbols.includes("^CNXIT"));
  assert.ok(symbols.includes("RELIANCE.NS"));
});

test("chart adapter rejects unsupported instruments before making a provider request", async () => {
  await assert.rejects(
    () => getMarketChart("UNSUPPORTED-TICKER", "1D"),
    /supported chart universe/i
  );
});
