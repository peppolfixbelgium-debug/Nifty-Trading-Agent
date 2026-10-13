import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

type RecordRow = Record<string, unknown>;
type Deal = {
  date: string | null;
  symbol: string;
  company: string;
  clientName: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  valueCrore: number;
  dealType: "BULK" | "BLOCK";
};
type Flow = { category: string; date: string | null; buyCrore: number | null; sellCrore: number | null; netCrore: number | null };
type ShareholdingRow = { symbol: string; name: string; date: string; promoterPct: number | null; publicPct: number | null; submissionDate: string | null; filingUrl: string | null };

const sources = {
  deals: "https://www.nseindia.com/report-detail/display-bulk-and-block-deals",
  shareholding: "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern",
  fiiDii: "https://www.nseindia.com/reports/fii-dii"
};
const baseHeaders = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-GB,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  referer: "https://www.nseindia.com/"
};
let cache: { key: string; until: number; payload: Record<string, unknown> } | null = null;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,\s₹]/g, "").trim();
  return cleaned && Number.isFinite(Number(cleaned)) ? Number(cleaned) : null;
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? fallback : String(value).trim();
}
function first(row: RecordRow, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  const normalized = Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value] as const);
  for (const key of keys) {
    const wanted = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const found = normalized.find(([name]) => name === wanted);
    if (found && found[1] !== null && found[1] !== undefined && found[1] !== "") return found[1];
  }
  return null;
}
function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const dmy = /^(\d{2})-([A-Z]{3})-(\d{4})$/i.exec(raw);
  if (dmy) {
    const months: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
    const month = months[dmy[2]!.toUpperCase()];
    return month ? dmy[3] + "-" + month + "-" + dmy[1] : null;
  }
  const numeric = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (numeric) return numeric[3] + "-" + numeric[2] + "-" + numeric[1];
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}
function dateForNse(value: Date): string {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return day + "-" + month + "-" + value.getFullYear();
}
function parseDeals(payload: unknown, kind: "BULK" | "BLOCK"): Deal[] {
  let rows: unknown[] = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === "object") {
    const obj = payload as RecordRow;
    if (Array.isArray(obj.data)) rows = obj.data;
    else if (Array.isArray(obj.records)) rows = obj.records;
  }
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as RecordRow;
    const symbol = text(first(row, ["BD_SYMBOL", "symbol", "SYMBOL"])).toUpperCase();
    const clientName = text(first(row, ["BD_CLIENT_NAME", "clientName", "client_name", "CLIENT_NAME"]));
    const quantity = asNumber(first(row, ["BD_QTY_TRD", "quantity", "quantityTraded", "qtyTraded", "QTY_TRD"]));
    const price = asNumber(first(row, ["BD_TP_WATP", "price", "tradePrice", "weightedAveragePrice", "TP_WATP"]));
    const rawSide = text(first(row, ["BD_BUY_SELL", "buySell", "buy_sell", "side", "BUY_SELL"])).toUpperCase();
    if (!symbol || !clientName || quantity === null || price === null || quantity <= 0 || price <= 0 || !rawSide) return [];
    const side = rawSide.includes("BUY") || rawSide === "B" ? "BUY" : rawSide.includes("SELL") || rawSide === "S" ? "SELL" : null;
    if (!side) return [];
    return [{
      date: isoDate(first(row, ["BD_DT_DATE", "date", "tradeDate", "trade_date", "DT_DATE"])),
      symbol,
      company: text(first(row, ["BD_SCRIP_NAME", "company", "securityName", "scripName"]), symbol),
      clientName,
      side,
      quantity,
      price,
      valueCrore: quantity * price / 10000000,
      dealType: kind
    }];
  });
}
function parseFlows(payload: unknown): Flow[] {
  const rows = Array.isArray(payload) ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as RecordRow).data) ? (payload as { data: unknown[] }).data : [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as RecordRow;
    const category = text(first(row, ["category", "CATEGORY", "investorType"]));
    if (!category) return [];
    return [{
      category,
      date: isoDate(first(row, ["date", "DATE", "tradeDate"])),
      buyCrore: asNumber(first(row, ["buyValue", "buy_value", "BUY_VALUE"])),
      sellCrore: asNumber(first(row, ["sellValue", "sell_value", "SELL_VALUE"])),
      netCrore: asNumber(first(row, ["netValue", "net_value", "NET_VALUE"]))
    }];
  });
}
async function getNseCookies(): Promise<string> {
  const response = await fetch("https://www.nseindia.com/", { headers: baseHeaders, signal: AbortSignal.timeout(7000) });
  const cookieHeader = response.headers.get("set-cookie") ?? "";
  return cookieHeader
    .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
    .map((part) => part.trim().split(";")[0])
    .filter((part) => part.includes("="))
    .join("; ");
}
async function nseJson(url: string, cookie: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { ...baseHeaders, ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("NSE returned HTTP " + response.status + ".");
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    const raw = await response.text();
    try { return JSON.parse(raw); } catch { throw new Error("NSE returned a non-JSON response. Its public endpoint may be throttling requests."); }
  }
  return response.json();
}
function latestQuarterRows(payload: unknown): ShareholdingRow[] {
  const rows = Array.isArray(payload) ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as RecordRow).data) ? (payload as { data: unknown[] }).data : [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as RecordRow;
    const symbol = text(first(row, ["symbol", "SYMBOL"])).toUpperCase();
    const date = isoDate(first(row, ["date", "asOnDate", "as_on_date"])) ?? text(first(row, ["date", "asOnDate", "as_on_date"]));
    if (!symbol || !date) return [];
    const filingUrl = text(first(row, ["xbrl", "xbrlFileLink", "xbrl_file_link"]));
    return [{
      symbol,
      name: text(first(row, ["name", "companyName", "company_name"]), symbol),
      date,
      promoterPct: asNumber(first(row, ["pr_and_prgrp", "promoterHolding", "promoter_percentage"])),
      publicPct: asNumber(first(row, ["public_val", "publicHolding", "public_percentage"])),
      submissionDate: isoDate(first(row, ["submissionDate", "submission_date"])) ?? (text(first(row, ["submissionDate", "submission_date"])) || null),
      filingUrl: /^https:\/\/nsearchives\.nseindia\.com\//i.test(filingUrl) ? filingUrl : null
    }];
  }).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
