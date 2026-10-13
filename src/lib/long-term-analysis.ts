import type { Candle } from "./types.js";

export type MetricStatus = "GOOD" | "NEUTRAL" | "WEAK" | "UNAVAILABLE";
export type RatingAction = "BUY" | "HOLD" | "SELL / AVOID";
export type BrokerRating = {
  firm: string;
  action: string;
  fromGrade: string | null;
  toGrade: string | null;
  date: string | null;
};
export type LongTermFundamentals = {
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  returnOnEquityPct: number | null;
  revenueGrowthPct: number | null;
  earningsGrowthPct: number | null;
  operatingMarginPct: number | null;
  profitMarginPct: number | null;
  debtToEquity: number | null;
  dividendYieldPct: number | null;
  marketCap: number | null;
  targetLow: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  analystCount: number | null;
  recommendationTrend: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  brokerRatings: BrokerRating[];
  dataAvailable: boolean;
};
export type LongTermMetric = {
  key: string;
  label: string;
  value: number | null;
  display: string;
  status: MetricStatus;
  note: string;
};
export type EntryPlan = {
  low: number;
  high: number;
  mode: "pullback" | "trend-recovery" | "data-limited";
  starter: number;
  addOn: number;
  confirmation: number | null;
  invalidationWatch: number | null;
  note: string;
};
export type LongTermAnalysis = {
  price: number;
  priceDate: string;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  oneYearReturnPct: number | null;
  threeYearCagrPct: number | null;
  high52Week: number | null;
  low52Week: number | null;
  drawdownFromHighPct: number | null;
  annualizedVolatilityPct: number | null;
  score: number | null;
  rating: RatingAction;
  ratingLabel: string;
  ratingReason: string;
  confidence: "LOW" | "MODERATE" | "HIGH";
  metrics: LongTermMetric[];
  entryPlan: EntryPlan;
  candlesUsed: number;
  fundamentalsAvailable: number;
};

