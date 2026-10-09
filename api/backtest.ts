import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import { runHistoricalBacktest } from "../src/lib/backtest.js";

export const config = { maxDuration: 60 };

const boundedNumber = (value: unknown, fallback: number, maximum: number): number => {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const yearsValue = typeof req.query.years === "string" ? Number(req.query.years) : 5;
  const years = yearsValue === 3 ? 3 : 5;
  const capitalInr = boundedNumber(req.query.capital, 100000, 100000000);
  const riskPerTradeInr = boundedNumber(req.query.risk, 1000, 1000000);
  const costBpsPerSide = boundedNumber(req.query.costBps, 15, 200);

  try {
    const result = await runHistoricalBacktest({
      years,
      capitalInr,
      riskPerTradeInr,
      costBpsPerSide
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown backtest error";
    return res.status(502).json({
      error: "The historical backtest could not be completed.",
      detail,
      hint: "The historical data provider may be temporarily unavailable or rate-limiting requests. Retry in a few minutes."
    });
  }
}
