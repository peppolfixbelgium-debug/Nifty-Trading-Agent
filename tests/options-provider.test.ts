import test from "node:test";
import assert from "node:assert/strict";
import { resolveUpstoxUnderlying, UPSTOX_RELATIVE_EXPIRIES } from "../src/lib/options-provider.js";

test("supported options underlyings resolve to fixed provider instrument keys", () => {
  const nifty = resolveUpstoxUnderlying("NIFTY50");
  assert.deepEqual(nifty, { id: "NIFTY50", key: "NSE_INDEX|Nifty 50" });
  assert.equal(resolveUpstoxUnderlying("BANKNIFTY")?.key, "NSE_INDEX|Nifty Bank");
  assert.equal(resolveUpstoxUnderlying("SENSEX")?.key, "BSE_INDEX|SENSEX");
  assert.equal(resolveUpstoxUnderlying("UNKNOWN"), null);
});

test("option-chain expiry aliases are an explicit allowlist", () => {
  assert.ok(UPSTOX_RELATIVE_EXPIRIES.has("current_week"));
  assert.ok(UPSTOX_RELATIVE_EXPIRIES.has("far_month"));
  assert.equal(UPSTOX_RELATIVE_EXPIRIES.has("last_decade"), false);
});
