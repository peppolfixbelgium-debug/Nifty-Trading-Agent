import { resolveUpstoxUnderlying } from "../src/lib/options-provider.js";
import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return res.status(503).json({
    configured: false,
    error: "Historical option archive is not connected.",
    detail: "Add UPSTOX_ACCESS_TOKEN in Vercel to query available expired-contract expiries. This API requires Upstox's applicable expired-instrument entitlement."
  });
  const id = typeof req.query.underlying === "string" ? req.query.underlying : "NIFTY50";
  const resolved = resolveUpstoxUnderlying(id);
  const key = resolved?.key;
  if (!resolved || !key) return res.status(400).json({ error: "Unsupported options underlying." });

  try {
    const url = new URL("https://api.upstox.com/v2/expired-instruments/expiries");
    url.searchParams.set("instrument_key", key);
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      return res.status(502).json({
        configured: true, error: "Expired option dates could not be loaded.",
        detail: response.status === 403
          ? "This API requires the applicable Upstox Plus/expired-instrument entitlement."
          : "Upstox returned HTTP " + response.status + "."
      });
    }
    const payload = await response.json() as { status?: string; data?: unknown[] };
    const dates = (payload.data ?? []).filter((date): date is string =>
      typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ).sort((a, b) => b.localeCompare(a));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ configured: true, source: "Upstox expired-instrument API", underlying: id, dates });
  } catch (error) {
    return res.status(502).json({
      configured: true, error: "Expired option dates could not be loaded.",
      detail: error instanceof Error ? error.message : "Unknown expiry error"
    });
  }
}
