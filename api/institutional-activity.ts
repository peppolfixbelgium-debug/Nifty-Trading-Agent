import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import type { InstitutionalActivityResponse, InstitutionalDeal, OwnershipChange, PromoterHoldingSnapshot } from "../src/lib/long-term-types.js";
import { asArray, asRecord, getYahooQuoteSummary, normalizeNseYahooSymbol, numeric, textValue, type DataRecord } from "../src/lib/yahoo-free-data.js";

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  referer: "https://www.nseindia.com/"
};
let nseCookieCache: { cookie: string; expiresAt: number } | null = null;

function recordNumber(row: DataRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    const parsed = numeric(typeof value === "string" ? value.replaceAll(",", "").trim() : value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function recordText(row: DataRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    const parsed = textValue(value);
    if (parsed) return parsed;
  }
  return null;
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findKey(row: DataRecord, candidates: string[]): unknown {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const exact = entries.find(([key]) => normalizedKey(key) === normalizedKey(candidate));
    if (exact) return exact[1];
  }
  return undefined;
}

function fieldNumber(row: DataRecord, ...keys: string[]): number | null {
  return recordNumber(Object.fromEntries(keys.map(key => [key, findKey(row, [key])])), ...keys);
}

function fieldText(row: DataRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = findKey(row, [key]);
    const parsed = textValue(value);
    if (parsed) return parsed;
  }
  return null;
}

function cookieParts(response: Response): string[] {
  const extended = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return values.flatMap(value => value.split(/,(?=[^;,]+=)/)).map(value => value.split(";")[0]?.trim() ?? "").filter(Boolean);
}

async function getNseCookies(): Promise<string> {
  if (nseCookieCache && nseCookieCache.expiresAt > Date.now()) return nseCookieCache.cookie;
  const response = await fetch("https://www.nseindia.com/", { headers, signal: AbortSignal.timeout(10_000), redirect: "follow" });
  const cookies = cookieParts(response);
  if (!cookies.length) throw new Error("NSE public site did not issue a session cookie; the exchange may be rate-limiting automated requests.");
  const cookie = [...new Set(cookies)].join("; ");
  nseCookieCache = { cookie, expiresAt: Date.now() + 10 * 60_000 };
  return cookie;
}

