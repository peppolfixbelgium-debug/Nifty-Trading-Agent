import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import { evaluateLongTermStock } from "../src/lib/long-term-evaluation.js";
import type { BrokerRating, LongTermResearchResponse } from "../src/lib/long-term-types.js";
import { asArray, asRecord, getYahooDailyHistory, getYahooQuoteSummary, normalizeNseYahooSymbol, numeric, textValue, type DataRecord } from "../src/lib/yahoo-free-data.js";

const readNumber = (record: DataRecord, key: string): number | null => numeric(record[key]);
const readText = (record: DataRecord, key: string): string | null => textValue(record[key]);

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index]! - values[index - 1]!;
    if (change > 0) gains += change; else losses -= change;
  }
  const averageGain = gains / period, averageLoss = losses / period;
  if (averageLoss === 0) return averageGain > 0 ? 100 : 50;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function countsFromTrend(summary: DataRecord): LongTermResearchResponse["recommendationCounts"] {
  const recommendationTrend = asRecord(summary.recommendationTrend);
  const trend = asArray(recommendationTrend.trend).map(asRecord);
  const current = trend.find(row => row.period === "0m") ?? trend[0];
  if (!current) return null;
  const counts = {
    strongBuy: readNumber(current, "strongBuy") ?? 0,
    buy: readNumber(current, "buy") ?? 0,
    hold: readNumber(current, "hold") ?? 0,
    sell: readNumber(current, "sell") ?? 0,
    strongSell: readNumber(current, "strongSell") ?? 0
  };
  return Object.values(counts).some(value => value > 0) ? counts : null;
}

