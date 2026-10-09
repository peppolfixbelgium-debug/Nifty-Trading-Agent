import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

const UNDERLYINGS: Record<string, string> = {
  NIFTY50: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|Nifty MID Select",
  SENSEX: "BSE_INDEX|SENSEX"
};
const EXPIRIES = new Set(["current_week", "next_week", "far_week", "current_month", "next_month", "far_month"]);
const numberOrNull = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    return res.status(503).json({
      configured: false,
      error: "Options data is not connected yet.",
      detail: "Add UPSTOX_ACCESS_TOKEN in Vercel project environment variables and redeploy to enable live option premiums, bid/ask, open interest and Greeks."
    });
  }
  const underlyingId = typeof req.query.underlying === "string" ? req.query.underlying : "NIFTY50";
  const underlying = UNDERLYINGS[underlyingId];
  const expiryValue = typeof req.query.expiry === "string" ? req.query.expiry : "current_week";
  const expiry = EXPIRIES.has(expiryValue) || /^\d{4}-\d{2}-\d{2}$/.test(expiryValue) ? expiryValue : "current_week";
  if (!underlying) return res.status(400).json({ error: "Unsupported options underlying." });

  try {
    const url = new URL("https://api.upstox.com/v2/option/chain");
    url.searchParams.set("instrument_key", underlying);
    url.searchParams.set("expiry_date", expiry);
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      const detail = response.status === 401
        ? "The Upstox access token was rejected or expired. Refresh the token in Vercel environment variables."
        : response.status === 403
          ? "Upstox denied this endpoint for the connected app/account. Check API permissions, market-data entitlement and applicable exchange permissions."
          : "Upstox option-chain request failed with HTTP " + response.status + ".";
      return res.status(response.status === 401 ? 502 : 502).json({ configured: true, error: "Options feed unavailable.", detail });
    }
    const payload = await response.json() as {
      status?: string;
      data?: Array<{
        expiry?: string;
        pcr?: number;
        strike_price?: number;
        underlying_key?: string;
        underlying_spot_price?: number;
        call_options?: { instrument_key?: string; market_data?: Record<string, unknown>; option_greeks?: Record<string, unknown> };
        put_options?: { instrument_key?: string; market_data?: Record<string, unknown>; option_greeks?: Record<string, unknown> };
      }>;
    };
    const rows = (payload.data ?? []).map((row) => ({
      expiry: row.expiry ?? expiry,
      pcr: numberOrNull(row.pcr),
      strike: numberOrNull(row.strike_price),
      spot: numberOrNull(row.underlying_spot_price),
      call: row.call_options ? {
        instrumentKey: row.call_options.instrument_key ?? null,
        ltp: numberOrNull(row.call_options.market_data?.ltp),
        close: numberOrNull(row.call_options.market_data?.close_price),
        volume: numberOrNull(row.call_options.market_data?.volume),
        oi: numberOrNull(row.call_options.market_data?.oi),
        bid: numberOrNull(row.call_options.market_data?.bid_price),
        ask: numberOrNull(row.call_options.market_data?.ask_price),
        iv: numberOrNull(row.call_options.option_greeks?.iv ?? row.call_options.market_data?.iv),
        delta: numberOrNull(row.call_options.option_greeks?.delta ?? row.call_options.market_data?.delta),
        theta: numberOrNull(row.call_options.option_greeks?.theta),
        gamma: numberOrNull(row.call_options.option_greeks?.gamma)
      } : null,
      put: row.put_options ? {
        instrumentKey: row.put_options.instrument_key ?? null,
        ltp: numberOrNull(row.put_options.market_data?.ltp),
        close: numberOrNull(row.put_options.market_data?.close_price),
        volume: numberOrNull(row.put_options.market_data?.volume),
        oi: numberOrNull(row.put_options.market_data?.oi),
        bid: numberOrNull(row.put_options.market_data?.bid_price),
        ask: numberOrNull(row.put_options.market_data?.ask_price),
        iv: numberOrNull(row.put_options.option_greeks?.iv ?? row.put_options.market_data?.iv),
        delta: numberOrNull(row.put_options.option_greeks?.delta ?? row.put_options.market_data?.delta),
        theta: numberOrNull(row.put_options.option_greeks?.theta),
        gamma: numberOrNull(row.put_options.option_greeks?.gamma)
      } : null
    })).filter((row) => row.strike !== null);
    if (!rows.length) return res.status(502).json({ configured: true, error: "Upstox returned no option-chain rows for this expiry." });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({
      configured: true,
      source: "Upstox option-chain API",
      generatedAt: new Date().toISOString(),
      underlying: underlyingId,
      underlyingKey: underlying,
      expiry: rows[0]?.expiry ?? expiry,
      spot: rows[0]?.spot ?? null,
      rows
    });
  } catch (error) {
    return res.status(502).json({
      configured: true,
      error: "Options feed could not be reached.",
      detail: error instanceof Error ? error.message : "Unknown options feed error"
    });
  }
}
