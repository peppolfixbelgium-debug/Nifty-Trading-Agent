import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runScan } from "../src/lib/scanner";

export const config = { maxDuration: 60 };

const boundedNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const capitalInr = boundedNumber(req.query.capital, 100000);
  const riskPerTradeInr = boundedNumber(req.query.risk, 1000);
  const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

  try {
    const result = await runScan({ capitalInr, riskPerTradeInr, forceRefresh });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown scanner error";
    return res.status(502).json({
      error: "The scanner could not complete this request.",
      detail,
      hint: "The market-data provider may be temporarily unavailable. Retry in a few minutes."
    });
  }
}
