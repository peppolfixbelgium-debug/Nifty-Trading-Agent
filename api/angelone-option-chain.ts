import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

type Instrument = { token?: string; symbol?: string; name?: string; expiry?: string; strike?: string; lotsize?: string; instrumenttype?: string; exch_seg?: string };
type Greek = { strike?: string; optionType?: string; delta?: string; gamma?: string; theta?: string; vega?: string; impliedVolatility?: string; tradeVolume?: string };
const INDEX_TOKENS: Record<string, string> = { NIFTY: "99926000", BANKNIFTY: "99926009", FINNIFTY: "99926037", MIDCPNIFTY: "99926074" };
const UNDERLYINGS: Record<string, string> = { NIFTY50: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY", MIDCPNIFTY: "MIDCPNIFTY" };
const n = (v: unknown): number | null => { const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(x) ? x : null; };
const expiryDate = (value: string): Date | null => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d : null; };
const ddMmmYyyy = (date: Date) => date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).replace(/ /g, "").toUpperCase();

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed. Use GET." }); }
  const apiKey = process.env.ANGELONE_API_KEY, jwt = process.env.ANGELONE_JWT_TOKEN;
  const localIp = process.env.ANGELONE_CLIENT_LOCAL_IP, publicIp = process.env.ANGELONE_CLIENT_PUBLIC_IP, mac = process.env.ANGELONE_MAC_ADDRESS;
  if (!apiKey || !jwt || !localIp || !publicIp || !mac) return res.status(503).json({ configured: false, error: "Angel One market-data feed is not connected.", detail: "Configure the five ANGELONE_* server-side environment variables in Vercel. No credentials belong in frontend code or Git." });
  const underlyingId = typeof req.query.underlying === "string" ? req.query.underlying : "NIFTY50";
  const name = UNDERLYINGS[underlyingId];
  const requestedExpiry = typeof req.query.expiry === "string" ? req.query.expiry : "current_week";
  if (!name) return res.status(400).json({ error: "Angel One currently supports NIFTY, BANKNIFTY, FINNIFTY and MIDCPNIFTY in this panel. SENSEX is not mapped here." });
  const headers: Record<string, string> = { Authorization: "Bearer " + jwt, "X-PrivateKey": apiKey, Accept: "application/json", "Content-Type": "application/json", "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": localIp, "X-ClientPublicIP": publicIp, "X-MACAddress": mac };
  try {
    const masterResponse = await fetch("https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json", { signal: AbortSignal.timeout(15000) });
    if (!masterResponse.ok) throw new Error("Angel One instrument master returned HTTP " + masterResponse.status + ".");
    const master = await masterResponse.json() as Instrument[];
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const expiries = [...new Set(master.filter(i => i.exch_seg === "NFO" && i.name === name && (i.instrumenttype === "OPTIDX" || i.instrumenttype === "OPTSTK") && i.expiry).map(i => i.expiry!))]
      .map(value => ({ value, date: expiryDate(value) })).filter((x): x is { value: string; date: Date } => !!x.date && x.date >= new Date(today.getFullYear(), today.getMonth(), today.getDate()))
      .sort((a,b) => a.date.getTime() - b.date.getTime());
    if (!expiries.length) return res.status(502).json({ configured: true, error: "No future Angel One option expiries were found in the instrument master." });
    const weekIndex = requestedExpiry === "next_week" ? 1 : requestedExpiry === "far_week" ? 2 : 0;
    const monthIndex = requestedExpiry === "next_month" ? 1 : requestedExpiry === "far_month" ? 2 : 0;
    let chosen = expiries[0]!;
    if (requestedExpiry.includes("month")) {
      const months = [...new Set(expiries.map(x => x.date.getFullYear() + "-" + x.date.getMonth()))];
      const target = months[Math.min(monthIndex, months.length - 1)];
      chosen = expiries.find(x => x.date.getFullYear() + "-" + x.date.getMonth() === target) ?? chosen;
    } else chosen = expiries[Math.min(weekIndex, expiries.length - 1)]!;
    const expiry = ddMmmYyyy(chosen.date);
    const greekResponse = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/marketData/v1/optionGreek", { method: "POST", headers, body: JSON.stringify({ name, expirydate: expiry }), signal: AbortSignal.timeout(12000) });
    if (!greekResponse.ok) throw new Error("Angel One option Greeks returned HTTP " + greekResponse.status + ".");
    const greekPayload = await greekResponse.json() as { status?: boolean; message?: string; errorcode?: string; data?: Greek[] | null };
    if (greekPayload.status !== true) throw new Error(greekPayload.message ?? greekPayload.errorcode ?? "Angel One returned no Greeks for " + expiry + ".");
    const catalog = master.filter(i => i.exch_seg === "NFO" && i.name === name && i.expiry === chosen.value && (i.instrumenttype === "OPTIDX" || i.instrumenttype === "OPTSTK") && /^\\d+$/.test(i.token ?? ""));
    const byContract = new Map(catalog.map(i => [String(n(i.strike) === null ? "" : n(i.strike)) + "|" + (i.instrumenttype === "OPTIDX" ? (i.symbol?.endsWith("CE") ? "CE" : i.symbol?.endsWith("PE") ? "PE" : "") : ""), i]));
    const greekRows = (greekPayload.data ?? []).map(g => ({ strike: n(g.strikePrice), type: g.optionType, delta: n(g.delta), gamma: n(g.gamma), theta: n(g.theta), vega: n(g.vega), iv: n(g.impliedVolatility), volume: n(g.tradeVolume) })).filter(g => g.strike !== null && (g.type === "CE" || g.type === "PE"));
    const strikes = [...new Set(greekRows.map(g => g.strike!))].sort((a,b) => a-b);
    const indexToken = INDEX_TOKENS[name];
    const quoteIndex = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote", { method: "POST", headers, body: JSON.stringify({ mode: "LTP", exchangeTokens: { NSE: [indexToken] } }), signal: AbortSignal.timeout(12000) });
    let spot: number | null = null;
    if (quoteIndex.ok) { const q = await quoteIndex.json() as { status?: boolean; data?: { fetched?: Array<Record<string, unknown>> } }; if (q.status) spot = n(q.data?.fetched?.[0]?.ltp); }
    const centre = spot ?? (strikes.length ? strikes[Math.floor(strikes.length/2)]! : null);
    const near = centre === null ? strikes.slice(0, 17) : strikes.slice().sort((a,b) => Math.abs(a-centre)-Math.abs(b-centre)).slice(0, 17).sort((a,b)=>a-b);
    const selected = greekRows.filter(g => near.includes(g.strike!));
    const tokenBySymbol = new Map(catalog.map(i => [i.symbol ?? "", i]));
    const tokenFor = (strike: number, type: string) => catalog.find(i => n(i.strike) === strike && i.symbol?.endsWith(type));
    const tokens = [...new Set(selected.map(g => tokenFor(g.strike!, g.type!)?.token).filter((v): v is string => !!v))];
    const quoteMap = new Map<string, Record<string, unknown>>();
    for (let i=0; i<tokens.length; i+=50) {
      const quoteResponse = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote", { method: "POST", headers, body: JSON.stringify({ mode: "FULL", exchangeTokens: { NFO: tokens.slice(i,i+50) } }), signal: AbortSignal.timeout(12000) });
      if (!quoteResponse.ok) continue;
      const q = await quoteResponse.json() as { status?: boolean; data?: { fetched?: Array<Record<string, unknown>> } };
      for (const item of q.data?.fetched ?? []) if (typeof item.symbolToken === "string") quoteMap.set(item.symbolToken, item);
    }
    const rows = near.map(strike => {
      const side = (type: string) => {
        const g = selected.find(x => x.strike === strike && x.type === type);
        if (!g) return null;
        const instrument = tokenFor(strike, type);
        const q = instrument?.token ? quoteMap.get(instrument.token) : undefined;
        const depth = q?.depth && typeof q.depth === "object" ? q.depth as Record<string, unknown> : {};
        const buy = Array.isArray(depth.buy) ? depth.buy as Array<Record<string, unknown>> : [];
        const sell = Array.isArray(depth.sell) ? depth.sell as Array<Record<string, unknown>> : [];
        return { instrumentKey: instrument?.token ?? null, ltp: n(q?.ltp), close: n(q?.close), volume: n(q?.tradeVolume) ?? g.volume, oi: n(q?.opnInterest), bid: n(buy[0]?.price), ask: n(sell[0]?.price), iv: g.iv, delta: g.delta, theta: g.theta, gamma: g.gamma, vega: g.vega };
      };
      return { expiry: chosen.value, pcr: null, strike, spot, call: side("CE"), put: side("PE") };
    });
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({ configured: true, source: "Angel One SmartAPI + official instrument master", generatedAt: new Date().toISOString(), underlying: underlyingId, expiry: chosen.value, spot, rows, note: "Option contracts are discovered from Angel One's instrument master. Missing quotes/OI remain blank; Greeks are the provider's values." });
  } catch (error) {
    return res.status(502).json({ configured: true, error: "Angel One option chain could not be loaded.", detail: error instanceof Error ? error.message : "Unknown provider error" });
  }
}
