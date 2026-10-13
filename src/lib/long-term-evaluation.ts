import type { EntryAssessment, InvestmentStance, LongTermMetric, MetricAssessment } from "./long-term-types.js";

export type LongTermInputs = {
  trailingPE: number | null;
  priceToBook: number | null;
  dividendYieldPct: number | null;
  roePct: number | null;
  revenueGrowthPct: number | null;
  earningsGrowthPct: number | null;
  profitMarginPct: number | null;
  debtToEquityPct: number | null;
  freeCashFlow: number | null;
  isFinancialSector: boolean;
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi14: number | null;
  weekLow: number | null;
  weekHigh: number | null;
};

export type LongTermEvaluation = {
  qualityScore: number | null;
  metricsAvailable: number;
  metrics: LongTermMetric[];
  stance: InvestmentStance;
  stanceReason: string;
  timing: {
    assessment: EntryAssessment;
    message: string;
    price: number | null;
    ma50: number | null;
    ma200: number | null;
    rsi14: number | null;
    weekLow: number | null;
    weekHigh: number | null;
    distanceFrom200Pct: number | null;
    entryLow: number | null;
    entryHigh: number | null;
  };
};

type MetricRule = { id: string; label: string; value: number | null; display: (n: number) => string; weight: number; assess: (n: number) => MetricAssessment; good: string; neutral: string; weak: string; unavailable: string };

const number = (value: number, digits = 1) => value.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const inr = (value: number) => "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function buildMetric(rule: MetricRule): LongTermMetric {
  if (rule.value === null || !Number.isFinite(rule.value)) {
    return { id: rule.id, label: rule.label, display: "Not available", assessment: "UNAVAILABLE", reason: rule.unavailable, value: null, weight: rule.weight };
  }
  const assessment = rule.assess(rule.value);
  const reason = assessment === "GOOD" ? rule.good : assessment === "NEUTRAL" ? rule.neutral : rule.weak;
  return { id: rule.id, label: rule.label, display: rule.display(rule.value), assessment, reason, value: rule.value, weight: rule.weight };
}

const qualityPoints: Record<MetricAssessment, number | null> = { GOOD: 1, NEUTRAL: 0.58, WEAK: 0, UNAVAILABLE: null };

