import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLongTermStock, type LongTermFundamentals } from "../src/lib/long-term-analysis.js";
import type { Candle } from "../src/lib/types.js";

function candles(count:number, closeAt:(index:number)=>number):Candle[]{
 const rows:Candle[]=[];
 for(let i=0;i<count;i++){
  const close=closeAt(i);
  rows.push({time:Date.UTC(2022,0,1+i),open:close*0.998,high:close*1.01,low:close*0.99,close,volume:100000});
 }
 return rows;
}
function fundamentals(overrides:Partial<LongTermFundamentals>={}):LongTermFundamentals{
 return {trailingPE:20,forwardPE:18,priceToBook:3,returnOnEquityPct:18,revenueGrowthPct:12,earningsGrowthPct:10,operatingMarginPct:16,profitMarginPct:12,debtToEquity:35,dividendYieldPct:1.5,marketCap:1000000,targetLow:100,targetMean:120,targetHigh:140,analystCount:8,recommendationTrend:{strongBuy:2,buy:4,hold:1,sell:1,strongSell:0},brokerRatings:[],dataAvailable:true,...overrides};
}
test("long-term assessment calculates trend, price returns and entry levels from completed candles",()=>{
 const rows=candles(800,i=>100*Math.pow(1.0004,i));
 const analysis=analyzeLongTermStock(rows,fundamentals());
 assert.ok(analysis);
 assert.equal(analysis.candlesUsed,800);
 assert.ok(analysis.sma50!==null&&analysis.sma200!==null&&analysis.sma50>analysis.sma200);
 assert.ok(analysis.oneYearReturnPct!==null&&analysis.oneYearReturnPct>0);
 assert.ok(analysis.entryPlan.low>0&&analysis.entryPlan.high>=analysis.entryPlan.low);
 assert.ok(analysis.score!==null);
 assert.ok(["BUY","HOLD","SELL / AVOID"].includes(analysis.rating));
 assert.ok(analysis.metrics.some(metric=>metric.label==="Debt / equity"&&metric.status==="GOOD"));
});
test("missing fundamentals cannot be mistaken for an investment buy score",()=>{
 const rows=candles(260,i=>100+i*0.2);
 const analysis=analyzeLongTermStock(rows,fundamentals({trailingPE:null,returnOnEquityPct:null,revenueGrowthPct:null,operatingMarginPct:null,debtToEquity:null,dividendYieldPct:null,dataAvailable:false}));
 assert.ok(analysis);
 assert.equal(analysis.score,null);
 assert.equal(analysis.rating,"HOLD");
 assert.equal(analysis.confidence,"LOW");
 assert.ok(analysis.metrics.some(metric=>metric.status==="UNAVAILABLE"));
});
test("stocks below 200-day average are marked as trend-recovery watch zones",()=>{
 const rows=candles(400,i=>i<300?100+i*0.3:190-(i-300)*0.7);
 const analysis=analyzeLongTermStock(rows,fundamentals());
 assert.ok(analysis);
 assert.equal(analysis.entryPlan.mode,"trend-recovery");
 assert.match(analysis.entryPlan.note,/below its 200-day average/i);
 assert.ok(analysis.entryPlan.confirmation!==null);
});
test("insufficient price history does not produce a report",()=>{
 assert.equal(analyzeLongTermStock(candles(20,i=>100+i),fundamentals()),null);
});
