export type MetricAssessment = "GOOD" | "NEUTRAL" | "WEAK" | "UNAVAILABLE";
export type InvestmentStance = "BUY" | "HOLD" | "WAIT" | "SELL";
export type EntryAssessment = "IN_ZONE" | "WAIT_PULLBACK" | "TREND_DAMAGED" | "NO_DATA";

export type LongTermMetric = {
  id: string;
  label: string;
  display: string;
  assessment: MetricAssessment;
  reason: string;
  value: number | null;
  weight: number;
};

export type BrokerRating = {
  firm: string;
  date: string | null;
  action: string;
  fromGrade: string | null;
  toGrade: string | null;
};

export type LongTermResearchResponse = {
  symbol: string;
  name: string;
  sector: string | null;
  currency: string;
  generatedAt: string;
  price: number | null;
  marketCap: number | null;
  analystConsensus: string | null;
  analystTarget: number | null;
  analystTargetUpsidePct: number | null;
  recommendationCounts: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
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
    dataAsOf: string | null;
  };
  brokerRatings: BrokerRating[];
  sources: Array<{ label: string; url: string }>;
  warnings: string[];
};

export type InstitutionalDeal = {
  id: string;
  date: string | null;
  symbol: string;
  company: string;
  client: string;
  side: "BUY" | "SELL" | "UNKNOWN";
  quantity: number | null;
  price: number | null;
  valueCrore: number | null;
  dealType: "BULK" | "BLOCK";
  institutionLike: boolean;
};

export type OwnershipChange = {
  name: string;
  reportDate: string | null;
  shares: number | null;
  value: number | null;
  pctHeld: number | null;
  sharesChange: number | null;
  pctChange: number | null;
  direction: "INCREASED" | "REDUCED" | "UNCHANGED" | "UNKNOWN";
};

export type PromoterHoldingSnapshot = {
  date: string;
  submissionDate: string | null;
  promoterPct: number | null;
  publicPct: number | null;
};

export type InstitutionalActivityResponse = {
  generatedAt: string;
  symbol: string;
  deals: InstitutionalDeal[];
  institutions: OwnershipChange[];
  promoterSnapshots: PromoterHoldingSnapshot[];
  sources: Array<{ label: string; url: string }>;
  warnings: string[];
};
