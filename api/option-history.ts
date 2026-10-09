import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import type { Candle } from "../src/lib/types.js";

type Range = "1D" | "5D" | "1M" | "6M";
const numberOfDays: Record<Range, number> = { "1D": 1, "5D": 5, "1M": 31, "6M": 183 };

function indiaDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return String(values.year) + "-" + String(values.month) + "-" + String(values.day);
}
function addDays(dateText: string, amount: number): string {
  const date = new Date(dateText + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function apiInterval(range: Range): { unit: string; interval: string; expired: string } {
  if (range === "1D") return { unit: "minutes", interval: "1", expired: "1minute" };
  if (range === "5D") return { unit: "minutes", interval: "5", expired: "30minute" };
  if (range === "1M") return { unit: "minutes", interval: "30", expired: "30minute" };
  return { unit: "days", interval: "1", expired: "day" };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return res.status(503).json({
    configured: false,
    error: "Premium history is not connected.",
    detail: "Add UPSTOX_ACCESS_TOKEN in Vercel and redeploy. Historical minute data and expired-contract history also depend on Upstox API entitlement."
  });
  const instrumentKey = typeof req.query.instrumentKey === "string" ? req.query.instrumentKey : "";
  // Fixed Upstox host + constrained instrument-key format prevent this endpoint becoming an arbitrary URL proxy.
  if (!/^NSE_FO\|[A-Za-z0-9 _.-]+(?:\|[A-Za-z0-9 _.-]+)?$/.test(instrumentKey)) {
    return res.status(400).json({ error: "Invalid option instrument key." });
  }
  const rangeValue = typeof req.query.range === "string" ? req.query.range : "1D";
  if (!["1D", "5D", "1M", "6M"].includes(rangeValue)) {
    return res.status(400).json({ error: "Choose a supported premium-history window: 1D, 5D, 1M or 6M." });
  }

  const range = rangeValue as Range;
  const today = indiaDate(Date.now());
  const fromDate = addDays(today, -(numberOfDays[range] - 1));
  const preset = apiInterval(range);
  const parts = instrumentKey.split("|");
  const isExpired = parts.length >= 3;
  let url: URL;
  if (isExpired) {
    // Upstox expired option keys include the contract expiry segment and use the expired-instrument endpoint.
    url = new URL(
      "https://api.upstox.com/v2/expired-instruments/historical-candle/" +
      encodeURIComponent(instrumentKey) + "/" + preset.expired + "/" + today + "/" + fromDate
    );
  } else if (range === "1D") {
    url = new URL(
      "https://api.upstox.com/v3/historical-candle/intraday/" +
      encodeURIComponent(instrumentKey) + "/minutes/1"
    );
  } else {
    url = new URL(
      "https://api.upstox.com/v3/historical-candle/" +
      encodeURIComponent(instrumentKey) + "/" + preset.unit + "/" + preset.interval + "/" + today + "/" + fromDate
    );
  }

  try {
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      const detail = response.status === 401
        ? "The Upstox access token was rejected or expired."
        : response.status === 403
          ? "This historical endpoint may require additional Upstox entitlement. Expired option history is an entitled feature."
          : "Upstox returned HTTP " + response.status + " for premium history.";
      return res.status(502).json({ error: "Premium history is unavailable.", detail });
    }
    const payload = await response.json() as {
      status?: string;
      data?: { candles?: unknown[] } | unknown[];
    };
    const nested = payload.data;
    const rawCandles = Array.isArray(nested) ? nested :
      nested && typeof nested === "object" && "candles" in nested && Array.isArray(nested.candles)
        ? nested.candles : [];
    const candles: Candle[] = [];
    for (const value of rawCandles) {
      if (!Array.isArray(value) || value.length < 5) continue;
      const time = typeof value[0] === "string" ? Date.parse(value[0]) : Number(value[0]) * 1000;
      const open = Number(value[1]);
      const high = Number(value[2]);
      const low = Number(value[3]);
      const close = Number(value[4]);
      const volume = value[5] === null || value[5] === undefined ? null : Number(value[5]);
      if (![time, open, high, low, close].every(Number.isFinite)) continue;
      if (open <= 0 || close <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
      candles.push({
        time, open, high, low, close,
        volume: volume !== null && Number.isFinite(volume) && volume >= 0 ? volume : null
      });
    }
    if (!candles.length) return res.status(200).json({
      configured: true, source: "Upstox historical-candle API", instrumentKey, range, candles: [],
      note: "No candles were returned for this contract/window. It may be newly listed, expired outside the available window, or not entitled."
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({
      configured: true,
      source: isExpired ? "Upstox expired-option historical candles" : "Upstox historical candles",
      generatedAt: new Date().toISOString(),
      instrumentKey, range,
      candles,
      note: "Premium history is contract-specific. It does not stitch different strikes or expiries into a synthetic long-term premium series."
    });
  } catch (error) {
    return res.status(502).json({
      error: "Premium history could not be loaded.",
      detail: error instanceof Error ? error.message : "Unknown history error"
    });
  }
}
