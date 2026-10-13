import test from "node:test";
import assert from "node:assert/strict";
import { planLongTermEntry } from "../src/lib/long-term-entry.js";

test("a stock near its 200-day trend gets a staged accumulation watch band", () => {
  const plan = planLongTermEntry(102, 101, 100, 54);
  assert.equal(plan.status, "IN_ZONE");
  assert.equal(plan.low, 97);
  assert.equal(plan.high, 105);
});

test("an extended stock gets a pullback zone instead of an immediate buy label", () => {
  const plan = planLongTermEntry(125, 115, 100, 76);
  assert.equal(plan.status, "WAIT_PULLBACK");
  assert.ok((plan.low ?? Infinity) < 125);
  assert.ok((plan.high ?? Infinity) < 125);
});

test("price below the 200-day average is marked trend damaged", () => {
  const plan = planLongTermEntry(88, 92, 100, 43);
  assert.equal(plan.status, "TREND_DAMAGED");
  assert.equal(plan.low, 95);
  assert.equal(plan.high, 100);
});

test("entry level is not invented when price averages are missing", () => {
  const plan = planLongTermEntry(100, null, null, null);
  assert.equal(plan.status, "NO_DATA");
  assert.equal(plan.low, null);
  assert.equal(plan.high, null);
});
