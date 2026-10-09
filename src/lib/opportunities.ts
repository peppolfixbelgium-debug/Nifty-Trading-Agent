import { averageTrueRange, averageVolume, movingAverage, relativeStrengthIndex } from "./indicators.js";
import { fetchCandles } from "./backtest.js";
import { UNIVERSE } from "./universe.js";
import type { Candle } from "./types.js";
import type {
  CandidateMetrics,
  ExcludedSymbol,
  OpportunityCandidate,
  OpportunityScanConfig,
  OpportunityScanResponse,
  StrategyId,
  TradeDirection
} from "./opportunity-types.js";

const STRATEGIES: Array<{ id: StrategyId; name: string }> = [
  { id: "trend-following", name: "Trend following" },
  { id: "breakout-volume", name: "Breakout + volume" },
  { id: "trend-pullback", name: "Trend pullback" },
  { id: "mean-reversion", name: "Mean reversion" }
];
const WARMUP_BARS = 199;
const MAX_HOLDING_BARS = 20;
const STOP_ATR = 1.5;
const TARGET_R = 2;
const ROUND = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const dateKey = (time: number) => new Date(time).toISOString().slice(0, 10);
const daysBetween = (later: string, earlier: string) =>
  Math.round((Date.parse(later + "T00:00:00Z") - Date.parse(earlier + "T00:00:00Z")) / 86_400_000);

export type OpportunityFeature = {
  index: number;
  date: string;
  close: number;
  high: number;
  low: number;
  atr14: number;
  rsi14: number;
  sma20: number;
  sma50: number;
  sma200: number;
  relativeVolume: number | null;
  priorHigh20: number;
  priorLow20: number;
  previousClose: number;
};

export function buildOpportunityFeatures(candles: Candle[]): Array<OpportunityFeature | null> {
  const features: Array<OpportunityFeature | null> = Array.from({ length: candles.length }, () => null);
  for (let index = WARMUP_BARS; index < candles.length; index += 1) {
    const current = candles[index];
    if (!current) continue;
    const history = candles.slice(index - WARMUP_BARS, index + 1);
    const closes = history.map((candle) => candle.close);
    const sma20 = movingAverage(closes.slice(-20), 20);
    const sma50 = movingAverage(closes.slice(-50), 50);
    const sma200 = movingAverage(closes, 200);
    const atr14 = averageTrueRange(candles.slice(index - 14, index + 1), 14);
    const rsi14 = relativeStrengthIndex(closes.slice(-15), 14);
    const previousClose = candles[index - 1]?.close;
    const priorBars = candles.slice(index - 20, index);
    const priorVolume = averageVolume(priorBars.map((candle) => candle.volume), 20);
    if (
      sma20 === null || sma50 === null || sma200 === null || atr14 === null || rsi14 === null ||
      previousClose === undefined || priorBars.length !== 20 || atr14 <= 0
    ) continue;
    const relativeVolume = current.volume !== null && priorVolume !== null && priorVolume > 0
      ? current.volume / priorVolume
      : null;
    features[index] = {
      index,
      date: dateKey(current.time),
      close: current.close,
      high: current.high,
      low: current.low,
      atr14,
      rsi14,
      sma20,
      sma50,
      sma200,
      relativeVolume,
      priorHigh20: Math.max(...priorBars.map((candle) => candle.high)),
      priorLow20: Math.min(...priorBars.map((candle) => candle.low)),
      previousClose
    };
  }
  return features;
}

