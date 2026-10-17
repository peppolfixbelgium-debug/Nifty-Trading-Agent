import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

type Row = Record<string, unknown>;
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expires: number; value: unknown }>();
const browserHeaders = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  referer: "https://www.nseindia.com/market-data/large-deals",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin"
};

function cookiesFrom(response: Response): string {
  const h = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof h.getSetCookie === "function" ? h.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  return values.map((item) => item.split(";")[0]).filter(Boolean).join("; ");
}
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function list(value: unknown): Row[] {
  if (Array.isArray(value)) return value.map(row);
  const data = row(value).data;
  return Array.isArray(data) ? data.map(row) : [];
}
function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replaceAll(",", "")) : NaN;
  return Number.isFinite(n) ? n : null;
}
function str(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}
function indiaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(date);
  const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return String(map.day) + "-" + String(map.month) + "-" + String(map.year);
}

async function fetchJson(url: URL, cookie: string): Promise<unknown> {
  const response = await fetch(url, { headers: { ...browserHeaders, cookie }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error("NSE disclosure endpoint returned HTTP " + response.status + ".");
  return response.json();
}
function mapDeal(input: Row, type: "BULK" | "BLOCK") {
  const name = str(input.BD_SYMBOL, input.symbol, input.SYMBOL, input.SYMBOL_NAME, input.SCRIP_CD);
  const client = str(input.BD_CLIENT_NAME, input.CLIENT_NAME, input.clientName, input.CLIENTNAME, input.BUYER_SELLER);
  const side = str(input.BD_BUY_SELL, input.BUY_SELL, input.buySell, input.TRANSACTION_TYPE, input.TRANSACTIONTYPE)?.toUpperCase() ?? "";
  const quantity = num(input.BD_QTY_TRD ?? input.QTY_TRD ?? input.quantity ?? input.TRADE_QUANTITY);
  const price = num(input.BD_TP_WATP ?? input.TRD_PRICE ?? input.PRICE ?? input.TRADE_PRICE);
  const date = str(input.BD_DT_DATE, input.BD_DT_ORDER, input.TRADE_DATE, input.DATE, input.date);
  return {
    type,
    symbol: name?.toUpperCase() ?? null,
    securityName: str(input.BD_SCRIP_NAME, input.SECURITY_NAME, input.companyName),
    clientName: client,
    side: side === "BUY" || side === "PURCHASE" ? "BUY" : side === "SELL" ? "SELL" : side || "UNKNOWN",
    quantity,
    price,
    notional: quantity !== null && price !== null ? quantity * price : null,
    date,
    remarks: str(input.BD_REMARKS, input.REMARKS),
    sourceUrl: "https://www.nseindia.com/market-data/large-deals"
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  const requested = typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase() : "ALL";
  const symbol = requested === "ALL" || requested === "" ? "ALL" : requested.replace(/\.NS$/, "");
  if (symbol !== "ALL" && !/^[A-Z0-9&^-]{1,18}$/.test(symbol)) {
    return res.status(400).json({ error: "Choose a stock ticker such as RELIANCE, HDFCBANK or M&M." });
  }
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  const cacheKey = "activity:" + symbol;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && cached.expires > Date.now()) {
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.status(200).json({ ...row(cached.value), cached: true });
  }

  const warnings: string[] = [];
  let cookie = "";
  try {
    const session = await fetch("https://www.nseindia.com/market-data/large-deals", {
      headers: browserHeaders, signal: AbortSignal.timeout(9000), redirect: "follow"
    });
    cookie = cookiesFrom(session);
    if (!session.ok || !cookie) throw new Error("NSE did not issue a usable public-data session.");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "NSE session could not be started.";
    res.setHeader("Cache-Control", "private, max-age=60");
    const now = new Date();
    return res.status(200).json({
      generatedAt: now.toISOString(), period: { from: indiaDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)), to: indiaDate(now), days: 30 },
      symbol, deals: [], shareholding: [],
      summary: { reportedDeals: 0, buyDeals: 0, sellDeals: 0, buyNotional: 0, sellNotional: 0, firstReportedBuysInWindow: 0 },
      warnings: [detail],
      sources: { deals: "https://www.nseindia.com/market-data/large-deals", shareholding: symbol === "ALL" ? "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern" : "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern?symbol=" + encodeURIComponent(symbol) },
      note: "No sample institutional activity is used. Retry when NSE's public disclosure endpoints are reachable."
    });
  }

  const today = new Date();
  const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const base = "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals";
  const makeDealsUrl = (type: "bulk_deals" | "block_deals") => {
    const url = new URL(base);
    url.searchParams.set("optionType", type);
    url.searchParams.set("from", indiaDate(from));
    url.searchParams.set("to", indiaDate(today));
    return url;
  };
  const shareholdingUrl = new URL("https://www.nseindia.com/api/corporate-share-holdings-master");
  shareholdingUrl.searchParams.set("index", "equities");
  if (symbol !== "ALL") shareholdingUrl.searchParams.set("symbol", symbol);

  const [bulkResult, blockResult, holdingsResult] = await Promise.allSettled([
    fetchJson(makeDealsUrl("bulk_deals"), cookie),
    fetchJson(makeDealsUrl("block_deals"), cookie),
    symbol === "ALL" ? Promise.resolve([]) : fetchJson(shareholdingUrl, cookie)
  ]);

  let deals: ReturnType<typeof mapDeal>[] = [];
  if (bulkResult.status === "fulfilled") deals.push(...list(bulkResult.value).map((item) => mapDeal(item, "BULK")));
  else warnings.push("Bulk-deal disclosures could not be loaded: " + (bulkResult.reason instanceof Error ? bulkResult.reason.message : "provider error"));
  if (blockResult.status === "fulfilled") deals.push(...list(blockResult.value).map((item) => mapDeal(item, "BLOCK")));
  else warnings.push("Block-deal disclosures could not be loaded: " + (blockResult.reason instanceof Error ? blockResult.reason.message : "provider error"));
  if (holdingsResult.status === "rejected") warnings.push("Quarterly shareholding pattern could not be loaded: " + (holdingsResult.reason instanceof Error ? holdingsResult.reason.message : "provider error"));

  deals = deals.filter((item) => item.symbol && item.clientName && (item.side === "BUY" || item.side === "SELL"))
    .filter((item) => symbol === "ALL" || item.symbol === symbol)
    .sort((a, b) => {
      const da = a.date ? Date.parse(a.date) : 0;
      const db = b.date ? Date.parse(b.date) : 0;
      return db - da;
    }).slice(0, 100);

  const holdings = holdingsResult.status === "fulfilled" ? list(holdingsResult.value).map((item) => ({
    symbol: str(item.symbol)?.toUpperCase() ?? symbol,
    companyName: str(item.name, item.companyName),
    asOf: str(item.date),
    submittedAt: str(item.submissionDate, item.submissionDateTime),
    promoterPct: num(item.pr_and_prgrp),
    publicPct: num(item.public_val),
    employeeTrustPct: num(item.employeeTrusts),
    filingUrl: str(item.xbrl) ?? "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern"
  })).filter((item) => item.asOf !== null).slice(0, 8) : [];

  const firstBuys = new Set<string>();
  const dealRows = deals.map((deal) => {
    const key = (deal.symbol ?? "") + "|" + (deal.clientName ?? "").toUpperCase();
    const newBuy = deal.side === "BUY" && !firstBuys.has(key);
    if (deal.side === "BUY") firstBuys.add(key);
    return { ...deal, firstReportedBuyInWindow: newBuy };
  });
  const output = {
    generatedAt: new Date().toISOString(),
    period: { from: indiaDate(from), to: indiaDate(today), days: 30 },
    symbol,
    deals: dealRows,
    shareholding: holdings,
    summary: {
      reportedDeals: dealRows.length,
      buyDeals: dealRows.filter((item) => item.side === "BUY").length,
      sellDeals: dealRows.filter((item) => item.side === "SELL").length,
      buyNotional: dealRows.filter((item) => item.side === "BUY").reduce((sum, item) => sum + (item.notional ?? 0), 0),
      sellNotional: dealRows.filter((item) => item.side === "SELL").reduce((sum, item) => sum + (item.notional ?? 0), 0),
      firstReportedBuysInWindow: dealRows.filter((item) => item.firstReportedBuyInWindow).length
    },
    warnings,
    sources: {
      deals: "https://www.nseindia.com/market-data/large-deals",
      shareholding: symbol === "ALL" ? "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern" : "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern?symbol=" + encodeURIComponent(symbol)
    },
    note: "A bulk/block deal is a reported transaction, not proof of a long-term portfolio entry or overall institutional conviction. The 'first reported buy' flag means first BUY print observed for that client/stock in this 30-day feed window, not a confirmed new holding. Quarterly promoter/public percentages are not a substitute for detailed FII/DII category holdings."
  };
  cache.set(cacheKey, { expires: Date.now() + TTL_MS, value: output });
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).json(output);
}
