export type MarketRegime = "BULLISH" | "MIXED" | "BEARISH" | "UNAVAILABLE";
export type ScanAction = "TRIGGERED" | "WATCH" | "AVOID" | "INSUFFICIENT_DATA" | "ERROR";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type MarketSummary = {
  ticker: string;
  lastPrice: number | null;
  changePct: number | null;
  sma50: number | null;
  sma200: number | null;
  regime: MarketRegime;
  vix: number | null;
  vixLabel: "NORMAL" | "ELEVATED" | "HIGH" | "UNAVAILABLE";
};

export type ScanResult = {
  symbol: string;
  name: string;
  action: ScanAction;
  reason: string;
  lastPrice: number | null;
  changePct: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  atr14: number | null;
  relativeVolume: number | null;
  trigger: number | null;
  stop: number | null;
  target: number | null;
  riskReward: number | null;
  quantity: number;
  positionValueInr: number;
  riskBudgetInr: number;
};

export type ScanResponse = {
  generatedAt: string;
  cached: boolean;
  dataSource: string;
  market: MarketSummary;
  params: {
    capitalInr: number;
    requestedRiskInr: number;
    effectiveRiskInr: number;
    maxPositionPct: number;
    maxRiskPct: number;
  };
  results: ScanResult[];
  warnings: string[];
};
