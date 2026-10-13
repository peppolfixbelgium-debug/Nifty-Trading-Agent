export type EntryStatus = "IN_ZONE" | "WAIT_PULLBACK" | "TREND_DAMAGED" | "NO_DATA";
export type LongTermEntryPlan = {
  status: EntryStatus;
  low: number | null;
  high: number | null;
  distanceFrom200Pct: number | null;
  message: string;
};

export function planLongTermEntry(price: number | null, sma50: number | null, sma200: number | null, rsi14: number | null): LongTermEntryPlan {
  const distanceFrom200Pct = price !== null && sma200 !== null && sma200 > 0 ? (price / sma200 - 1) * 100 : null;
  const hasCoreData = [price, sma50, sma200].every(value => value !== null && Number.isFinite(value) && value > 0);
  if (!hasCoreData) {
    return {
      status: "NO_DATA", low: null, high: null, distanceFrom200Pct,
      message: "Not enough completed daily price history to estimate a long-term entry zone. No entry level is shown until the data is available."
    };
  }
  const current = price as number;
  const ma50 = sma50 as number;
  const ma200 = sma200 as number;
  if (current < ma200) {
    return {
      status: "TREND_DAMAGED", low: ma200 * 0.95, high: ma200,
      distanceFrom200Pct,
      message: "Price is below its 200-day average. Treat the band as a recovery watch level, not a buy order; wait for a sustained reclaim and re-check fundamentals."
    };
  }
  if ((rsi14 !== null && rsi14 >= 70) || (distanceFrom200Pct ?? 0) > 10) {
    return {
      status: "WAIT_PULLBACK", low: ma50 * 0.95, high: ma50 * 1.02,
      distanceFrom200Pct,
      message: "Price is extended relative to the long-term trend or momentum is hot. Avoid chasing; monitor the 50-day area for a pullback while the business thesis remains intact."
    };
  }
  if (rsi14 !== null && rsi14 < 35) {
    return {
      status: "WAIT_PULLBACK", low: ma200 * 0.95, high: ma50,
      distanceFrom200Pct,
      message: "Momentum is weak. Do not assume a lower price is value; wait for stabilisation and investigate why the stock is under pressure."
    };
  }
  if ((distanceFrom200Pct ?? 0) >= -3 && (distanceFrom200Pct ?? 0) <= 5 && (rsi14 === null || (rsi14 >= 40 && rsi14 <= 68))) {
    return {
      status: "IN_ZONE", low: ma200 * 0.97, high: ma200 * 1.05,
      distanceFrom200Pct,
      message: "Price is near its 200-day trend without an extreme reading. This is a candidate accumulation band for staged entries only if valuation, business quality and the latest filings support the thesis."
    };
  }
  return {
    status: "WAIT_PULLBACK", low: ma50 * 0.95, high: ma50 * 1.02,
    distanceFrom200Pct,
    message: "The long-term trend is not clearly broken, but current price does not meet the preferred entry conditions. Watch the 50-day area rather than chasing."
  };
}
