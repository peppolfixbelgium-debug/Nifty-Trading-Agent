import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import { runMarketOpportunityScan } from "../src/lib/opportunities.js";
import type { StrategyId } from "../src/lib/opportunity-types.js";

export const config = { maxDuration: 60 };

const boundedNumber = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const years = typeof req.query.years === "string" && Number(req.query.years) === 3 ? 3 : 5;
  const capitalInr = boundedNumber(req.query.capital, 100000, 1, 100000000);
  const riskPerTradeInr = boundedNumber(req.query.risk, 1000, 1, 1000000);
  const costBpsPerSide = boundedNumber(req.query.costBps, 15, 0, 200);
  const minimumTradesForRanking = Math.floor(boundedNumber(req.query.minTrades, 30, 30, 500));
  const universeValue = typeof req.query.universe === "string" ? req.query.universe : "all";
  const strategyValue = typeof req.query.strategy === "string" ? req.query.strategy : "all";
  const directionValue = typeof req.query.direction === "string" ? req.query.direction : "both";
  const timeframeValue = typeof req.query.timeframe === "string" ? req.query.timeframe : "daily";

  if (universeValue !== "all" && universeValue !== "stocks" && universeValue !== "indices") {
    return res.status(400).json({ error: "Unsupported market universe. Choose all supported instruments, the current stock universe or broad/sector indices." });
  }
  const strategyIds: StrategyId[] = ["trend-following", "breakout-volume", "trend-pullback", "mean-reversion"];
  if (strategyValue !== "all" && !strategyIds.includes(strategyValue as StrategyId)) {
    return res.status(400).json({ error: "Unsupported strategy family." });
  }
  if (directionValue !== "both" && directionValue !== "long" && directionValue !== "short") {
    return res.status(400).json({ error: "Direction must be both, long or short." });
  }
  if (timeframeValue !== "daily") {
    return res.status(400).json({ error: "Only the daily timeframe has a validated data adapter." });
  }

  try {
    const result = await runMarketOpportunityScan({
      years,
      capitalInr,
      riskPerTradeInr,
      costBpsPerSide,
      minimumTradesForRanking,
      universe: universeValue,
      strategy: strategyValue as "all" | StrategyId,
      direction: directionValue,
      timeframe: "daily"
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown opportunity scan error";
    return res.status(502).json({
      error: "The Market Opportunity Scanner could not complete its data audit.",
      detail,
      hint: "Historical data can be rate-limited or unavailable. No ranking is valid until the data coverage gate passes."
    });
  }
}