function brokerRatingsFromSummary(summary: DataRecord): BrokerRating[] {
  const module = asRecord(summary.upgradeDowngradeHistory);
  const history = asArray(module.history).map(asRecord);
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const actionLabels: Record<string, string> = {
    up: "Upgraded", down: "Downgraded", init: "Initiated", main: "Maintained",
    reiterate: "Reiterated", "": "Updated"
  };
  return history
    .filter(row => {
      const epoch = numeric(row.epochGradeDate);
      return epoch !== null && epoch * 1000 >= cutoff;
    })
    .sort((a, b) => (numeric(b.epochGradeDate) ?? 0) - (numeric(a.epochGradeDate) ?? 0))
    .slice(0, 15)
    .map(row => {
      const epoch = numeric(row.epochGradeDate);
      const rawAction = (readText(row, "action") ?? "").toLowerCase();
      const date = epoch === null ? null : new Date(epoch * 1000).toISOString().slice(0, 10);
      return {
        firm: readText(row, "firm") ?? "Broker not identified",
        date,
        action: actionLabels[rawAction] ?? (rawAction ? rawAction.replace(/_/g, " ") : "Updated"),
        fromGrade: readText(row, "fromGrade"),
        toGrade: readText(row, "toGrade")
      };
    });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  let symbol: string;
  try {
    symbol = normalizeNseYahooSymbol(typeof req.query.symbol === "string" ? req.query.symbol : "RELIANCE");
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Enter a valid NSE ticker." });
  }

  try {
    const [historyResult, summaryResult] = await Promise.all([
      getYahooDailyHistory(symbol),
      getYahooQuoteSummary(symbol)
    ]);
    const warnings: string[] = [];
    if (summaryResult.warning) warnings.push("Fundamentals and broker-rating coverage is unavailable from the free public source right now: " + summaryResult.warning);
    const summary = summaryResult.summary ?? {};
    const priceModule = asRecord(summary.price);
    const quoteType = asRecord(summary.quoteType);
    const profile = asRecord(summary.summaryProfile);
    const assetProfile = asRecord(summary.assetProfile);
    const detail = asRecord(summary.summaryDetail);
    const stats = asRecord(summary.defaultKeyStatistics);
    const financial = asRecord(summary.financialData);
    const candles = historyResult.candles;
    const closes = candles.map(candle => candle.close);
    const price = closes.at(-1) ?? null;
    const ma50 = closes.length >= 50 ? mean(closes.slice(-50)) : null;
    const ma200 = closes.length >= 200 ? mean(closes.slice(-200)) : null;
    const last252 = candles.slice(-252);
    const weekHigh = last252.length ? Math.max(...last252.map(candle => candle.high)) : null;
    const weekLow = last252.length ? Math.min(...last252.map(candle => candle.low)) : null;
    const isFinancialSector = /bank|financial|insurance|lending|credit|finance/i.test(
      [readText(assetProfile, "sector"), readText(assetProfile, "industry"), readText(profile, "sector"), readText(profile, "industry")].filter(Boolean).join(" ")
    );

    const evaluation = evaluateLongTermStock({
      trailingPE: readNumber(detail, "trailingPE") ?? readNumber(stats, "trailingPE"),
      priceToBook: readNumber(detail, "priceToBook") ?? readNumber(stats, "priceToBook"),
      dividendYieldPct: (() => { const value = readNumber(detail, "dividendYield"); return value === null ? null : value * 100; })(),
      roePct: (() => { const value = readNumber(financial, "returnOnEquity"); return value === null ? null : value * 100; })(),
      revenueGrowthPct: (() => { const value = readNumber(financial, "revenueGrowth"); return value === null ? null : value * 100; })(),
      earningsGrowthPct: (() => { const value = readNumber(financial, "earningsGrowth"); return value === null ? null : value * 100; })(),
      profitMarginPct: (() => { const value = readNumber(financial, "profitMargins"); return value === null ? null : value * 100; })(),
      debtToEquityPct: readNumber(financial, "debtToEquity"),
      freeCashFlow: readNumber(financial, "freeCashflow"),
      isFinancialSector,
      price,
      ma50,
      ma200,
      rsi14: rsi(closes),
      weekLow,
      weekHigh
    });

    const analystTarget = readNumber(financial, "targetMeanPrice");
    const recommendationCounts = countsFromTrend(summary);
    const result: LongTermResearchResponse = {
      symbol,
      name: readText(priceModule, "longName") ?? readText(priceModule, "shortName") ?? readText(quoteType, "longName") ?? symbol.replace(/\.NS$/, ""),
      sector: readText(assetProfile, "sector") ?? readText(profile, "sector"),
      currency: readText(priceModule, "currency") ?? "INR",
      generatedAt: new Date().toISOString(),
      price,
      marketCap: readNumber(priceModule, "marketCap") ?? readNumber(detail, "marketCap"),
      analystConsensus: readText(financial, "recommendationKey"),
      analystTarget,
      analystTargetUpsidePct: price !== null && analystTarget !== null && price > 0 ? ((analystTarget / price) - 1) * 100 : null,
      recommendationCounts,
      qualityScore: evaluation.qualityScore,
      metricsAvailable: evaluation.metricsAvailable,
      metrics: evaluation.metrics,
      stance: evaluation.stance,
      stanceReason: evaluation.stanceReason,
      timing: { ...evaluation.timing, dataAsOf: historyResult.dataAsOf },
      brokerRatings: brokerRatingsFromSummary(summary),
      sources: [
        { label: "Yahoo Finance fundamentals & analyst actions (unofficial public endpoint)", url: "https://finance.yahoo.com/quote/" + encodeURIComponent(symbol) + "/" },
        { label: "Company annual/quarterly filings (NSE)", url: "https://www.nseindia.com/companies-listing/corporate-filings-financial-results" },
        { label: "NSE shareholding disclosures", url: "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern" }
      ],
      warnings
    };
    if (candles.length < 200) result.warnings.push("Fewer than 200 completed daily candles are available. The long-term trend and entry zone may be incomplete.");
    if (!result.brokerRatings.length) result.warnings.push("No broker-by-broker upgrade/downgrade actions were returned for the last 12 months. A blank table is intentional; no broker ratings are fabricated.");
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({
      error: "Long-term research could not be loaded.",
      detail: error instanceof Error ? error.message : "Unknown public market-data error",
      hint: "This route uses free public Yahoo Finance price data. Retry later if the source rate-limits or does not have this NSE symbol."
    });
  }
}