async function fetchNseJson(path: string): Promise<unknown> {
  const cookie = await getNseCookies();
  const response = await fetch("https://www.nseindia.com/api/" + path, {
    headers: { ...headers, cookie, accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error("NSE public disclosure endpoint returned HTTP " + response.status + ".");
  const body = await response.text();
  if (!body.trim().startsWith("{") && !body.trim().startsWith("[")) throw new Error("NSE returned a non-JSON response; the disclosure page may require browser verification.");
  return JSON.parse(body) as unknown;
}

function indiaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return String(values.year) + "-" + String(values.month) + "-" + String(values.day);
}

function offsetDate(dateText: string, days: number): string {
  const date = new Date(dateText + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nseDate(dateText: string): string {
  const [year, month, day] = dateText.split("-");
  return [day, month, year].join("-");
}

function extractRows(payload: unknown): DataRecord[] {
  const root = asRecord(payload);
  for (const key of ["data", "rows", "bulkDealData", "blockDealData", "shareholding", "shareholdingData"]) {
    const value = root[key];
    if (Array.isArray(value)) return value.map(asRecord);
  }
  if (Array.isArray(payload)) return payload.map(asRecord);
  return [];
}

const institutionalPattern = /mutual fund|asset management|insurance|investment|investments|capital|fund|pension|trust|bank|life limited|life insurance|lic\b|hdfc|sbi|icici|kotak|nippon|uti\b|mirae|motilal|aditya birla|franklin|vanguard|blackrock|goldman|morgan stanley|jpmorgan|citadel|government|provident fund|treasury|amc\b|axis/i;

function normalizeDeal(row: DataRecord, dealType: "BULK" | "BLOCK", index: number): InstitutionalDeal | null {
  const symbol = (fieldText(row, "symbol", "ticker", "symbolName") ?? "").toUpperCase();
  const client = fieldText(row, "clientName", "client_name", "client", "investorName", "nameOfClient") ?? "Client not specified";
  const company = fieldText(row, "companyName", "company", "securityName", "security") ?? symbol;
  const rawSide = (fieldText(row, "buySell", "buy_sell", "buyOrSell", "transactionType", "side") ?? "").toUpperCase();
  const side: InstitutionalDeal["side"] = rawSide.includes("BUY") || rawSide === "B" ? "BUY" : rawSide.includes("SELL") || rawSide === "S" ? "SELL" : "UNKNOWN";
  const quantity = fieldNumber(row, "quantityTraded", "qtyTrd", "quantity", "shares", "qty");
  const price = fieldNumber(row, "watp", "weightedAveragePrice", "weightedAvgPrice", "price", "averagePrice", "tradePrice");
  const rawDate = fieldText(row, "date", "bdDt", "dealDate", "tradeDate", "broadcastDate");
  if (!symbol || quantity === null || price === null) return null;
  const valueCrore = quantity > 0 && price > 0 ? quantity * price / 10_000_000 : null;
  const id = [dealType, rawDate ?? "", symbol, client, side, quantity, index].join("-");
  return {
    id, date: rawDate, symbol, company, client, side, quantity, price, valueCrore, dealType,
    institutionLike: institutionalPattern.test(client)
  };
}

function toDateText(value: unknown): string | null {
  const text = typeof value === "string" ? value : null;
  if (text) return text;
  const seconds = numeric(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString().slice(0, 10);
}

function institutionChanges(summary: DataRecord): OwnershipChange[] {
  const ownership = asRecord(summary.institutionOwnership);
  const funds = asRecord(summary.fundOwnership);
  const rows = [
    ...asArray(ownership.ownershipList).map(asRecord),
    ...asArray(funds.ownershipList).map(asRecord)
  ];
  const byName = new Map<string, OwnershipChange>();
  for (const row of rows) {
    const name = recordText(row, "organization", "holder", "name") ?? "Institution not identified";
    const shares = recordNumber(row, "shares");
    const change = recordNumber(row, "sharesChange");
    const pctChange = recordNumber(row, "pctChange");
    const direction: OwnershipChange["direction"] = change !== null ? change > 0 ? "INCREASED" : change < 0 ? "REDUCED" : "UNCHANGED" : pctChange !== null ? pctChange > 0 ? "INCREASED" : pctChange < 0 ? "REDUCED" : "UNCHANGED" : "UNKNOWN";
    const item = {
      name,
      reportDate: toDateText(row.reportDate),
      shares,
      value: recordNumber(row, "value"),
      pctHeld: (() => { const value = recordNumber(row, "pctHeld"); return value === null ? null : value * 100; })(),
      sharesChange: change,
      pctChange: pctChange === null ? null : (Math.abs(pctChange) <= 1 ? pctChange * 100 : pctChange),
      direction
    };
    const existing = byName.get(name);
    if (!existing || (item.reportDate ?? "") > (existing.reportDate ?? "")) byName.set(name, item);
  }
  return [...byName.values()].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 20);
}

function promoterSnapshots(payload: unknown): PromoterHoldingSnapshot[] {
  return extractRows(payload).map(row => {
    const promoterRaw = recordNumber(row, "pr_and_prgrp", "prAndPrgrp", "promoterHolding", "promoter");
    const publicRaw = recordNumber(row, "public_val", "publicVal", "publicHolding", "public");
    const asOf = recordText(row, "date", "asOnDate", "as_on_date");
    const submission = recordText(row, "submissionDate", "submission_date", "broadcastDate");
    return {
      date: asOf ?? "Date not supplied",
      submissionDate: submission,
      promoterPct: promoterRaw,
      publicPct: publicRaw
    };
  }).filter(row => row.promoterPct !== null || row.publicPct !== null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);
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
  const nseSymbol = symbol.replace(/\.NS$/, "");
  const today = indiaDate(new Date());
  const from = nseDate(offsetDate(today, -30));
  const to = nseDate(today);
  const warnings: string[] = [];
  const sources = [
    { label: "NSE disclosed bulk/block deals", url: "https://www.nseindia.com/market-data/large-deals" },
    { label: "NSE shareholding-pattern filings", url: "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern" },
    { label: "Yahoo Finance institutional holders (unofficial public endpoint)", url: "https://finance.yahoo.com/quote/" + encodeURIComponent(symbol) + "/holders/" }
  ];

  const [bulkResult, blockResult, holdingResult, summaryResult] = await Promise.allSettled([
    fetchNseJson("historicalOR/bulk-block-short-deals?optionType=bulk_deals&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)),
    fetchNseJson("historicalOR/bulk-block-short-deals?optionType=block_deals&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)),
    fetchNseJson("corporate-share-holdings-master?index=equities&symbol=" + encodeURIComponent(nseSymbol)),
    getYahooQuoteSummary(symbol)
  ]);

  if (bulkResult.status === "rejected") warnings.push("NSE bulk-deal feed unavailable: " + (bulkResult.reason instanceof Error ? bulkResult.reason.message : "unknown error"));
  if (blockResult.status === "rejected") warnings.push("NSE block-deal feed unavailable: " + (blockResult.reason instanceof Error ? blockResult.reason.message : "unknown error"));
  if (holdingResult.status === "rejected") warnings.push("NSE shareholding snapshots unavailable: " + (holdingResult.reason instanceof Error ? holdingResult.reason.message : "unknown error"));
  if (summaryResult.status === "rejected" || (summaryResult.status === "fulfilled" && summaryResult.value.warning)) {
    const warning = summaryResult.status === "rejected" ? summaryResult.reason : summaryResult.value.warning;
    warnings.push("Named institutional ownership is unavailable from the free public source: " + (warning instanceof Error ? warning.message : String(warning)));
  }

  const bulkRows = bulkResult.status === "fulfilled" ? extractRows(bulkResult.value) : [];
  const blockRows = blockResult.status === "fulfilled" ? extractRows(blockResult.value) : [];
  const deals = [
    ...bulkRows.map((row, index) => normalizeDeal(row, "BULK", index)),
    ...blockRows.map((row, index) => normalizeDeal(row, "BLOCK", index))
  ].filter((deal): deal is InstitutionalDeal => deal !== null)
    .filter(deal => deal.valueCrore !== null && deal.valueCrore >= 1)
    .sort((a, b) => (b.valueCrore ?? 0) - (a.valueCrore ?? 0))
    .slice(0, 100);

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value.summary : null;
  const institutions = summary ? institutionChanges(summary) : [];
  const shareholding = holdingResult.status === "fulfilled" ? promoterSnapshots(holdingResult.value) : [];
  if (!deals.length && !warnings.some(warning => warning.includes("deal feed unavailable"))) {
    warnings.push("No bulk/block deals worth ₹1 crore or more were returned for the recent 30-day window. That is not proof that institutions did not trade.");
  }
  if (!institutions.length) warnings.push("No named holder changes with comparable change fields were returned. The app will not infer a fresh entry from a position list alone.");
  if (shareholding.length < 2) warnings.push("A quarter-over-quarter promoter trend needs at least two comparable shareholding disclosures.");

  const response: InstitutionalActivityResponse = {
    generatedAt: new Date().toISOString(),
    symbol,
    deals,
    institutions,
    promoterSnapshots: shareholding,
    sources,
    warnings
  };
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).json(response);
}
