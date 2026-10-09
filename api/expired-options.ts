import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

const UNDERLYINGS: Record<string, string> = {
  NIFTY50: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|Nifty MID Select",
  SENSEX: "BSE_INDEX|SENSEX"
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return res.status(503).json({
    configured: false,
    error: "Historical option contracts are not connected.",
    detail: "Add UPSTOX_ACCESS_TOKEN in Vercel. Expired contract data may require Upstox Plus entitlement."
  });
  const id = typeof req.query.underlying === "string" ? req.query.underlying : "NIFTY50";
  const key = UNDERLYINGS[id];
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry : "";
  if (!key) return res.status(400).json({ error: "Unsupported options underlying." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || expiry >= new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: "Choose a historical expiry date in YYYY-MM-DD format." });
  }

  try {
    const url = new URL("https://api.upstox.com/v2/expired-instruments/option/contract");
    url.searchParams.set("instrument_key", key);
    url.searchParams.set("expiry_date", expiry);
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      return res.status(502).json({
        configured: true, error: "Historical option contracts could not be loaded.",
        detail: response.status === 403
          ? "This API requires the applicable Upstox Plus/expired-instrument entitlement."
          : "Upstox returned HTTP " + response.status + "."
      });
    }
    const payload = await response.json() as {
      status?: string;
      data?: Array<{
        name?: string; instrument_key?: string; trading_symbol?: string; expiry?: string;
        strike_price?: number; instrument_type?: string; lot_size?: number; underlying_key?: string;
      }>;
    };
    const contracts = (payload.data ?? []).filter((item) =>
      typeof item.instrument_key === "string" && /^NSE_FO\|[A-Za-z0-9 _.-]+\|[A-Za-z0-9 _.-]+$/.test(item.instrument_key) &&
      typeof item.trading_symbol === "string" && typeof item.strike_price === "number" &&
      (item.instrument_type === "CE" || item.instrument_type === "PE")
    ).map((item) => ({
      name: item.name ?? "Option",
      instrumentKey: item.instrument_key!,
      tradingSymbol: item.trading_symbol!,
      expiry: item.expiry ?? expiry,
      strike: item.strike_price!,
      type: item.instrument_type!,
      lotSize: item.lot_size ?? null
    })).sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ configured: true, source: "Upstox expired-option contracts", underlying: id, expiry, contracts });
  } catch (error) {
    return res.status(502).json({
      configured: true, error: "Historical option contracts could not be loaded.",
      detail: error instanceof Error ? error.message : "Unknown contract error"
    });
  }
}
