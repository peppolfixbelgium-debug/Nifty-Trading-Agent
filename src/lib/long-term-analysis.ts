export type LongTermAction = "BUY" | "HOLD" | "SELL" | "INSUFFICIENT_DATA";

export type LongTermMetrics = {
  price: number | null;
  sma50: number | null;
  sma200: number | null;
  return1yPct: number | null;
  return3yPct: number | null;
  roePct: number | null;
  profitMarginPct: number | null;
  revenueGrowthPct: number | null;
  earningsGrowthPct: number | null;
  debtToEquityPct: number | null;
  sector: string | null;
};

export type LongTermFactor = {
  key: string;
  label: string;
  score: -1 | 0 | 1 | null;
  finding: string;
};

export type LongTermAssessment = {
  action: LongTermAction;
  score: number;
  availableFactors: number;
  totalFactors: number;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "NOT_ENOUGH_DATA";
  summary: string;
  factors: LongTermFactor[];
};

function signedFactor(
  key: string,
  label: string,
  score: -1 | 0 | 1 | null,
  finding: string
): LongTermFactor {
  return { key, label, score, finding };
}

export function assessLongTerm(metrics: LongTermMetrics): LongTermAssessment {
  const factors: LongTermFactor[] = [];

  if (metrics.price !== null && metrics.sma50 !== null && metrics.sma200 !== null) {
    const above50 = metrics.price > metrics.sma50;
    const above200 = metrics.price > metrics.sma200;
    const score: -1 | 0 | 1 = above50 && above200 ? 1 : !above50 && !above200 ? -1 : 0;
    factors.push(signedFactor(
      "trend",
      "Long-term price trend",
      score,
      score === 1 ? "Price is above both the 50-day and 200-day averages."
        : score === -1 ? "Price is below both the 50-day and 200-day averages."
          : "The 50-day and 200-day trend signals are mixed."
    ));
  } else {
    factors.push(signedFactor("trend", "Long-term price trend", null, "Not enough price history to compare both moving averages."));
  }

  if (metrics.return1yPct !== null && metrics.return3yPct !== null) {
    const score: -1 | 0 | 1 = metrics.return1yPct > 0 && metrics.return3yPct > 0 ? 1
      : metrics.return1yPct < 0 && metrics.return3yPct < 0 ? -1 : 0;
    factors.push(signedFactor(
      "performance",
      "1-year / 3-year performance",
      score,
      score === 1 ? "Both the 1-year and 3-year price returns are positive."
        : score === -1 ? "Both the 1-year and 3-year price returns are negative."
          : "The 1-year and 3-year returns disagree or are near zero."
    ));
  } else {
    factors.push(signedFactor("performance", "1-year / 3-year performance", null, "A full 1-year and 3-year return window is not available."));
  }

  const growthValues = [metrics.revenueGrowthPct, metrics.earningsGrowthPct].filter((value): value is number => value !== null);
  if (growthValues.length) {
    const positives = growthValues.filter((value) => value > 0).length;
    const negatives = growthValues.filter((value) => value < 0).length;
    const score: -1 | 0 | 1 = positives === growthValues.length ? 1
      : negatives === growthValues.length ? -1 : 0;
    factors.push(signedFactor(
      "growth",
      "Revenue / earnings growth",
      score,
      "Available growth readings: " + (metrics.revenueGrowthPct === null ? "revenue n/a" : "revenue " + metrics.revenueGrowthPct.toFixed(1) + "%")
        + "; " + (metrics.earningsGrowthPct === null ? "earnings n/a" : "earnings " + metrics.earningsGrowthPct.toFixed(1) + "%") + "."
    ));
  } else {
    factors.push(signedFactor("growth", "Revenue / earnings growth", null, "Growth metrics were not available from the public data source."));
  }

  if (metrics.roePct !== null || metrics.profitMarginPct !== null) {
    const poorReturn = metrics.roePct !== null && metrics.roePct < 5;
    const negativeMargin = metrics.profitMarginPct !== null && metrics.profitMarginPct < 0;
    const strongReturn = metrics.roePct !== null && metrics.roePct >= 15;
    const positiveMargin = metrics.profitMarginPct !== null && metrics.profitMarginPct > 0;
    const score: -1 | 0 | 1 = negativeMargin || poorReturn ? -1 : strongReturn && positiveMargin ? 1 : 0;
    factors.push(signedFactor(
      "profitability",
      "Profitability",
      score,
      "Available readings: " + (metrics.roePct === null ? "ROE n/a" : "ROE " + metrics.roePct.toFixed(1) + "%")
        + "; " + (metrics.profitMarginPct === null ? "profit margin n/a" : "margin " + metrics.profitMarginPct.toFixed(1) + "%") + "."
    ));
  } else {
    factors.push(signedFactor("profitability", "Profitability", null, "ROE and profit-margin data were not available."));
  }

  const sector = (metrics.sector ?? "").toLowerCase();
  const financialSector = /bank|financial|insurance|credit|capital market/.test(sector);
  if (financialSector) {
    factors.push(signedFactor("leverage", "Balance-sheet leverage", null, "Debt/equity is not scored for financial-sector companies because leverage is not directly comparable with non-financial firms."));
  } else if (metrics.debtToEquityPct !== null) {
    const score: -1 | 0 | 1 = metrics.debtToEquityPct < 60 ? 1
      : metrics.debtToEquityPct > 150 ? -1 : 0;
    factors.push(signedFactor(
      "leverage",
      "Balance-sheet leverage",
      score,
      "Debt/equity is " + metrics.debtToEquityPct.toFixed(1) + "%; lower leverage can improve resilience, but sector context matters."
    ));
  } else {
    factors.push(signedFactor("leverage", "Balance-sheet leverage", null, "Debt/equity data was not available."));
  }

  const available = factors.filter((factor) => factor.score !== null);
  const score = available.reduce((sum, factor) => sum + (factor.score ?? 0), 0);
  let action: LongTermAction = "INSUFFICIENT_DATA";
  let confidence: LongTermAssessment["confidence"] = "NOT_ENOUGH_DATA";
  let summary = "There is not enough independent evidence to label this stock Buy, Hold or Sell. Check the source links and financial statements.";

  if (available.length >= 3) {
    confidence = available.length >= 5 ? "HIGH" : available.length >= 4 ? "MEDIUM" : "LOW";
    if (score >= 3) action = "BUY";
    else if (score <= -2) action = "SELL";
    else action = "HOLD";

    summary = action === "BUY"
      ? "The available long-term screen is constructive. Review valuation, debt, business risks and the latest filings before making a decision."
      : action === "SELL"
        ? "The available long-term screen is weak. Re-check the investment thesis, valuation and latest filings before deciding whether to reduce exposure."
        : "The available long-term screen is mixed or not strong enough for a Buy/Sell label. Keep researching and compare the valuation with the company’s own history and peers.";
  }

  return {
    action,
    score,
    availableFactors: available.length,
    totalFactors: factors.length,
    confidence,
    summary,
    factors
  };
}
