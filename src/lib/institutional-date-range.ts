export type ResolvedDealDateRange = { ok: true; fromIso: string; toIso: string; fromNse: string; toNse: string; days: number };
export type DealDateRangeError = { ok: false; error: string };
type DateRangeResult = ResolvedDealDateRange | DealDateRangeError;

function parseIsoDay(value: string): { iso: string; timestamp: number; nse: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day); const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { iso: value, timestamp, nse: String(day).padStart(2, "0") + "-" + String(month).padStart(2, "0") + "-" + String(year) };
}
function addIsoDays(value: string, delta: number): string {
  const parsed = parseIsoDay(value);
  return parsed ? new Date(parsed.timestamp + delta * 86_400_000).toISOString().slice(0, 10) : value;
}

/** Resolve optional ISO inputs to NSE's DD-MM-YYYY format, limiting explicit ranges to 365 days. */
export function resolveDealDateRange(fromValue: unknown, toValue: unknown, daysValue: unknown, todayIso: string): DateRangeResult {
  const today = parseIsoDay(todayIso);
  if (!today) return { ok: false, error: "The server could not resolve today's India-market date." };
  const fromRaw = typeof fromValue === "string" ? fromValue.trim() : "";
  const toRaw = typeof toValue === "string" ? toValue.trim() : "";
  let fromIso: string; let toIso: string;
  if (fromRaw || toRaw) {
    if (!fromRaw || !toRaw) return { ok: false, error: "Provide both a start date and an end date." };
    const start = parseIsoDay(fromRaw); const end = parseIsoDay(toRaw);
    if (!start || !end) return { ok: false, error: "Dates must be valid calendar dates in YYYY-MM-DD format." };
    if (start.timestamp > end.timestamp) return { ok: false, error: "The start date must be on or before the end date." };
    if (end.timestamp > today.timestamp) return { ok: false, error: "The end date cannot be in the future for India-market disclosures." };
    const span = Math.floor((end.timestamp - start.timestamp) / 86_400_000) + 1;
    if (span > 365) return { ok: false, error: "The selected date range cannot exceed 365 days." };
    fromIso = start.iso; toIso = end.iso;
  } else {
    const daysRaw = typeof daysValue === "string" || typeof daysValue === "number" ? Number(daysValue) : 30;
    const days = [7, 30, 60, 90].includes(daysRaw) ? daysRaw : 30;
    fromIso = addIsoDays(today.iso, -(days - 1)); toIso = today.iso;
  }
  const start = parseIsoDay(fromIso)!; const end = parseIsoDay(toIso)!;
  return { ok: true, fromIso, toIso, fromNse: start.nse, toNse: end.nse, days: Math.floor((end.timestamp - start.timestamp) / 86_400_000) + 1 };
}
