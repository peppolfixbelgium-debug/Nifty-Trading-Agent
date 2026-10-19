import test from "node:test";
import assert from "node:assert/strict";
import { resolveDealDateRange } from "../src/lib/institutional-date-range.js";

test("accepts a bounded explicit date range and formats it for NSE", () => {
  assert.deepEqual(resolveDealDateRange("2026-10-01", "2026-10-19", "30", "2026-10-19"), {
    ok: true, fromIso: "2026-10-01", toIso: "2026-10-19", fromNse: "01-10-2026", toNse: "19-10-2026", days: 19
  });
});

test("keeps legacy day presets when no explicit dates are supplied", () => {
  const result = resolveDealDateRange(undefined, undefined, "7", "2026-10-19");
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.fromIso, "2026-10-13"); assert.equal(result.toIso, "2026-10-19"); assert.equal(result.days, 7); }
});

test("rejects reverse, invalid, future, and over-one-year ranges", () => {
  assert.equal(resolveDealDateRange("2026-10-20", "2026-10-19", "30", "2026-10-19").ok, false);
  assert.equal(resolveDealDateRange("2026-02-30", "2026-03-01", "30", "2026-10-19").ok, false);
  assert.equal(resolveDealDateRange("2026-10-01", "2026-10-20", "30", "2026-10-19").ok, false);
  assert.equal(resolveDealDateRange("2025-10-18", "2026-10-19", "30", "2026-10-19").ok, false);
});