function summarizeFlows(flows: Flow[]) {
  const latestDate = flows.reduce<string | null>((latest, row) => row.date && (!latest || row.date > latest) ? row.date : latest, null);
  return latestDate ? flows.filter((row) => row.date === latestDate) : flows.slice(0, 4);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const daysRaw = typeof req.query.days === "string" ? Number(req.query.days) : 30;
  const days = [7, 30, 60, 90].includes(daysRaw) ? daysRaw : 30;
  const rawSymbol = typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase().replace(/\.NS$/, "") : "";
  if (rawSymbol && !/^[A-Z0-9&-]{1,20}$/.test(rawSymbol)) {
    return res.status(400).json({ error: "Enter a valid NSE symbol, for example RELIANCE." });
  }
  const cacheKey = String(days) + ":" + rawSymbol;
  if (cache && cache.key === cacheKey && cache.until > Date.now()) {
    res.setHeader("Cache-Control", "public, s-maxage=180, stale-while-revalidate=300");
    return res.status(200).json({ ...cache.payload, cached: true });
  }

  try {
    const cookie = await getNseCookies();
    const today = new Date();
    const from = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const fromText = dateForNse(from);
    const toText = dateForNse(today);
    const bulkUrl = new URL("https://www.nseindia.com/api/historicalOR/bulk-block-short-deals");
    bulkUrl.searchParams.set("optionType", "bulk_deals");
    bulkUrl.searchParams.set("from", fromText);
    bulkUrl.searchParams.set("to", toText);
    const blockUrl = new URL("https://www.nseindia.com/api/historicalOR/bulk-block-short-deals");
    blockUrl.searchParams.set("optionType", "block_deals");
    blockUrl.searchParams.set("from", fromText);
    blockUrl.searchParams.set("to", toText);

    const outcomes = await Promise.allSettled([
      nseJson(bulkUrl.toString(), cookie),
      nseJson(blockUrl.toString(), cookie),
      nseJson("https://www.nseindia.com/api/fiidiiTradeReact", cookie),
      rawSymbol ? nseJson("https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol=" + encodeURIComponent(rawSymbol), cookie) : Promise.resolve(null)
    ]);
    const warnings: string[] = [];
    const bulk = outcomes[0]?.status === "fulfilled" ? parseDeals(outcomes[0].value, "BULK") : [];
    const block = outcomes[1]?.status === "fulfilled" ? parseDeals(outcomes[1].value, "BLOCK") : [];
    const flows = outcomes[2]?.status === "fulfilled" ? parseFlows(outcomes[2].value) : [];
    const holdings = outcomes[3]?.status === "fulfilled" && outcomes[3].value !== null ? latestQuarterRows(outcomes[3].value) : [];
    if (outcomes[0]?.status === "rejected") warnings.push("Bulk-deal data is temporarily unavailable from NSE.");
    if (outcomes[1]?.status === "rejected") warnings.push("Block-deal data is temporarily unavailable from NSE.");
    if (outcomes[2]?.status === "rejected" || !flows.length) warnings.push("Daily FII/FPI-DII net-flow data is temporarily unavailable from NSE.");
    if (rawSymbol && (outcomes[3]?.status === "rejected" || !holdings.length)) warnings.push("Quarterly ownership data is temporarily unavailable for " + rawSymbol + ".");
    const deals = [...bulk, ...block].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.valueCrore - a.valueCrore);
    if (!deals.length && !flows.length && !holdings.length) {
      const firstError = outcomes.find((outcome) => outcome.status === "rejected");
      throw new Error(firstError && firstError.status === "rejected" && firstError.reason instanceof Error
        ? firstError.reason.message
        : "NSE returned no rows for the selected range.");
    }

    const groups = new Map<string, { symbol: string; company: string; clientName: string; buys: number; sells: number; firstBuyDate: string | null; firstSellDate: string | null; count: number }>();
    for (const deal of deals) {
      const key = deal.symbol + "|" + deal.clientName.toLowerCase();
      const current = groups.get(key) ?? { symbol: deal.symbol, company: deal.company, clientName: deal.clientName, buys: 0, sells: 0, firstBuyDate: null, firstSellDate: null, count: 0 };
      if (deal.side === "BUY") {
        current.buys += deal.valueCrore;
        if (!current.firstBuyDate || (deal.date && deal.date < current.firstBuyDate)) current.firstBuyDate = deal.date;
      } else {
        current.sells += deal.valueCrore;
        if (!current.firstSellDate || (deal.date && deal.date < current.firstSellDate)) current.firstSellDate = deal.date;
      }
      current.count += 1;
      groups.set(key, current);
    }
    const entityMoves = [...groups.values()].map((group) => ({
      ...group,
      netBuyCrore: group.buys - group.sells,
      observedDirection: group.buys > group.sells ? "NET BUYING" : group.sells > group.buys ? "NET SELLING" : "MIXED",
      firstBuyObservedInWindow: !!group.firstBuyDate && group.firstBuyDate === deals
        .filter((deal) => deal.symbol === group.symbol && deal.clientName.toLowerCase() === group.clientName.toLowerCase() && deal.side === "BUY")
        .map((deal) => deal.date).filter((date): date is string => !!date).sort()[0]
    })).sort((a, b) => Math.abs(b.netBuyCrore) - Math.abs(a.netBuyCrore)).slice(0, 60);

    const shareholding = holdings.slice(0, 4).map((row, index) => {
      const previous = holdings[index + 1];
      return {
        ...row,
        promoterChangePp: previous && row.promoterPct !== null && previous.promoterPct !== null ? row.promoterPct - previous.promoterPct : null,
        publicChangePp: previous && row.publicPct !== null && previous.publicPct !== null ? row.publicPct - previous.publicPct : null,
        previousDate: previous?.date ?? null,
        previousFilingUrl: previous?.filingUrl ?? null
      };
    });

    const payload = {
      ownershipSymbol: rawSymbol || null,
      generatedAt: new Date().toISOString(),
      cached: false,
      rangeDays: days,
      dateRange: { from: fromText, to: toText },
      source: "Official NSE India public disclosure APIs",
      sources,
      deals,
      entityMoves,
      flows: summarizeFlows(flows),
      shareholding,
      warnings,
      notes: [
        "Bulk/block deals disclose large transactions; they do not show a client's complete portfolio or prove a first-ever position.",
        "A first buy observed in this date window is not proof of a fresh holding. Quarterly disclosures and official filings should be checked for confirmation.",
        "FII/FPI and DII daily net-flow figures are market-wide flows, not stock-specific purchases."
      ]
    };
    cache = { key: cacheKey, until: Date.now() + 180000, payload };
    res.setHeader("Cache-Control", "public, s-maxage=180, stale-while-revalidate=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({
      error: "Institutional activity could not be loaded from NSE.",
      detail: error instanceof Error ? error.message : "Unknown NSE error",
      hint: "NSE can throttle public-data endpoints. Retry later, or use the official source links to inspect the disclosures directly.",
      sources
    });
  }
}
