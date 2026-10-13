import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

type SearchItem = { symbol?: string; shortname?: string; longname?: string; exchDisp?: string; exchange?: string; quoteType?: string; typeDisp?: string };
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed. Use GET." }); }
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  if (q.length < 2) return res.status(200).json({ query:q, results:[] });
  try {
    const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
    url.searchParams.set("q", q);
    url.searchParams.set("quotesCount", "12");
    url.searchParams.set("newsCount", "0");
    url.searchParams.set("listsCount", "0");
    const response = await fetch(url, { headers:{ accept:"application/json", "user-agent":"Mozilla/5.0 (compatible; LongTermResearch/1.0)" }, signal:AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Free stock search returned HTTP " + response.status + ".");
    const payload = await response.json() as { quotes?: SearchItem[] };
    const results = (payload.quotes ?? []).filter(item =>
      item.quoteType === "EQUITY" && typeof item.symbol === "string" &&
      /\.(NS|BO)$/.test(item.symbol) &&
      /NSE|BSE|India|NSI|BOM/i.test([item.exchange,item.exchDisp,item.typeDisp].filter(Boolean).join(" "))
    ).slice(0, 8).map(item => ({
      symbol:item.symbol!,
      name:item.longname ?? item.shortname ?? item.symbol!,
      exchange:/\.BO$/.test(item.symbol!) ? "BSE" : "NSE"
    }));
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({ query:q, results, source:"Yahoo Finance search (unofficial, free endpoint)", generatedAt:new Date().toISOString() });
  } catch (error) {
    return res.status(502).json({ error:"Stock search is temporarily unavailable.", detail:error instanceof Error ? error.message : "Unknown provider error" });
  }
}