/** Fixed, pre-registered entry rules. Do not tune these thresholds against the final test window. */
export function matchesOpportunitySignal(
  feature: OpportunityFeature | null | undefined,
  previous: OpportunityFeature | null | undefined,
  strategy: StrategyId,
  direction: TradeDirection
): boolean {
  if (!feature || feature.atr14 <= 0) return false;
  const f = feature;
  const long = direction === "LONG";
  const bullish = f.close > f.sma20 && f.sma20 > f.sma50 && f.sma50 > f.sma200;
  const bearish = f.close < f.sma20 && f.sma20 < f.sma50 && f.sma50 < f.sma200;

  switch (strategy) {
    case "trend-following":
      return long
        ? bullish && f.rsi14 >= 50 && f.rsi14 <= 74
        : bearish && f.rsi14 >= 26 && f.rsi14 <= 50;
    case "breakout-volume":
      if (f.relativeVolume === null || f.relativeVolume < 1.1) return false;
      return long
        ? f.close > f.priorHigh20 + 0.1 * f.atr14 && f.close > f.sma50 && f.sma50 > f.sma200 && f.rsi14 >= 50 && f.rsi14 <= 75
        : f.close < f.priorLow20 - 0.1 * f.atr14 && f.close < f.sma50 && f.sma50 < f.sma200 && f.rsi14 >= 25 && f.rsi14 <= 50;
    case "trend-pullback":
      if (!previous) return false;
      return long
        ? bullish && previous.close < previous.sma20 && f.close > f.sma20 && f.low <= f.sma20 + 0.25 * f.atr14 && f.rsi14 >= 42 && f.rsi14 <= 68
        : bearish && previous.close > previous.sma20 && f.close < f.sma20 && f.high >= f.sma20 - 0.25 * f.atr14 && f.rsi14 >= 32 && f.rsi14 <= 58;
    case "mean-reversion":
      return long
        ? f.close < f.sma20 - 1.25 * f.atr14 && f.rsi14 < 35
        : f.close > f.sma20 + 1.25 * f.atr14 && f.rsi14 > 65;
  }
}

type Trade = {
  entryIndex: number;
  exitIndex: number;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnlInr: number;
  costsInr: number;
  netPnlInr: number;
  rMultiple: number;
};

type OpenPosition = {
  entryIndex: number;
  direction: TradeDirection;
  entryPrice: number;
  stop: number;
  target: number;
  quantity: number;
  entryCost: number;
  initialRiskInr: number;
};

type WindowSimulation = {
  metrics: CandidateMetrics;
  trades: Trade[];
};

