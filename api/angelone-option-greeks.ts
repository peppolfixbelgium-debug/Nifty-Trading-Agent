import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

const UNDERLYINGS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]);

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

  const underlying = typeof req.query.underlying === "string" ? req.query.underlying.toUpperCase() : "NIFTY";
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry.toUpperCase() : "";
  if (!UNDERLYINGS.has(underlying)) {
    return res.status(400).json({ error: "Unsupported underlying. Choose NIFTY, BANKNIFTY, FINNIFTY or MIDCPNIFTY." });
  }
  if (!/^(0[1-9]|[12]\d|3[01])[A-Z]{3}\d{4}$/.test(expiry)) {
    return res.status(400).json({ error: "Expiry must use Angel One's DDMMMYYYY format, for example 29OCT2026." });
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
    const response = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/marketData/v1/optionGreek", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: underlying, expirydate: expiry }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      return res.status(502).json({
        configured: true,
        error: "Angel One option Greeks request failed.",
        detail: response.status === 401
          ? "Angel One rejected the JWT. Generate a fresh authorised session token."
          : response.status === 403
            ? "Angel One denied access to this endpoint for the current session."
            : "Angel One returned HTTP " + response.status + "."
      });
    }

    const payload = await response.json() as {
      status?: boolean; message?: string; errorcode?: string;
      data?: Array<Record<string, unknown>> | null;
    };
    if (payload.status !== true) {
      return res.status(502).json({
        configured: true,
        error: "Angel One did not return option Greeks.",
        detail: payload.message ?? payload.errorcode ?? "No provider detail was supplied."
      });
    }

    const numberOrNull = (value: unknown): number | null => {
      const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
      return Number.isFinite(number) ? number : null;
    };
    const rows = (payload.data ?? []).map((item) => ({
      underlying: typeof item.name === "string" ? item.name : underlying,
      expiry: typeof item.expiry === "string" ? item.expiry : expiry,
      strike: numberOrNull(item.strikePrice),
      type: item.optionType === "CE" || item.optionType === "PE" ? item.optionType : null,
      delta: numberOrNull(item.delta),
      gamma: numberOrNull(item.gamma),
      theta: numberOrNull(item.theta),
      vega: numberOrNull(item.vega),
      iv: numberOrNull(item.impliedVolatility),
      volume: numberOrNull(item.tradeVolume)
    })).filter((item) => item.strike !== null && item.type !== null);

    if (!rows.length) {
      return res.status(200).json({
        configured: true, source: "Angel One SmartAPI option Greeks",
        generatedAt: new Date().toISOString(), underlying, expiry, rows: [],
        note: "No live-contract Greeks were returned. Angel One documents this endpoint for live contracts; it is not an expired-contract Greeks archive."
      });
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({
      configured: true, source: "Angel One SmartAPI option Greeks",
      generatedAt: new Date().toISOString(), underlying, expiry, rows,
      note: "Greeks/IV are provider values for live contracts. This endpoint does not provide option premiums or historical Greeks."
    });
  } catch (error) {
    return res.status(502).json({
      error: "Angel One option Greeks feed could not be reached.",
      detail: error instanceof Error ? error.message : "Unknown provider error"
    });
  }
}
