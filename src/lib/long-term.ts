export type MetricGrade = "GOOD" | "FAIR" | "WEAK" | "NO_DATA";
export type FundamentalKey = "roe" | "debtToEquity" | "revenueGrowth" | "earningsGrowth" | "profitMargin" | "currentRatio" | "freeCashFlow" | "peRatio";

export type FundamentalMetric = {
  key: FundamentalKey;
  label: string;
  value: number | null;
  displayValue: string;
  grade: MetricGrade;
  explanation: string;
  sectorSensitive?: boolean;
};

export type TrendSnapshot = {
  lastPrice: number | null;
  sma50: number | null;
  sma200: number | null;
  return3mPct: number | null;
  return1yPct: number | null;
  support60d: number | null;
  high52w: number | null;
  low52w: number | null;
  samples: number;
};

export type EntryZone = {
  low: number | null;
  high: number | null;
  status: "FAVOURABLE_PULLBACK" | "NEAR_ZONE" | "WAIT_FOR_PULLBACK" | "TREND_NOT_CONFIRMED" | "INSUFFICIENT_HISTORY";
  explanation: string;
};

export function metricGrade(key: FundamentalKey, value: number | null): MetricGrade {
  if (value === null || !Number.isFinite(value)) return "NO_DATA";
  switch (key) {
    case "roe": return value >= 0.15 ? "GOOD" : value >= 0.08 ? "FAIR" : "WEAK";
    case "debtToEquity": return value <= 70 ? "GOOD" : value <= 150 ? "FAIR" : "WEAK";
    case "revenueGrowth": return value >= 0.10 ? "GOOD" : value >= 0 ? "FAIR" : "WEAK";
    case "earningsGrowth": return value >= 0.10 ? "GOOD" : value >= 0 ? "FAIR" : "WEAK";
    case "profitMargin": return value >= 0.10 ? "GOOD" : value >= 0.05 ? "FAIR" : "WEAK";
    case "currentRatio": return value >= 1.5 ? "GOOD" : value >= 1 ? "FAIR" : "WEAK";
    case "freeCashFlow": return value > 0 ? "GOOD" : "WEAK";
    case "peRatio": return value <= 25 ? "GOOD" : value <= 40 ? "FAIR" : "WEAK";
  }
}

export function calculateQualityScore(metrics: FundamentalMetric[]): { score: number | null; available: number; good: number; weak: number } {
  const applicable = metrics.filter((item) => item.grade !== "NO_DATA");
  if (applicable.length < 3) return { score: null, available: applicable.length, good: 0, weak: 0 };
  const points = applicable.reduce((sum, item) => sum + (item.grade === "GOOD" ? 2 : item.grade === "FAIR" ? 1 : 0), 0);
  return {
    score: Math.round(points / (applicable.length * 2) * 100),
    available: applicable.length,
    good: applicable.filter((item) => item.grade === "GOOD").length,
    weak: applicable.filter((item) => item.grade === "WEAK").length
  };
}

export function buildEntryZone(trend: TrendSnapshot): EntryZone {
  const price = trend.lastPrice;
  const sma50 = trend.sma50;
  const sma200 = trend.sma200;
  if (price === null || sma50 === null || trend.samples < 50) {
    return { low: null, high: null, status: "INSUFFICIENT_HISTORY", explanation: "Not enough complete daily candles to estimate a long-term entry zone." };
  }
  const low = Math.round(sma50 * 0.97 * 100) / 100;
  const high = Math.round(sma50 * 1.02 * 100) / 100;
  if (sma200 === null || trend.samples < 200) {
    return { low, high, status: "INSUFFICIENT_HISTORY", explanation: "A 50-day reference exists, but a 200-day trend confirmation is unavailable. Treat this as a provisional price reference only." };
  }
  if (price < sma200) {
    return { low, high, status: "TREND_NOT_CONFIRMED", explanation: "Price is below its 200-day average. Avoid treating a low price alone as a bargain; wait for the long-term trend to improve." };
  }
  if (price > sma50 * 1.12) {
    return { low, high, status: "WAIT_FOR_PULLBACK", explanation: "Price is more than 12% above its 50-day average. Avoid chasing; watch the reference zone near the 50-day average." };
  }
  if (price <= high) {
    return { low, high, status: "NEAR_ZONE", explanation: "Price is near the 50-day reference zone while above the 200-day trend line. Consider staged entries only after checking business quality and valuation." };
  }
  return { low, high, status: "FAVOURABLE_PULLBACK", explanation: "Long-term trend is positive and price is not stretched far above the 50-day average. The zone is a technical reference, not a fair-value estimate or guaranteed support." };
}

export function classifyDealFirstSeen(deal: { symbol: string; client: string; side: string; date: string }, all: Array<{ symbol: string; client: string; side: string; date: string }>): boolean {
  return !all.some((other) =>
    other.symbol.toUpperCase() === deal.symbol.toUpperCase() &&
    other.client.toUpperCase() === deal.client.toUpperCase() &&
    other.side.toUpperCase() === deal.side.toUpperCase() &&
    other.date !== deal.date
  );
}