function simulateWindow(input: {
  candles: Candle[];
  features: Array<OpportunityFeature | null>;
  strategy: StrategyId;
  direction: TradeDirection;
  startIndex: number;
  endIndex: number;
  capitalInr: number;
  requestedRiskInr: number;
  costBpsPerSide: number;
}): WindowSimulation {
  const { candles, features, strategy, direction, startIndex, endIndex } = input;
  const capital = Math.max(1, input.capitalInr);
  const riskBudget = Math.min(Math.max(1, input.requestedRiskInr), capital * 0.01);
  const costRate = Math.max(0, input.costBpsPerSide) / 10_000;
  const positionLimit = capital * 0.1;
  let cash = capital;
  let open: OpenPosition | null = null;
  let pending: { signalIndex: number; atr14: number } | null = null;
  const trades: Trade[] = [];
  const equity: Array<{ date: string; value: number }> = [];
  let totalCosts = 0;

  const closePosition = (index: number, exitPrice: number) => {
    if (!open) return;
    const position = open;
    const exitCost = position.quantity * exitPrice * costRate;
    const grossPnl = position.direction === "LONG"
      ? position.quantity * (exitPrice - position.entryPrice)
      : position.quantity * (position.entryPrice - exitPrice);
    const costs = position.entryCost + exitCost;
    const netPnl = grossPnl - costs;
    if (position.direction === "LONG") cash += position.quantity * exitPrice - exitCost;
    else cash -= position.quantity * exitPrice + exitCost;
    totalCosts += costs;
    trades.push({
      entryIndex: position.entryIndex,
      exitIndex: index,
      direction: position.direction,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      grossPnlInr: ROUND(grossPnl),
      costsInr: ROUND(costs),
      netPnlInr: ROUND(netPnl),
      rMultiple: ROUND(netPnl / Math.max(position.initialRiskInr, 0.01), 3)
    });
    open = null;
  };

  for (let index = startIndex; index <= endIndex; index += 1) {
    const bar = candles[index];
    if (!bar) continue;

    if (pending && !open && pending.signalIndex + 1 === index && bar.open > 0) {
      const stopDistance = STOP_ATR * pending.atr14;
      const quantityByRisk = Math.floor(riskBudget / stopDistance);
      const quantityByPosition = Math.floor(positionLimit / bar.open);
      const quantityByCash = direction === "LONG"
        ? Math.floor(cash / (bar.open * (1 + costRate)))
        : Number.MAX_SAFE_INTEGER;
      const quantity = Math.max(0, Math.min(quantityByRisk, quantityByPosition, quantityByCash));
      if (quantity > 0) {
        const entryCost = quantity * bar.open * costRate;
        if (direction === "LONG") cash -= quantity * bar.open + entryCost;
        else cash += quantity * bar.open - entryCost;
        open = {
          entryIndex: index,
          direction,
          entryPrice: bar.open,
          stop: direction === "LONG" ? bar.open - stopDistance : bar.open + stopDistance,
          target: direction === "LONG" ? bar.open + stopDistance * TARGET_R : bar.open - stopDistance * TARGET_R,
          quantity,
          entryCost,
          initialRiskInr: stopDistance * quantity
        };
      }
      pending = null;
    }

    if (open) {
      let exitPrice: number | null = null;
      if (open.direction === "LONG") {
        if (bar.open <= open.stop) exitPrice = bar.open;
        else if (bar.open >= open.target) exitPrice = bar.open;
        else if (bar.low <= open.stop && bar.high >= open.target) exitPrice = open.stop;
        else if (bar.low <= open.stop) exitPrice = open.stop;
        else if (bar.high >= open.target) exitPrice = open.target;
      } else {
        if (bar.open >= open.stop) exitPrice = bar.open;
        else if (bar.open <= open.target) exitPrice = bar.open;
        else if (bar.high >= open.stop && bar.low <= open.target) exitPrice = open.stop;
        else if (bar.high >= open.stop) exitPrice = open.stop;
        else if (bar.low <= open.target) exitPrice = open.target;
      }
      if (exitPrice !== null) closePosition(index, exitPrice);
      else if (index - open.entryIndex + 1 >= MAX_HOLDING_BARS) closePosition(index, bar.close);
      else if (index === endIndex) closePosition(index, bar.close);
    }

    if (!open && !pending && index < endIndex) {
      const feature = features[index];
      const previous = features[index - 1];
      if (matchesOpportunitySignal(feature, previous, strategy, direction) && feature) {
        pending = { signalIndex: index, atr14: feature.atr14 };
      }
    }

    const markEquity = open
      ? cash + (open.direction === "LONG" ? open.quantity * bar.close : -open.quantity * bar.close)
      : cash;
    equity.push({ date: dateKey(bar.time), value: markEquity });
  }

  const lastEquity = equity.at(-1)?.value ?? cash;
  const finalEquity = ROUND(lastEquity);
  const netPnl = ROUND(finalEquity - capital);
  const wins = trades.filter((trade) => trade.netPnlInr > 0).length;
  const losses = trades.filter((trade) => trade.netPnlInr < 0).length;
  const winPnl = trades.reduce((sum, trade) => sum + Math.max(0, trade.netPnlInr), 0);
  const lossPnl = trades.reduce((sum, trade) => sum + Math.max(0, -trade.netPnlInr), 0);
  const profitFactor = lossPnl > 0 ? winPnl / lossPnl : winPnl > 0 ? null : 0;
  const expectancyR = trades.length ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length : null;
  let peak = capital;
  let maxDrawdownPct = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.value);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.value) / peak) * 100);
  }
  const closedTradeNetPnlInr = trades.reduce((sum, trade) => sum + trade.netPnlInr, 0);
  const reconciliationDifferenceInr = ROUND(netPnl - closedTradeNetPnlInr);
  const toleranceInr = ROUND(Math.max(0.05, trades.length * 0.01 + 0.02));
  const accounting = {
    closedTradeNetPnlInr: ROUND(closedTradeNetPnlInr),
    equityDerivedNetPnlInr: netPnl,
    reconciliationDifferenceInr,
    toleranceInr,
    reconciled: Math.abs(reconciliationDifferenceInr) <= toleranceInr
  };
  const first = candles[startIndex];
  const last = candles[endIndex];
  const metrics: CandidateMetrics = {
    period: {
      startDate: first ? dateKey(first.time) : "",
      endDate: last ? dateKey(last.time) : ""
    },
    tradeCount: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? ROUND((wins / trades.length) * 100) : 0,
    profitFactor: profitFactor === null ? null : ROUND(profitFactor, 3),
    expectancyR: expectancyR === null ? null : ROUND(expectancyR, 3),
    totalReturnPct: ROUND((finalEquity / capital - 1) * 100),
    finalEquityInr: finalEquity,
    netProfitInr: netPnl,
    maxDrawdownPct: ROUND(maxDrawdownPct),
    totalCostsInr: ROUND(totalCosts),
    accounting
  };
  return { metrics, trades };
}

