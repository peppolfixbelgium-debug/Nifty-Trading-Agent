export type StrategyId = "trend-following" | "breakout-volume" | "trend-pullback" | "mean-reversion";
export type TradeDirection = "LONG" | "SHORT";
export type ScannerUniverse = "all" | "stocks";
export type ScannerDirection = "both" | "long" | "short";
export type ScannerStrategy = "all" | StrategyId;

export type OpportunityScanConfig = {
  years: 3 | 5;
  capitalInr: number;
  riskPerTradeInr: number;
  costBpsPerSide: number;
  minimumTradesForRanking: number;
  universe: ScannerUniverse;
  strategy: ScannerStrategy;
  direction: ScannerDirection;
  timeframe: "daily";
};

export type CandidateMetrics = {
  period: { startDate: string; endDate: string };
  tradeCount: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number | null;
  expectancyR: number | null;
  totalReturnPct: number;
  finalEquityInr: number;
  netProfitInr: number;
  maxDrawdownPct: number;
  totalCostsInr: number;
  accounting: {
    closedTradeNetPnlInr: number;
    equityDerivedNetPnlInr: number;
    reconciliationDifferenceInr: number;
    toleranceInr: number;
    reconciled: boolean;
  };
};

export type OpportunityCandidate = {
  rank: number;
  symbol: string;
  name: string;
  strategy: StrategyId;
  strategyName: string;
  direction: TradeDirection;
  currentSignal: boolean;
  signalDate: string;
  signalClose: number | null;
  referenceStop: number | null;
  referenceTarget: number | null;
  inSample: CandidateMetrics;
  validation: CandidateMetrics;
  finalTest: CandidateMetrics;
  rankingBasis: string;
  executionStatus: "LONG_RESEARCH_ONLY" | "SHORT_THEORETICAL_ONLY";
  caveat: string;
};

export type ExcludedSymbol = {
  symbol: string;
  name: string;
  reason: string;
};

export type OpportunityScanResponse = {
  generatedAt: string;
  dataSource: string;
  config: OpportunityScanConfig;
  coverage: {
    status: "PASS" | "LIMITED" | "FAIL";
    requestedPeriod: { startDate: string; endDate: string };
    symbolsRequested: number;
    symbolsFetched: number;
    symbolsWithFullWindow: number;
    excludedSymbols: ExcludedSymbol[];
    notes: string[];
  };
  split: {
    inSamplePct: number;
    validationPct: number;
    finalTestPct: number;
    finalTestUsedForRanking: false;
  };
  evaluatedCombinations: number;
  qualifiedCombinations: number;
  candidates: OpportunityCandidate[];
  warnings: string[];
  limitations: string[];
};
