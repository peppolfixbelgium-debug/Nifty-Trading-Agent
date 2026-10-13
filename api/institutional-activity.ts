import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

type Row = Record<string, unknown>;
type Deal = { date:string; symbol:string; securityName:string; clientName:string; side:"BUY"|"SELL"|"UNKNOWN"; quantity:number|null; price:number|null; valueInr:number|null; type:"BULK"|"BLOCK"|"SHORT_SELLING"; remarks:string|null };
type Flow = { date:string; category:string; buyValue:number|null; sellValue:number|null; netValue:number|null };
const text=(value:unknown):string=>value===null||value===undefined?"":String(value).trim();
const num=(value:unknown):number|null=>{const n=typeof value==="number"?value:typeof value==="string"&&value.trim()?Number(value.replaceAll(",","")):NaN;return Number.isFinite(n)?n:null;};
function pick(row:Row, keys:string[]):unknown { const entries=new Map(Object.entries(row).map(([key,value])=>[key.toLowerCase().replace(/[^a-z0-9]/g,""),value]));for(const key of keys){const value=entries.get(key.toLowerCase().replace(/[^a-z0-9]/g,""));if(value!==undefined&&value!==null&&value!=="")return value;}return null;}
function dateText(value:unknown):string { const raw=text(value); if(!raw)return ""; const ms=Date.parse(raw); if(Number.isFinite(ms))return new Date(ms).toISOString().slice(0,10); const match=/^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);return match?match[3]+"-"+match[2]+"-"+match[1]:raw; }
function cookies(response:Response):string {
 const headers=response.headers as Headers&{getSetCookie?:()=>string[]};const all=headers.getSetCookie?.()??[response.headers.get("set-cookie")??""];return all.map(item=>item.split(";")[0]!).filter(item=>item.includes("=")).join("; ");
}
const nseHeaders=(cookie:string,referer:string):HeadersInit=>({accept:"application/json, text/plain, */*","accept-language":"en-GB,en;q=0.9","user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",referer,origin:"https://www.nseindia.com",cookie});
async function loadNse() {
 const response=await fetch("https://www.nseindia.com/",{headers:{"user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36","accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},signal:AbortSignal.timeout(9000)});
 const cookie=cookies(response);
 if(!cookie)throw new Error("NSE did not issue the public-session cookies needed for its disclosure API.");
 return cookie;
}
async function nseJson(cookie:string,url:string):Promise<unknown>{
 const response=await fetch(url,{headers:nseHeaders(cookie,"https://www.nseindia.com/report-detail/display-bulk-and-block-deals"),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error("NSE disclosure endpoint returned HTTP "+response.status+".");
 const body=await response.json() as unknown;
 return body;
}
function rowsFrom(value:unknown):Row[]{
 if(Array.isArray(value))return value.filter(item=>item&&typeof item==="object") as Row[];
 if(value&&typeof value==="object"){const root=value as Row;for(const key of ["data","rows","bulkDeals","blockDeals","result"]){if(Array.isArray(root[key]))return (root[key] as unknown[]).filter(item=>item&&typeof item==="object") as Row[];}}
 return [];
}
function normalizeDeals(input:unknown,type:Deal["type"]):Deal[]{
 return rowsFrom(input).map((row):Deal=>{
  const sideText=text(pick(row,["buySell","buy/sell","buyOrSell","transactionType","side","action","tradeType"])).toUpperCase();
  const side:Deal["side"]=sideText.includes("BUY")||sideText==="B"? "BUY":sideText.includes("SELL")||sideText==="S"?"SELL":"UNKNOWN";
  const quantity=num(pick(row,["quantityTraded","tradedQuantity","quantity","qty","buyQty","sellQty"]));
  const price=num(pick(row,["tradePrice","price","tradePrice/Weighted Avg Price","tradePriceAvg","avgPrice"]));
  const q=quantity===null?null:Math.abs(quantity),p=price===null?null:price;
  return {
   date:dateText(pick(row,["date","tradeDate","bdDate","dealDate","tradedate"])),
   symbol:text(pick(row,["symbol","ticker","security"])).toUpperCase(),
   securityName:text(pick(row,["securityName","companyName","name"])),
   clientName:text(pick(row,["clientName","client","investorName","clientFullName","clientCode"]))||"Client not disclosed",
   side,quantity:q,price:p,valueInr:q!==null&&p!==null?q*p:null,type,
   remarks:text(pick(row,["remarks","status","dealType"]))||null
  };
 }).filter(item=>item.symbol&&item.date).sort((a,b)=>b.date.localeCompare(a.date));
}
function normalizeFlows(input:unknown):Flow[]{
 return rowsFrom(input).map(row=>({
   date:dateText(pick(row,["date","timestamp","tradeDate","day"])),
   category:text(pick(row,["category","clientType","type","investorCategory"])),
   buyValue:num(pick(row,["buyValue","buy","buyAmount","purchaseValue"])),
   sellValue:num(pick(row,["sellValue","sell","sellAmount","saleValue"])),
   netValue:num(pick(row,["netValue","net","netAmount","netPurchase"]))
 })).filter(row=>row.category||row.date).sort((a,b)=>b.date.localeCompare(a.date));
}
function dateIndia(daysAgo:number):string {
 const d=new Date(Date.now()-daysAgo*86400000);
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(d);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return String(p.day)+"-"+String(p.month)+"-"+String(p.year);
}
let cached:{at:number;value:unknown}|null=null;
export default async function handler(req:ApiRequest,res:ApiResponse) {
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed. Use GET."});}
 const requested=typeof req.query.days==="string"?Number(req.query.days):30;
 const days=[7,30,90].includes(requested)?requested:30;
 if(cached&&Date.now()-cached.at<120000&&days===30)return res.status(200).json({...cached.value as object,cached:true});
 try{
  const cookie=await loadNse();
  const from=dateIndia(days),to=dateIndia(0);
  const dealTypes:[string,Deal["type"]][]=[["bulk_deals","BULK"],["block_deals","BLOCK"]];
  const requests=dealTypes.map(async ([optionType,type])=>{
   const url=new URL("https://www.nseindia.com/api/historicalOR/bulk-block-short-deals");url.searchParams.set("optionType",optionType);url.searchParams.set("from",from);url.searchParams.set("to",to);
   try{return {type,rows:normalizeDeals(await nseJson(cookie,url.toString()),type),warning:null as string|null};}catch(error){return {type,rows:[] as Deal[],warning:error instanceof Error?error.message:"Disclosure feed unavailable"};}
  });
  const flowsRequest=(async()=>{try{return {rows:normalizeFlows(await nseJson(cookie,"https://www.nseindia.com/api/fiidiiTradeReact")),warning:null as string|null};}catch(error){return {rows:[] as Flow[],warning:error instanceof Error?error.message:"FII/DII flow feed unavailable"};}})();
  const [dealResults,flowResult]=await Promise.all([Promise.all(requests),flowsRequest]);
  const deals=dealResults.flatMap(result=>result.rows).filter(item=>{const age=Date.parse(item.date+"T00:00:00Z");return Number.isFinite(age)&&age>=Date.now()-days*86400000-86400000;}).sort((a,b)=>b.date.localeCompare(a.date));
  const uniqueDeals=deals.filter((item,index,array)=>array.findIndex(other=>other.type===item.type&&other.date===item.date&&other.symbol===item.symbol&&other.clientName===item.clientName&&other.side===item.side&&other.quantity===item.quantity)===index);
  const warnings=[...dealResults.map(item=>item.warning),flowResult.warning].filter((item):item is string=>!!item);
  const freshBuys=uniqueDeals.filter(item=>item.side==="BUY");
  const response={generatedAt:new Date().toISOString(),cached:false,periodDays:days,dealCount:uniqueDeals.length,freshDisclosedBuys:freshBuys.length,deals:uniqueDeals,flows:flowResult.rows.slice(0,20),warnings,source:[{name:"NSE India bulk/block deal disclosures",url:"https://www.nseindia.com/report-detail/display-bulk-and-block-deals"},{name:"NSE India historical reports",url:"https://www.nseindia.com/static/resources/historical-reports-capital-market-daily-monthly-archives"}],note:"Bulk/block deal disclosures identify reported client trades, not a complete portfolio. A disclosed buy is not proof of a new long-term position or current holding; FII/DII daily flows are market-wide, not stock-specific. Provider data may be revised or temporarily unavailable."};
  if(days===30)cached={at:Date.now(),value:response};
  res.setHeader("Cache-Control","public, s-maxage=120, stale-while-revalidate=240");res.setHeader("X-Content-Type-Options","nosniff");
  return res.status(200).json(response);
 }catch(error){return res.status(502).json({error:"Institutional activity could not be loaded from NSE India.",detail:error instanceof Error?error.message:"Unknown provider error",generatedAt:new Date().toISOString(),deals:[],flows:[],warnings:[],source:[{name:"NSE India bulk/block deal disclosures",url:"https://www.nseindia.com/report-detail/display-bulk-and-block-deals"}]});}
}