function exclusionReason(candles: Candle[], requestedStart: string, requestedEnd: string): string | null {
  if (candles.length < 205) return "Fewer than 205 completed daily candles; indicator warm-up and testing would be too short.";
  const first = dateKey(candles[0]!.time);
  const last = dateKey(candles.at(-1)!.time);
  const frontGap = daysBetween(first, requestedStart);
  const endGap = daysBetween(requestedEnd, last);
  const requestedDays = Math.max(1, daysBetween(requestedEnd, requestedStart));
  if (frontGap > 14 || frontGap < -7) return `History begins ${first}; requested start was ${requestedStart}.`;
  if (endGap > 7 || endGap < -7) return `Latest candle is ${last}; requested end was ${requestedEnd}.`;
  if (candles.length < requestedDays * 0.6) return `Only ${candles.length} candles for a ${requestedDays}-day request; coverage is too sparse.`;
  return null;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item !== undefined) output[index] = await worker(item);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function runMarketOpportunityScan(input: {
  years: number;
  capitalInr: number;
  riskPerTradeInr: number;
  costBpsPerSide: number;
  minimumTradesForRanking: number;
  universe: "all" | "stocks";
  strategy: "all" | StrategyId;
  direction: "both" | "long" | "short";
  timeframe: "daily";
}): Promise<OpportunityScanResponse> {
  const years = input.years === 3 ? 3 : 5;
  const capitalInr = Math.max(1, input.capitalInr);
  const riskPerTradeInr = Math.max(1, input.riskPerTradeInr);
  const costBpsPerSide = Math.max(0, Math.min(200, input.costBpsPerSide));
  const minimumTradesForRanking = Math.max(30, Math.min(500, Math.floor(input.minimumTradesForRanking || 30)));
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - years);
  const requestedStart = startDate.toISOString().slice(0, 10);
  const requestedEnd = endDate.toISOString().slice(0, 10);
  const startSeconds = Math.floor(startDate.getTime() / 1000);
  const endSeconds = Math.floor(endDate.getTime() / 1000);

  const requestedSymbols = input.universe === "stocks" ? UNIVERSE : UNIVERSE;
  const fetched = await mapWithConcurrency(requestedSymbols, 8, async (item) => {
    try {
      const candles = await fetchCandles(item.symbol, startSeconds, endSeconds);
      return { ...item, candles, error: null as string | null };
    } catch (error) {
      return {
        ...item,
        candles: [] as Candle[],
        error: error instanceof Error ? error.message : "Unknown market data error"
      };
    }
  });

  const warnings: string[] = [];
  const excludedSymbols: ExcludedSymbol[] = [];
  const complete: Array<{ symbol: string; name: string; candles: Candle[] }> = [];
  for (const item of fetched) {
    if (item.error) {
      excludedSymbols.push({ symbol: item.symbol, name: item.name, reason: item.error });
      warnings.push(item.symbol + ": " + item.error);
      continue;
    }
    const reason = exclusionReason(item.candles, requestedStart, requestedEnd);
    if (reason) {
      excludedSymbols.push({ symbol: item.symbol, name: item.name, reason });
      continue;
    }
    complete.push({ symbol: item.symbol, name: item.name, candles: [...item.candles].sort((a, b) => a.time - b.time) });
  }

  const coverageStatus = complete.length === requestedSymbols.length
    ? "PASS"
    : complete.length > 0 ? "LIMITED" : "FAIL";
  const strategies = input.strategy === "all" ? STRATEGIES : STRATEGIES.filter((item) => item.id === input.strategy);
  const directions: TradeDirection[] = input.direction === "both"
    ? ["LONG", "SHORT"]
    : input.direction === "long" ? ["LONG"] : ["SHORT"];
  const candidates: OpportunityCandidate[] = [];
  let evaluatedCombinations = 0;
  const rankingBasis = "Sorted by validation-period net expectancy in R per trade; tie-break by validation net return, then lower validation drawdown. The untouched final-test period is not used to sort.";

  for (const stock of complete) {
    const candles = stock.candles;
    const features = buildOpportunityFeatures(candles);
    const available = candles.length - WARMUP_BARS;
    const trainLength = Math.floor(available * 0.6);
    const validationLength = Math.floor(available * 0.2);
    const trainStart = WARMUP_BARS;
    const trainEnd = trainStart + trainLength - 1;
    const validationStart = trainEnd + 1;
    const validationEnd = validationStart + validationLength - 1;
    const finalStart = validationEnd + 1;
    const finalEnd = candles.length - 1;
    if (trainLength < 60 || validationLength < 30 || finalEnd - finalStart < 30) {
      excludedSymbols.push({ symbol: stock.symbol, name: stock.name, reason: "Not enough sessions remain after the warm-up and 60/20/20 data split." });
      continue;
    }

    const lastIndex = candles.length - 1;
    const currentFeature = features[lastIndex];
    const previousFeature = features[lastIndex - 1];
    for (const strategy of strategies) {
      for (const direction of directions) {
        evaluatedCombinations += 1;
        const common = {
          candles, features, strategy: strategy.id, direction,
          capitalInr, requestedRiskInr, costBpsPerSide
        };
        const inSample = simulateWindow({ ...common, startIndex: trainStart, endIndex: trainEnd }).metrics;
        const validation = simulateWindow({ ...common, startIndex: validationStart, endIndex: validationEnd }).metrics;
        const finalTest = simulateWindow({ ...common, startIndex: finalStart, endIndex: finalEnd }).metrics;
        if (
          inSample.tradeCount < minimumTradesForRanking ||
          validation.tradeCount < 10 ||
          finalTest.tradeCount < 10 ||
          !inSample.accounting.reconciled ||
          !validation.accounting.reconciled ||
          !finalTest.accounting.reconciled
        ) continue;

        const hasSignal = matchesOpportunitySignal(currentFeature, previousFeature, strategy.id, direction);
        const referenceDistance = currentFeature ? STOP_ATR * currentFeature.atr14 : null;
        const directionIsLong = direction === "LONG";
        candidates.push({
          rank: 0,
          symbol: stock.symbol,
          name: stock.name,
          strategy: strategy.id,
          strategyName: strategy.name,
          direction,
          currentSignal: hasSignal,
          signalDate: currentFeature?.date ?? dateKey(candles.at(-1)!.time),
          signalClose: currentFeature ? ROUND(currentFeature.close, 4) : null,
          referenceStop: currentFeature && referenceDistance !== null
            ? ROUND(directionIsLong ? currentFeature.close - referenceDistance : currentFeature.close + referenceDistance, 4)
            : null,
          referenceTarget: currentFeature && referenceDistance !== null
            ? ROUND(directionIsLong ? currentFeature.close + referenceDistance * TARGET_R : currentFeature.close - referenceDistance * TARGET_R, 4)
            : null,
          inSample,
          validation,
          finalTest,
          rankingBasis,
          executionStatus: directionIsLong ? "LONG_RESEARCH_ONLY" : "SHORT_THEORETICAL_ONLY",
          caveat: directionIsLong
            ? "Research result only; costs are configurable estimates, not a broker/exchange fee model. This is an independent single-instrument simulation, not a multi-position portfolio."
            : "The short side is a theoretical price-direction proxy. Stock borrow/availability, futures or options contracts, margin, roll/expiry, settlement and short-specific costs are not modeled; do not treat this row as an executable short trade."
        });
      }
    }
  }

  candidates.sort((left, right) =>
    (right.validation.expectancyR ?? -Infinity) - (left.validation.expectancyR ?? -Infinity) ||
    right.validation.totalReturnPct - left.validation.totalReturnPct ||
    left.validation.maxDrawdownPct - right.validation.maxDrawdownPct
  );
  candidates.forEach((candidate, index) => { candidate.rank = index + 1; });

  const coverageNotes: string[] = [];
  if (complete.length !== requestedSymbols.length) {
    coverageNotes.push(`Only ${complete.length} of ${requestedSymbols.length} requested stocks have sufficiently complete daily history for the full ${years}-year window. Only this validated subset was evaluated.`);
  }
  if (complete.length === 0) {
    coverageNotes.push("No stock has enough complete history for the requested window; ranking is blocked instead of silently shortening the period.");
  }
  if (candidates.length === 0 && complete.length > 0) {
    coverageNotes.push("No candidate met the pre-registered training, validation, final-test and accounting gates. No winner is fabricated.");
  }
  const limitations = [
    "The 'all supported instruments' universe currently means the 25 registered NSE stocks. Nifty 50 is not ranked as a tradable candidate, and broad/sector indices, futures and options require separate verified data adapters.",
    "Strategy thresholds are fixed in source and evaluated once; there is no parameter grid search. A 30-trade threshold is a minimum sample gate, not a guarantee of statistical significance.",
    "The validation period sorts candidates; the final-test period is kept out of ranking. After selecting a candidate from many comparisons, confirm it on a later untouched period before relying on it.",
    "Yahoo Finance chart data is unofficial. Missing corporate-action adjustments, dividends, market impact, exact fees/taxes and realistic fills can change results.",
    "Each symbol/strategy/direction is simulated independently with its own starting capital and one position at a time. Results are not a combined portfolio or a promise that all top-ranked rows can be held concurrently.",
    "Short candidates are theoretical underlying-price simulations. They are not execution-ready without a validated tradable instrument and its borrow, margin, expiry/roll and cost model."
  ];

  return {
    generatedAt: new Date().toISOString(),
    dataSource: "Yahoo Finance chart endpoint (unofficial; completed daily candles only)",
    config: {
      years,
      capitalInr,
      riskPerTradeInr: Math.min(riskPerTradeInr, capitalInr * 0.01),
      costBpsPerSide,
      minimumTradesForRanking,
      universe: input.universe,
      strategy: input.strategy,
      direction: input.direction,
      timeframe: "daily"
    },
    coverage: {
      status: coverageStatus,
      requestedPeriod: { startDate: requestedStart, endDate: requestedEnd },
      symbolsRequested: requestedSymbols.length,
      symbolsFetched: fetched.filter((item) => item.candles.length > 0).length,
      symbolsWithFullWindow: complete.length,
      excludedSymbols,
      notes: coverageNotes
    },
    split: { inSamplePct: 60, validationPct: 20, finalTestPct: 20, finalTestUsedForRanking: false },
    evaluatedCombinations,
    qualifiedCombinations: candidates.length,
    candidates,
    warnings,
    limitations
  };
}