export function evaluateLongTermStock(input: LongTermInputs): LongTermEvaluation {
  const debtWeight = input.isFinancialSector ? 0 : 0.08;
  const metrics = [
    buildMetric({ id: "roe", label: "Return on equity", value: input.roePct, display: n => number(n) + "%", weight: 0.18,
      assess: n => n >= 15 ? "GOOD" : n >= 8 ? "NEUTRAL" : "WEAK",
      good: "Good: returns exceed a common 15% screening benchmark.", neutral: "Mixed: returns are positive but below the stronger 15% benchmark.",
      weak: "Weak: low return on equity can signal poor capital efficiency.", unavailable: "Provider did not return return-on-equity data." }),
    buildMetric({ id: "revenue-growth", label: "Revenue growth", value: input.revenueGrowthPct, display: n => number(n) + "%", weight: 0.16,
      assess: n => n >= 10 ? "GOOD" : n >= 0 ? "NEUTRAL" : "WEAK",
      good: "Good: revenue is growing by at least 10% in the reported period.", neutral: "Neutral: positive but modest revenue growth.", weak: "Weak: reported revenue growth is negative.",
      unavailable: "Provider did not return revenue-growth data." }),
    buildMetric({ id: "earnings-growth", label: "Earnings growth", value: input.earningsGrowthPct, display: n => number(n) + "%", weight: 0.16,
      assess: n => n >= 10 ? "GOOD" : n >= 0 ? "NEUTRAL" : "WEAK",
      good: "Good: reported earnings growth is at least 10%.", neutral: "Neutral: earnings growth is positive but modest.", weak: "Weak: reported earnings growth is negative.",
      unavailable: "Provider did not return earnings-growth data." }),
    buildMetric({ id: "profit-margin", label: "Profit margin", value: input.profitMarginPct, display: n => number(n) + "%", weight: 0.14,
      assess: n => n >= 12 ? "GOOD" : n >= 5 ? "NEUTRAL" : "WEAK",
      good: "Good: strong reported profit margin under this general-purpose screen.", neutral: "Neutral: margin is positive but not especially strong.", weak: "Weak: low or negative margin leaves less room for setbacks.",
      unavailable: "Provider did not return profit-margin data." }),
    buildMetric({ id: "free-cash-flow", label: "Free cash flow", value: input.freeCashFlow, display: n => inr(n), weight: 0.12,
      assess: n => n > 0 ? "GOOD" : "WEAK",
      good: "Good: the latest reported free-cash-flow figure is positive.", neutral: "Not scored.", weak: "Weak: the latest reported free-cash-flow figure is zero or negative; inspect the cash-flow cycle.",
      unavailable: "Provider did not return free-cash-flow data." }),
    buildMetric({ id: "leverage", label: "Debt / equity", value: input.debtToEquityPct, display: n => number(n) + "%", weight: debtWeight,
      assess: n => n <= 50 ? "GOOD" : n <= 100 ? "NEUTRAL" : "WEAK",
      good: "Good: leverage is modest under this screening threshold.", neutral: "Neutral: leverage deserves comparison with sector peers.", weak: "Weak: leverage is high under this general-purpose threshold.",
      unavailable: input.isFinancialSector ? "Not scored for banks/lenders; leverage is structurally different in financial companies." : "Provider did not return debt-to-equity data." }),
    buildMetric({ id: "valuation-pe", label: "Trailing P/E", value: input.trailingPE, display: n => number(n, 1) + "×", weight: 0.10,
      assess: n => n > 0 && n <= 20 ? "GOOD" : n <= 35 && n > 0 ? "NEUTRAL" : "WEAK",
      good: "Good: lower headline earnings multiple under this broad screen; compare with growth and sector peers.", neutral: "Neutral: valuation is neither clearly cheap nor modest under this broad screen.", weak: "Weak: expensive multiple, negative earnings, or an unusable P/E; avoid treating a low/negative P/E as automatically cheap.",
      unavailable: "Provider did not return a usable trailing P/E." }),
    buildMetric({ id: "price-to-book", label: "Price / book", value: input.priceToBook, display: n => number(n, 1) + "×", weight: 0.04,
      assess: n => n > 0 && n <= 3 ? "GOOD" : n > 0 && n <= 6 ? "NEUTRAL" : "WEAK",
      good: "Good: modest price-to-book ratio under this broad screen.", neutral: "Neutral: compare with sector norms and return on equity.", weak: "Weak: high or unusable price-to-book ratio under this broad screen.",
      unavailable: "Provider did not return price-to-book data." }),
    buildMetric({ id: "dividend-yield", label: "Dividend yield", value: input.dividendYieldPct, display: n => number(n, 2) + "%", weight: 0.02,
      assess: n => n >= 3 ? "GOOD" : n >= 1 ? "NEUTRAL" : "WEAK",
      good: "Good: meaningful indicated dividend yield; verify the latest board declaration.", neutral: "Neutral: some dividend income, but not a high-yield profile.", weak: "Weak for income-seeking investors: indicated yield is low or unavailable.",
      unavailable: "Provider did not return dividend-yield data." })
  ];
  const scored = metrics.map(metric => ({ metric, points: qualityPoints[metric.assessment] }))
    .filter((item): item is { metric: LongTermMetric; points: number } => item.points !== null && item.metric.weight > 0);
  const totalWeight = scored.reduce((sum, item) => sum + item.metric.weight, 0);
  const qualityScore = scored.length >= 3 && totalWeight > 0
    ? Math.round(100 * scored.reduce((sum, item) => sum + item.points * item.metric.weight, 0) / totalWeight)
    : null;
  const metricsAvailable = scored.length;
  const price = input.price;
  const ma50 = input.ma50;
  const ma200 = input.ma200;
  const rsi14 = input.rsi14;
  const distanceFrom200Pct = price !== null && ma200 !== null && ma200 > 0 ? (price / ma200 - 1) * 100 : null;
  let assessment: EntryAssessment = "NO_DATA";
  let message = "Not enough completed daily price history to calculate a long-term entry zone.";
  let entryLow: number | null = null;
  let entryHigh: number | null = null;
  if (price !== null && ma50 !== null && ma200 !== null && ma50 > 0 && ma200 > 0) {
    if (price < ma200) {
      assessment = "TREND_DAMAGED";
      entryLow = ma200 * 0.94;
      entryHigh = ma200 * 1.00;
      message = "Price is below its 200-day average. Watch for a sustained reclaim before starting a long-term position; the zone is a watch level, not a buy signal.";
    } else if ((distanceFrom200Pct ?? 0) > 10 || (rsi14 ?? 50) > 70) {
      assessment = "WAIT_PULLBACK";
      entryLow = ma50 * 0.94;
      entryHigh = ma50 * 1.01;
      message = "Price is extended versus its long-term trend or momentum is hot. Avoid chasing; revisit if price cools toward the 50-day average and the business thesis remains intact.";
    } else if ((distanceFrom200Pct ?? 0) >= -3 && (rsi14 === null || rsi14 >= 38 && rsi14 <= 68)) {
      assessment = "IN_ZONE";
      entryLow = ma200 * 0.97;
      entryHigh = ma200 * 1.05;
      message = "Price is near its 200-day trend without an extreme reading. A staged-entry zone can be monitored here, subject to fundamentals, valuation and your own risk tolerance.";
    } else {
      assessment = "WAIT_PULLBACK";
      entryLow = ma50 * 0.95;
      entryHigh = ma50 * 1.02;
      message = "Trend is not clearly broken, but the current price does not meet the preferred accumulation conditions. Monitor the 50-day area rather than chasing.";
    }
  }
  const weakCount = metrics.filter(metric => metric.assessment === "WEAK" && metric.weight > 0).length;
  const goodCount = metrics.filter(metric => metric.assessment === "GOOD" && metric.weight > 0).length;
  let stance: InvestmentStance = "WAIT";
  let stanceReason = "Wait: required fundamentals or price-history coverage is incomplete. Do not rely on a score when key inputs are missing.";
  if (qualityScore !== null && metricsAvailable >= 5 && price !== null && ma200 !== null && rsi14 !== null) {
    if (qualityScore < 32 && weakCount >= 4 && price < ma200) {
      stance = "SELL";
      stanceReason = "Sell / review candidate: several screened business metrics are weak and price is below the 200-day trend. Re-check the original thesis, latest filings and tax consequences; this screen does not issue an automatic sell order.";
    } else if (qualityScore >= 68 && assessment === "IN_ZONE" && goodCount >= 3) {
      stance = "BUY";
      stanceReason = "Buy / staged accumulation candidate under this screen: enough metrics are available, the quality score is supportive and the price is near the long-term trend. Validate the latest results and valuation before acting.";
    } else if (qualityScore >= 48 && price >= ma200 && weakCount <= 3) {
      stance = "HOLD";
      stanceReason = "Hold / monitor: fundamentals and trend are mixed-to-supportive, but this screen does not see a strong new-entry setup right now.";
    } else if (qualityScore < 38 && weakCount >= 3) {
      stance = "SELL";
      stanceReason = "Sell / review candidate: several screened metrics are weak. Review the thesis and primary filings before making any portfolio decision; this is a rule-based flag, not personal advice.";
    } else {
      stance = "WAIT";
      stanceReason = "Wait for a stronger combination of business quality and entry timing. Do not force a buy just because a stock is down or has a low headline multiple.";
    }
  }
  return {
    qualityScore, metricsAvailable, metrics, stance, stanceReason,
    timing: {
      assessment, message, price, ma50, ma200, rsi14,
      weekLow: input.weekLow, weekHigh: input.weekHigh,
      distanceFrom200Pct, entryLow, entryHigh
    }
  };
}
