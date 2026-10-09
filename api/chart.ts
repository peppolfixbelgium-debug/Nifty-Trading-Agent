import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import { getMarketChart } from "../src/lib/chart-data.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : "^NSEI";
  const range = typeof req.query.range === "string" ? req.query.range : "1Y";
  const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";
  try {
    const result = await getMarketChart(symbol, range, forceRefresh);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown chart error";
    return res.status(detail.includes("supported chart universe") ? 400 : 502).json({
      error: "Market chart could not be loaded.",
      detail,
      hint: "The chart uses an unofficial daily/intraday market-data source. Retry later or configure a licensed data provider for production-grade use."
    });
  }
}
