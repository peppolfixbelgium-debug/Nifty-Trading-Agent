import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import type { Candle } from "../src/lib/types.js";

type Range = "1D" | "5D" | "1M" | "6M";
const rangeDays: Record<Range, number> = { "1D": 1, "5D": 5, "1M": 31, "6M": 183 };
const intervals: Record<Range, string> = {
  "1D": "ONE_MINUTE",
  "5D": "FIVE_MINUTE",
  "1M": "THIRTY_MINUTE",
  "6M": "ONE_DAY"
};

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

function toAngelDate(dateText: string, end = false): string {
  return dateText + (end ? " 15:30" : " 09:15");
}

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
      error: "Angel One historical options feed is not connected.",
      detail: "Set ANGELONE_API_KEY, ANGELONE_JWT_TOKEN, ANGELONE_CLIENT_LOCAL_IP, ANGELONE_CLIENT_PUBLIC_IP and ANGELONE_MAC_ADDRESS as server-side environment variables. Never add broker credentials to frontend code or Git."
    });
  }

  const instrumentToken = typeof req.query.instrumentToken === "string" ? req.query.instrumentToken : "";
  if (!/^\d{1,12}$/.test(instrumentToken)) {
    return res.status(400).json({ error: "instrumentToken must be a numeric Angel One NFO scrip token from the official instrument master." });
  }
  const rangeValue = typeof req.query.range === "string" ? req.query.range : "1D";
  if (!Object.hasOwn(rangeDays, rangeValue)) {
    return res.status(400).json({ error: "Choose a supported history window: 1D, 5D, 1M or 6M." });
  }

  const range = rangeValue as Range;
  const today = indiaDate(Date.now());
  const fromDate = addDays(today, -(rangeDays[range] - 1));
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
    const response = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData", {
      method: "POST",
      headers,
      body: JSON.stringify({
        exchange: "NFO",
        symboltoken: instrumentToken,
        interval: intervals[range],
        fromdate: toAngelDate(fromDate),
        todate: toAngelDate(today, true)
      }),
      signal: AbortSignal.timeout(12_000)
    });

    if (!response.ok) {
      return res.status(502).json({
        configured: true,
        error: "Angel One historical options request failed.",
        detail: response.status === 401
          ? "Angel One rejected the JWT. Generate a fresh authorised session token and update ANGELONE_JWT_TOKEN."
          : response.status === 403
            ? "Angel One denied historical data access for this session or instrument."
            : "Angel One returned HTTP " + response.status + "."
      });
    }

    const payload = await response.json() as { status?: boolean; message?: string; errorcode?: string; data?: unknown[][] | null };
    if (payload.status !== true) {
      return res.status(502).json({
        configured: true,
        error: "Angel One did not return historical candles.",
        detail: payload.message ?? payload.errorcode ?? "No provider detail was supplied."
      });
    }

    const candles: Candle[] = [];
    for (const row of payload.data ?? []) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const time = typeof row[0] === "string" ? Date.parse(row[0]) : Number(row[0]) * 1000;
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const rawVolume = row[5] === null || row[5] === undefined ? null : Number(row[5]);
      if (![time, open, high, low, close].every(Number.isFinite)) continue;
      if (open <= 0 || close <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
      candles.push({
        time, open, high, low, close,
        volume: rawVolume !== null && Number.isFinite(rawVolume) && rawVolume >= 0 ? rawVolume : null
      });
    }

    candles.sort((a, b) => a.time - b.time);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({
      configured: true,
      source: "Angel One SmartAPI historical candles",
      generatedAt: new Date().toISOString(),
      exchange: "NFO",
      instrumentToken,
      range,
      candles,
      note: "These candles belong only to the supplied option contract token. Historical Greeks and expired-contract availability are not guaranteed by this endpoint."
    });
  } catch (error) {
    return res.status(502).json({
      error: "Angel One historical options feed could not be reached.",
      detail: error instanceof Error ? error.message : "Unknown provider error"
    });
  }
}
