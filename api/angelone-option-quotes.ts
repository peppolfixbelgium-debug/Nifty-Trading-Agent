import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const apiKey = process.env.ANGELONE_API_KEY;
  const jwt = process.env.ANGELONE_JWT_TOKEN;
  const localIp = process.env.ANGELONE_CLIENT_LOCAL_IP;
  const publicIp = process.env.ANGELONE_CLIENT_PUBLIC_IP;
  const macAddress = process.env.ANGELONE_MAC_ADDRESS;
  if (!apiKey || !jwt || !localIp || !publicIp || !macAddress) {
    return res.status(503).json({
      configured: false,
      error: "Angel One market-data feed is not connected.",
      detail: "Configure the five ANGELONE_* server-side environment variables documented in README.md."
    });
  }

  const rawTokens = typeof req.query.tokens === "string" ? req.query.tokens : "";
  const tokens = [...new Set(rawTokens.split(",").map((token) => token.trim()).filter(Boolean))];
  if (!tokens.length || tokens.length > 50 || tokens.some((token) => !/^\d{1,12}$/.test(token))) {
    return res.status(400).json({ error: "Provide 1–50 comma-separated numeric Angel One instrument tokens." });
  }

  const headers: Record<string, string> = {
    Authorization: "Bearer " + jwt,
    "X-PrivateKey": apiKey,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": localIp,
    "X-ClientPublicIP": publicIp,
    "X-MACAddress": macAddress
  };

  try {
    const response = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote", {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: "FULL", exchangeTokens: { NFO: tokens } }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      return res.status(502).json({
        configured: true,
        error: "Angel One option quote request failed.",
        detail: response.status === 401
          ? "Angel One rejected the JWT. Generate a fresh authorised session token."
          : response.status === 403
            ? "Angel One denied market-data access for the current session."
            : "Angel One returned HTTP " + response.status + "."
      });
    }

    const payload = await response.json() as {
      status?: boolean; message?: string; errorcode?: string;
      data?: { fetched?: Array<Record<string, unknown>>; unfetched?: Array<Record<string, unknown>> } | null;
    };
    if (payload.status !== true) {
      return res.status(502).json({
        configured: true,
        error: "Angel One did not return option quotes.",
        detail: payload.message ?? payload.errorcode ?? "No provider detail was supplied."
      });
    }

    const numberOrNull = (value: unknown): number | null => {
      const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
      return Number.isFinite(number) ? number : null;
    };
    const fetched = (payload.data?.fetched ?? []).map((item) => {
      const depth = item.depth && typeof item.depth === "object" ? item.depth as Record<string, unknown> : {};
      const buy = Array.isArray(depth.buy) ? depth.buy as Array<Record<string, unknown>> : [];
      const sell = Array.isArray(depth.sell) ? depth.sell as Array<Record<string, unknown>> : [];
      return {
        exchange: typeof item.exchange === "string" ? item.exchange : "NFO",
        tradingSymbol: typeof item.tradingSymbol === "string" ? item.tradingSymbol : null,
        symbolToken: typeof item.symbolToken === "string" ? item.symbolToken : null,
        ltp: numberOrNull(item.ltp),
        open: numberOrNull((item as Record<string, unknown>).open),
        high: numberOrNull((item as Record<string, unknown>).high),
        low: numberOrNull((item as Record<string, unknown>).low),
        close: numberOrNull((item as Record<string, unknown>).close),
        volume: numberOrNull(item.tradeVolume),
        oi: numberOrNull(item.opnInterest),
        bid: numberOrNull(buy[0]?.price),
        ask: numberOrNull(sell[0]?.price)
      };
    });

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({
      configured: true,
      source: "Angel One SmartAPI FULL market quote",
      generatedAt: new Date().toISOString(),
      fetched,
      unfetched: payload.data?.unfetched ?? [],
      note: "Quotes are returned only for the supplied official NFO tokens. No token discovery or synthetic quote generation is performed."
    });
  } catch (error) {
    return res.status(502).json({
      error: "Angel One option quote feed could not be reached.",
      detail: error instanceof Error ? error.message : "Unknown provider error"
    });
  }
}