const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const roundPrice = (value: number): number => Math.round(value * 100) / 100;
const pct = (value: number | null): string => value === null ? "Unavailable" : (value > 0 ? "+" : "") + value.toFixed(1) + "%";
const money = (value: number | null): string => value === null ? "Unavailable" : "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function status(value: number | null, rules: { good: (n: number) => boolean; weak: (n: number) => boolean }): MetricStatus {
  if (value === null) return "UNAVAILABLE";
  if (rules.good(value)) return "GOOD";
  if (rules.weak(value)) return "WEAK";
  return "NEUTRAL";
}
function simpleRsi(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gains = 0, losses = 0;
  for (let index = closes.length - 14; index < closes.length; index += 1) {
    const difference = closes[index]! - closes[index - 1]!;
    if (difference > 0) gains += difference; else losses -= difference;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const rs = (gains / 14) / (losses / 14);
  return 100 - 100 / (1 + rs);
}
function annualizedVolatility(closes: number[]): number | null {
  const values = closes.slice(-253);
  if (values.length < 30) return null;
  const returns = values.slice(1).map((value, index) => Math.log(value / values[index]!)).filter(Number.isFinite);
  if (returns.length < 20) return null;
  const average = mean(returns);
  if (average === null) return null;
  const variance = mean(returns.map((value) => (value - average) ** 2));
  return variance === null ? null : Math.sqrt(variance * 252) * 100;
}

export function analyzeLongTermStock(candlesInput: Candle[], fundamentals: LongTermFundamentals): LongTermAnalysis | null {
  const candles = candlesInput.filter((item) =>
    Number.isFinite(item.time) && [item.open, item.high, item.low, item.close].every((v) => Number.isFinite(v) && v > 0) &&
    item.high >= Math.max(item.open, item.close) && item.low <= Math.min(item.open, item.close) && item.high >= item.low
  ).sort((a, b) => a.time - b.time);
  if (candles.length < 30) return null;
  const closes = candles.map((item) => item.close);
  const price = closes.at(-1)!;
  const sma = (days: number) => closes.length >= days ? mean(closes.slice(-days)) : null;
  const sma50 = sma(50), sma200 = sma(200);
  const recentYear = closes.slice(-252);
  const high52Week = recentYear.length ? Math.max(...recentYear) : null;
  const low52Week = recentYear.length ? Math.min(...recentYear) : null;
  const oneYearBase = closes.length > 252 ? closes[closes.length - 253]! : null;
  const threeYearBase = closes.length > 756 ? closes[closes.length - 757]! : null;
  const oneYearReturnPct = oneYearBase && oneYearBase > 0 ? (price / oneYearBase - 1) * 100 : null;
  const threeYearCagrPct = threeYearBase && threeYearBase > 0 ? (Math.pow(price / threeYearBase, 1 / 3) - 1) * 100 : null;
  const drawdownFromHighPct = high52Week && high52Week > 0 ? (price / high52Week - 1) * 100 : null;
  const rsi14 = simpleRsi(closes);
  const volatility = annualizedVolatility(closes);
  const date = new Date(candles.at(-1)!.time).toISOString().slice(0, 10);
  const trendScore = sma200 === null ? null : price > sma200 && (sma50 === null || price > sma50) ? 100 : price > sma200 ? 65 : 25;

  const fundamentalsMap: Array<{key:string; label:string; value:number|null; display:string; status:MetricStatus; note:string; score:number|null}> = [
    { key:"trailingPE", label:"Trailing P/E", value:finite(fundamentals.trailingPE), display: fundamentals.trailingPE === null ? "Unavailable" : fundamentals.trailingPE.toFixed(1) + "×", status:status(finite(fundamentals.trailingPE), {good:n=>n>0&&n<=22,weak:n=>n<=0||n>35}), note:"Lower can mean cheaper, but compare with the company's sector, growth and accounting.", score:fundamentals.trailingPE===null?null:fundamentals.trailingPE>0&&fundamentals.trailingPE<=22?100:fundamentals.trailingPE<=35?55:20 },
    { key:"returnOnEquityPct", label:"Return on equity", value:finite(fundamentals.returnOnEquityPct), display: fundamentals.returnOnEquityPct === null ? "Unavailable" : pct(fundamentals.returnOnEquityPct), status:status(finite(fundamentals.returnOnEquityPct), {good:n=>n>=15,weak:n=>n<8}), note:"A broad quality signal; unusually high ROE can also come from leverage.", score:fundamentals.returnOnEquityPct===null?null:fundamentals.returnOnEquityPct>=15?100:fundamentals.returnOnEquityPct>=8?55:20 },
    { key:"revenueGrowthPct", label:"Revenue growth", value:finite(fundamentals.revenueGrowthPct), display: fundamentals.revenueGrowthPct === null ? "Unavailable" : pct(fundamentals.revenueGrowthPct), status:status(finite(fundamentals.revenueGrowthPct), {good:n=>n>=10,weak:n=>n<0}), note:"Latest reported year-on-year rate from the free data provider, when present.", score:fundamentals.revenueGrowthPct===null?null:fundamentals.revenueGrowthPct>=10?100:fundamentals.revenueGrowthPct>=0?55:15 },
    { key:"operatingMarginPct", label:"Operating margin", value:finite(fundamentals.operatingMarginPct), display: fundamentals.operatingMarginPct === null ? "Unavailable" : pct(fundamentals.operatingMarginPct), status:status(finite(fundamentals.operatingMarginPct), {good:n=>n>=15,weak:n=>n<5}), note:"Sector economics vary; treat it as a starting point, not a universal pass/fail.", score:fundamentals.operatingMarginPct===null?null:fundamentals.operatingMarginPct>=15?100:fundamentals.operatingMarginPct>=5?55:20 },
    { key:"debtToEquity", label:"Debt / equity", value:finite(fundamentals.debtToEquity), display: fundamentals.debtToEquity === null ? "Unavailable" : fundamentals.debtToEquity.toFixed(1) + "%", status:status(finite(fundamentals.debtToEquity), {good:n=>n<=60,weak:n=>n>150}), note:"Provider ratio is shown as reported. Banks/financial firms need different leverage analysis.", score:fundamentals.debtToEquity===null?null:fundamentals.debtToEquity<=60?100:fundamentals.debtToEquity<=150?55:15 },
    { key:"dividendYieldPct", label:"Dividend yield", value:finite(fundamentals.dividendYieldPct), display: fundamentals.dividendYieldPct === null ? "Unavailable" : pct(fundamentals.dividendYieldPct), status:status(finite(fundamentals.dividendYieldPct), {good:n=>n>=1&&n<=6,weak:n=>n>12}), note:"A high yield can be caused by a falling share price; not all good companies pay dividends.", score:fundamentals.dividendYieldPct===null?null:fundamentals.dividendYieldPct>=1&&fundamentals.dividendYieldPct<=6?80:fundamentals.dividendYieldPct>6&&fundamentals.dividendYieldPct<=12?60:50 }
  ];
  const availableFundamentals = fundamentalsMap.filter((metric) => metric.value !== null);
  const fundScore = mean(availableFundamentals.filter(m => m.key !== "dividendYieldPct").map(m => m.score!).filter(Number.isFinite));
  const fundamentalCount = availableFundamentals.length;
  const technicalBits: number[] = [];
  if (trendScore !== null) technicalBits.push(trendScore);
  if (oneYearReturnPct !== null) technicalBits.push(oneYearReturnPct >= 12 ? 100 : oneYearReturnPct > 0 ? 65 : oneYearReturnPct > -15 ? 40 : 15);
  if (rsi14 !== null) technicalBits.push(rsi14 >= 45 && rsi14 <= 65 ? 100 : rsi14 >= 35 && rsi14 <= 72 ? 60 : 25);
  if (drawdownFromHighPct !== null) technicalBits.push(drawdownFromHighPct >= -15 && drawdownFromHighPct <= -3 ? 90 : drawdownFromHighPct > -3 ? 55 : drawdownFromHighPct >= -30 ? 60 : 20);
  const technicalScore = mean(technicalBits);
  const score = fundScore !== null && fundamentalCount >= 3 && technicalScore !== null && sma200 !== null
    ? Math.round(fundScore * 0.62 + technicalScore * 0.38)
    : null;
  const trendWeak = sma200 !== null && price < sma200;
  const stretched = sma50 !== null && price > sma50 * 1.08;
  let rating: RatingAction = "HOLD";
  let ratingLabel = "HOLD · NEED MORE EVIDENCE";
  let ratingReason = "The free data does not provide enough comparable fundamental and price history to justify a stronger long-term screen. Keep researching; missing values are not treated as good.";
  if (score !== null && score >= 70 && !trendWeak && !stretched) {
    rating = "BUY"; ratingLabel = "BUY · PHASED ENTRY";
    ratingReason = "The available quality/value checks and long-term trend pass this screen, and price is not far above its 50-day average. Consider staged entries only after checking filings, sector context and your risk limits.";
  } else if (score !== null && (score < 38 || (trendWeak && fundamentalCount >= 4 && fundScore !== null && fundScore < 45))) {
    rating = "SELL / AVOID"; ratingLabel = "SELL / AVOID · REVIEW";
    ratingReason = "Several screening inputs are weak or the price is below its 200-day average. For existing holdings, review the original thesis, filings and portfolio concentration rather than selling automatically from one score.";
  } else if (score !== null && score >= 70 && stretched) {
    rating = "HOLD"; ratingLabel = "HOLD · WAIT FOR ENTRY";
    ratingReason = "The fundamentals look comparatively strong in this screen, but the price is more than 8% above its 50-day average. The entry plan is a pullback watch zone, not a signal to chase.";
  } else if (score !== null) {
    rating = "HOLD"; ratingLabel = "HOLD · MIXED EVIDENCE";
    ratingReason = "The available inputs are mixed. Keep the stock on a watchlist and look for stronger evidence or a better entry instead of forcing a buy.";
  }
  const mode: EntryPlan["mode"] = sma200 !== null && price < sma200 ? "trend-recovery" : sma50 !== null ? "pullback" : "data-limited";
  let entryLow: number, entryHigh: number;
  if (mode === "trend-recovery" && sma200 !== null) {
    entryLow = sma200 * 0.97; entryHigh = sma200 * 1.02;
  } else if (sma50 !== null && price > sma50 * 1.08) {
    entryLow = sma50 * 0.98; entryHigh = sma50 * 1.03;
  } else if (sma50 !== null) {
    entryLow = Math.min(price * 0.97, sma50 * 0.97);
    entryHigh = Math.min(price * 1.02, sma50 * 1.02);
  } else {
    entryLow = price * 0.92; entryHigh = price * 0.98;
  }
  if (entryHigh < entryLow) entryHigh = entryLow;
  const entryPlan: EntryPlan = {
    low: roundPrice(entryLow), high: roundPrice(entryHigh),
    mode,
    starter: roundPrice(entryHigh),
    addOn: roundPrice(entryLow),
    confirmation: sma200 === null ? null : roundPrice(sma200 * 1.01),
    invalidationWatch: sma200 === null ? null : roundPrice(sma200 * 0.92),
    note: mode === "trend-recovery"
      ? "Price is below its 200-day average. Treat this as a recovery watch zone around the 200-day average; do not read it as a buy-now signal."
      : mode === "pullback"
        ? "Indicative staged-entry range anchored to price and the 50-day average. It is a watch zone, not a forecast; reassess after results, news and corporate actions."
        : "History is limited for moving averages. This broad pullback zone is low-confidence; wait for more data before relying on it."
  };
  const allMetrics: LongTermMetric[] = [
    {key:"trend200",label:"Price vs 200-day average",value:sma200===null?null:(price/sma200-1)*100,display:sma200===null?"Unavailable":pct((price/sma200-1)*100),status:status(sma200===null?null:(price/sma200-1)*100,{good:n=>n>=3,weak:n=>n<0}),note:sma200===null?"At least 200 completed daily candles are needed.":"Useful trend context, but not a measure of intrinsic value."},
    {key:"oneYearReturnPct",label:"1-year price return",value:oneYearReturnPct,display:pct(oneYearReturnPct),status:status(oneYearReturnPct,{good:n=>n>=10,weak:n=>n<0}),note:"Price-only return; dividend reinvestment and your costs are not included."},
    {key:"drawdownFromHighPct",label:"Below 52-week high",value:drawdownFromHighPct,display:drawdownFromHighPct===null?"Unavailable":Math.abs(drawdownFromHighPct).toFixed(1)+"% below",status:status(drawdownFromHighPct,{good:n=>n<=-5&&n>=-20,weak:n=>n< -30}),note:"A pullback is not automatically cheap; investigate why price fell."},
    {key:"rsi14",label:"RSI (14)",value:rsi14,display:rsi14===null?"Unavailable":rsi14.toFixed(1),status:status(rsi14,{good:n=>n>=45&&n<=65,weak:n=>n<30||n>75}),note:"Momentum context; RSI is not a valuation metric."},
    {key:"trailingPE",label:"Trailing P/E",value:fundamentals.trailingPE,display:fundamentals.trailingPE===null?"Unavailable":fundamentals.trailingPE.toFixed(1)+"×",status:fundamentalsMap[0]!.status,note:fundamentalsMap[0]!.note},
    {key:"returnOnEquityPct",label:"Return on equity",value:fundamentals.returnOnEquityPct,display:fundamentals.returnOnEquityPct===null?"Unavailable":pct(fundamentals.returnOnEquityPct),status:fundamentalsMap[1]!.status,note:fundamentalsMap[1]!.note},
    {key:"revenueGrowthPct",label:"Revenue growth",value:fundamentals.revenueGrowthPct,display:fundamentals.revenueGrowthPct===null?"Unavailable":pct(fundamentals.revenueGrowthPct),status:fundamentalsMap[2]!.status,note:fundamentalsMap[2]!.note},
    {key:"operatingMarginPct",label:"Operating margin",value:fundamentals.operatingMarginPct,display:fundamentals.operatingMarginPct===null?"Unavailable":pct(fundamentals.operatingMarginPct),status:fundamentalsMap[3]!.status,note:fundamentalsMap[3]!.note},
    {key:"debtToEquity",label:"Debt / equity",value:fundamentals.debtToEquity,display:fundamentals.debtToEquity===null?"Unavailable":fundamentals.debtToEquity.toFixed(1)+"%",status:fundamentalsMap[4]!.status,note:fundamentalsMap[4]!.note},
    {key:"dividendYieldPct",label:"Dividend yield",value:fundamentals.dividendYieldPct,display:fundamentals.dividendYieldPct===null?"Unavailable":pct(fundamentals.dividendYieldPct),status:fundamentalsMap[5]!.status,note:fundamentalsMap[5]!.note}
  ];
  const brokerRatings = fundamentals.brokerRatings.slice().sort((a,b)=>(b.date??"").localeCompare(a.date??"")).slice(0,15);
  return {
    price, priceDate:date, sma50, sma200, rsi14, oneYearReturnPct, threeYearCagrPct,
    high52Week, low52Week, drawdownFromHighPct, annualizedVolatilityPct:volatility,
    score, rating, ratingLabel, ratingReason,
    confidence: score === null ? "LOW" : fundamentalCount >= 5 && candles.length >= 500 ? "HIGH" : "MODERATE",
    metrics: allMetrics, entryPlan, candlesUsed:candles.length,
    fundamentalsAvailable: fundamentalCount
  };
}
