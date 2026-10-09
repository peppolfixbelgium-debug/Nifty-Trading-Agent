export const UPSTOX_UNDERLYINGS: Record<string, string> = {
  NIFTY50: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|Nifty MID Select",
  SENSEX: "BSE_INDEX|SENSEX"
};

export const UPSTOX_RELATIVE_EXPIRIES = new Set([
  "current_week", "next_week", "far_week", "current_month", "next_month", "far_month"
]);

export function resolveUpstoxUnderlying(value: string | undefined): { id: string; key: string } | null {
  const id = value || "NIFTY50";
  const key = UPSTOX_UNDERLYINGS[id];
  return key ? { id, key } : null;
}
