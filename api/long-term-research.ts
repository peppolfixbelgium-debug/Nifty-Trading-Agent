import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";
import { analyzeLongTermStock, type LongTermFundamentals, type BrokerRating } from "../src/lib/long-term-analysis.js";
import type { Candle } from "../src/lib/types.js";

type Raw = Record<string, unknown>;
type YahooChart = {
  chart?: { error?: { description?: string } | null; result?: Array<{
    meta?: Raw; timestamp?: number[]; events?: Raw;
    indicators?: { quote?: Array<{open?:Array<number|null>;high?:Array<number|null>;low?:Array<number|null>;close?:Array<number|null>;volume?:Array<number|null>}> }
  }> }
};
const value = (input: unknown): number | null => {
  const raw = input && typeof input === "object" && "raw" in input ? (input as {raw:unknown}).raw : input;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (input: unknown): Raw => input && typeof input === "object" ? input as Raw : {};
const nested = (root: Raw, path: string[]): unknown => path.reduce<unknown>((current,key)=>obj(current)[key],root);
function percent(input: unknown): number | null { const v=value(input); return v===null ? null : v*100; }
function emptyFundamentals(): LongTermFundamentals {
  return {trailingPE:null,forwardPE:null,priceToBook:null,returnOnEquityPct:null,revenueGrowthPct:null,earningsGrowthPct:null,operatingMarginPct:null,profitMarginPct:null,debtToEquity:null,dividendYieldPct:null,marketCap:null,targetLow:null,targetMean:null,targetHigh:null,analystCount:null,recommendationTrend:null,brokerRatings:[],dataAvailable:false};
}
function getCookieHeader(response: Response): string {
  const h = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = h.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return raw.map(v=>v.split(";")[0]!).filter(v=>v.includes("=")).join("; ");
}
async function yahooSummary(symbol: string): Promise<{fundamentals:LongTermFundamentals; warning:string|null}> {
  try {
    const bootstrap = await fetch("https://fc.yahoo.com/", {headers:{"user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"},signal:AbortSignal.timeout(7000)});
    const cookie = getCookieHeader(bootstrap);
    if (!cookie) return {fundamentals:emptyFundamentals(),warning:"Yahoo fundamentals/analyst modules did not issue a session cookie; price-derived metrics are still shown."};
    const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {headers:{cookie,"user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"},signal:AbortSignal.timeout(7000)});
    if (!crumbResponse.ok) return {fundamentals:emptyFundamentals(),warning:"Free fundamentals/analyst data is unavailable from the source right now."};
    const crumb = (await crumbResponse.text()).trim();
    if (!crumb || crumb.startsWith("<")) return {fundamentals:emptyFundamentals(),warning:"Free fundamentals/analyst data is unavailable from the source right now."};
    const url = new URL("https://query1.finance.yahoo.com/v10/finance/quoteSummary/"+encodeURIComponent(symbol));
    url.searchParams.set("modules","price,summaryDetail,defaultKeyStatistics,financialData,recommendationTrend,upgradeDowngradeHistory");
    url.searchParams.set("crumb",crumb); url.searchParams.set("region","IN"); url.searchParams.set("lang","en-IN");
    const response = await fetch(url,{headers:{cookie,accept:"application/json","user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"},signal:AbortSignal.timeout(9000)});
    if (!response.ok) return {fundamentals:emptyFundamentals(),warning:"Free fundamentals and broker estimates were not returned by the data provider (HTTP "+response.status+")."};
    const payload = await response.json() as {quoteSummary?:{result?:Raw[];error?:Raw}};
    const root = payload.quoteSummary?.result?.[0];
    if (!root) return {fundamentals:emptyFundamentals(),warning:"No fundamentals or analyst coverage is available for this ticker from the free source."};
    const detail=obj(root.summaryDetail), stats=obj(root.defaultKeyStatistics), financial=obj(root.financialData);
    const price=obj(root.price);
    const trendRows = (nested(root,["recommendationTrend","trend"]) as Raw[] | undefined) ?? [];
    const currentTrend = trendRows.find(row=>row.period==="0m") ?? trendRows[0];
    const trend = currentTrend ? {strongBuy:value(currentTrend.strongBuy)??0,buy:value(currentTrend.buy)??0,hold:value(currentTrend.hold)??0,sell:value(currentTrend.sell)??0,strongSell:value(currentTrend.strongSell)??0} : null;
    const history = ((nested(root,["upgradeDowngradeHistory","history"]) as Raw[] | undefined) ?? []).map((row):BrokerRating => ({
      firm:String(row.firm ?? "Broker / research firm"),
      action:String(row.action ?? "rating update"),
      fromGrade:typeof row.fromGrade==="string"?row.fromGrade:null,
      toGrade:typeof row.toGrade==="string"?row.toGrade:null,
      date:value(row.epochGradeDate)===null?null:new Date(value(row.epochGradeDate)!*1000).toISOString().slice(0,10)
    })).filter(item=>item.date!==null).sort((a,b)=>(b.date??"").localeCompare(a.date??"")).slice(0,25);
    const data:LongTermFundamentals = {
      trailingPE:value(detail.trailingPE) ?? value(stats.trailingPE),
      forwardPE:value(detail.forwardPE) ?? value(stats.forwardPE),
      priceToBook:value(stats.priceToBook),
      returnOnEquityPct:percent(financial.returnOnEquity),
      revenueGrowthPct:percent(financial.revenueGrowth),
      earningsGrowthPct:percent(financial.earningsGrowth),
      operatingMarginPct:percent(financial.operatingMargins),
      profitMarginPct:percent(financial.profitMargins),
      debtToEquity:value(financial.debtToEquity),
      dividendYieldPct:percent(detail.dividendYield),
      marketCap:value(price.marketCap),
      targetLow:value(financial.targetLowPrice),
      targetMean:value(financial.targetMeanPrice),
      targetHigh:value(financial.targetHighPrice),
      analystCount:value(financial.numberOfAnalystOpinions),
      recommendationTrend:trend,
      brokerRatings:history,
      dataAvailable:[detail.trailingPE,stats.trailingPE,financial.returnOnEquity,financial.revenueGrowth,financial.operatingMargins,financial.debtToEquity].some(item=>value(item)!==null)
    };
    return {fundamentals:data,warning:data.dataAvailable?null:"Analyst/fundamental modules were mostly empty for this ticker; the assessment will be held at low confidence."};
  } catch (error) {
    return {fundamentals:emptyFundamentals(),warning:"Free fundamentals/analyst data could not be loaded: "+(error instanceof Error?error.message:"unknown provider error")};
  }
}
function indiaDate(timestamp:number):string {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(timestamp));
  const map=Object.fromEntries(parts.map(item=>[item.type,item.value]));
  return String(map.year)+"-"+String(map.month)+"-"+String(map.day);
}
export default async function handler(req:ApiRequest,res:ApiResponse) {
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed. Use GET."});}
  let symbol=typeof req.query.symbol==="string"?req.query.symbol.trim().toUpperCase():"";
  if(symbol&&!symbol.includes("."))symbol += ".NS";
  if(!/^[A-Z0-9&^._-]{1,30}\.(NS|BO)$/.test(symbol))return res.status(400).json({error:"Provide an Indian NSE/BSE equity ticker, for example RELIANCE.NS or TCS.NS."});
  try {
    const url=new URL("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol));
    url.searchParams.set("range","5y");url.searchParams.set("interval","1d");url.searchParams.set("events","div,splits");url.searchParams.set("includePrePost","false");
    const [chartResponse, summary] = await Promise.all([
      fetch(url,{headers:{accept:"application/json","user-agent":"Mozilla/5.0 (compatible; LongTermResearch/1.0)"},signal:AbortSignal.timeout(12000)}),
      yahooSummary(symbol)
    ]);
    if(!chartResponse.ok)throw new Error("Free daily-price source returned HTTP "+chartResponse.status+".");
    const chartPayload=await chartResponse.json() as YahooChart;
    if(chartPayload.chart?.error)throw new Error(chartPayload.chart.error.description??"No market history was returned for this ticker.");
    const chart=chartPayload.chart?.result?.[0];
    const meta=obj(chart?.meta), quote=chart?.indicators?.quote?.[0], timestamps=chart?.timestamp??[];
    if(!quote||!timestamps.length)throw new Error("No daily candle history was returned for this ticker.");
    const today=indiaDate(Date.now());
    const candles:Candle[]=[];
    for(let i=0;i<timestamps.length;i++){
      const time=timestamps[i];const open=quote.open?.[i],high=quote.high?.[i],low=quote.low?.[i],close=quote.close?.[i],volume=quote.volume?.[i]??null;
      if(![time,open,high,low,close].every(v=>typeof v==="number"&&Number.isFinite(v)))continue;
      if(indiaDate((time as number)*1000)>=today)continue;
      const o=open as number,h=high as number,l=low as number,c=close as number;
      if(o<=0||c<=0||h<Math.max(o,c)||l>Math.min(o,c)||h<l)continue;
      candles.push({time:(time as number)*1000,open:o,high:h,low:l,close:c,volume:typeof volume==="number"&&Number.isFinite(volume)&&volume>=0?volume:null});
    }
    const analysis=analyzeLongTermStock(candles,summary.fundamentals);
    if(!analysis)throw new Error("Fewer than 30 valid completed daily candles are available.");
    const events=obj(chart?.events);
    const dividends=Object.keys(obj(events.dividends)).length;
    const splits=Object.keys(obj(events.splits)).length;
    const response={
      symbol, name:String(meta.longName??meta.shortName??symbol), exchange:String(meta.fullExchangeName??meta.exchangeName??(/\.BO$/.test(symbol)?"BSE":"NSE")),
      currency:String(meta.currency??"INR"), latestMarketPrice:value(meta.regularMarketPrice), latestMarketPriceTime:value(meta.regularMarketTime)===null?null:new Date(value(meta.regularMarketTime)!*1000).toISOString(),
      fundamentals:summary.fundamentals, fundamentalWarning:summary.warning, analysis,
      corporateActions:{dividendEventsFiveYear:dividends,splitEventsFiveYear:splits},
      generatedAt:new Date().toISOString(),
      sources:[
        {name:"Yahoo Finance chart endpoint (unofficial)",url:"https://finance.yahoo.com/quote/"+encodeURIComponent(symbol)+"/"},
        {name:"Yahoo Finance analyst/fundamentals modules (unofficial)",url:"https://finance.yahoo.com/quote/"+encodeURIComponent(symbol)+"/analysis/"},
        {name:"NSE corporate disclosures",url:"https://www.nseindia.com/companies-listing/corporate-filings"}
      ],
      note:"Long-term screening estimates, not a personalized recommendation. The latest completed daily close is used for technical metrics so an unfinished session cannot create a false signal. Missing fundamentals/ratings remain unavailable."
    };
    res.setHeader("Cache-Control","public, s-maxage=900, stale-while-revalidate=1800");res.setHeader("X-Content-Type-Options","nosniff");
    return res.status(200).json(response);
  }catch(error){return res.status(502).json({error:"Long-term research could not be loaded.",detail:error instanceof Error?error.message:"Unknown provider error",symbol});}
}
