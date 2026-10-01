"use client";

// Build repair: ensure Vercel deploys the valid EliteWave source.

import "./globals.css";

import { memo, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle } from "../src/analysis/engine";
import { confluence, detectRegime, flowSnapshot, riskPlan, runSMCBacktest } from "../src/analysis/advanced";
import { fetchNewsEvents, getNewsRisk, type NewsEvent, type NewsRisk } from "../src/analysis/news";
import { analyzeOrderFlow, type OrderFlowResult } from "../src/analysis/orderflow";
import { classifyOrderFlowSetup, type OrderFlowScanRow } from "../src/analysis/orderflowScanner";
import { FootprintBook, normalizeAggTrade, type AggTrade, type FootprintSnapshot } from "../src/analysis/footprint";
import { analyzeReversal, analyzeReversalMTF, type ReversalEngineResult } from "../src/analysis/reversal";

type Mode="smc"|"elliott"|"combined"|"orderflow";
type MarketKind="spot"|"usdm"|"coinm";
type BinanceSymbol={symbol:string;baseAsset:string;quoteAsset:string;minQty:number;maxQty:number;stepSize:number;minNotional:number;maxNotional:number;tickSize:number};
type Derivatives={openInterest:string;fundingRate:string;change24h:string}|null;
type Ticker={symbol:string,priceChangePercent:number,quoteVolume:number};
const intervals=["1m","5m","15m","1h","4h","1d"] as const;
const mtfIntervals=["4h","1h","15m","5m"];
const marketConfig:Record<MarketKind,{label:string;rest:string;ws:string;aggRest:string}>={
 spot:{label:"SPOT",rest:"https://api.binance.com/api/v3",ws:"wss://stream.binance.com:9443/ws/",aggRest:"https://api.binance.com/api/v3/aggTrades"},
 usdm:{label:"USDⓈ-M FUTURES",rest:"https://fapi.binance.com/fapi/v1",ws:"wss://fstream.binance.com/ws/",aggRest:"https://fapi.binance.com/fapi/v1/aggTrades"},
 coinm:{label:"COIN-M FUTURES",rest:"https://dapi.binance.com/dapi/v1",ws:"wss://dstream.binance.com/ws/",aggRest:"https://dapi.binance.com/dapi/v1/aggTrades"}
};

const binanceRestState={nextAllowedAt:0,lastRequestAt:0};
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

async function binanceFetchJson(url:string,init?:RequestInit,retries=2):Promise<any>{
 for(let attempt=0;attempt<=retries;attempt+=1){
  const now=Date.now();
  const wait=Math.max(binanceRestState.nextAllowedAt-now,binanceRestState.lastRequestAt+220-now,0);
  if(wait>0)await sleep(wait);
  binanceRestState.lastRequestAt=Date.now();
  const r=await fetch(url,init);
  if(r.ok)return r.json();
  if(r.status===429||r.status===418){
   const retryAfter=Number(r.headers.get("Retry-After")||0);
   const backoff=Math.max(1000,retryAfter*1000||Math.min(15000,1500*Math.pow(2,attempt)));
   binanceRestState.nextAllowedAt=Date.now()+backoff;
   if(attempt<retries){await sleep(backoff);continue;}
   throw new Error(`Binance rate limit ${r.status}. Retried safely; REST temporarily throttled.`);
  }
  throw new Error(`Binance request failed ${r.status}`);
 }
 throw new Error("Binance request failed");
}

async function fetchKlines(symbol:string,interval:string,limit=300,marketType:MarketKind="spot"):Promise<Candle[]>{
 const cfg=marketConfig[marketType];
 const rows=await binanceFetchJson(`${cfg.rest}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
 return rows.map((x:any)=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],takerBuyVolume:+x[9],closed:+x[6] <= Date.now()}));
}

async function fetchAggTrades(symbol:string,marketType:MarketKind,startTime:number,endTime:number,signal?:AbortSignal,maxTrades=3000):Promise<AggTrade[]>{
 const cfg=marketConfig[marketType];const out:AggTrade[]=[];const seen=new Set<number>();let cursor=startTime;let requestCount=0;
 while(cursor<=endTime&&out.length<maxTrades&&requestCount<4){
  const windowEnd=Math.min(endTime,cursor+60*60*1000-1);
  const q=new URLSearchParams({symbol:symbol.toUpperCase(),limit:"1000",startTime:String(cursor),endTime:String(windowEnd)});
  const rows=await binanceFetchJson(cfg.aggRest+"?"+q.toString(),{signal});requestCount+=1;
  if(!Array.isArray(rows)||rows.length===0)break;
  let lastTime=cursor;
  for(const raw of rows){
   const t=normalizeAggTrade(raw);if(!t)continue;
   lastTime=Math.max(lastTime,t.time);
   if(t.time<startTime||t.time>endTime||seen.has(t.id))continue;
   seen.add(t.id);out.push(t);if(out.length>=maxTrades)break;
  }
  if(rows.length<1000||lastTime<=cursor)break;
  cursor=lastTime+1;
 }
 return out.sort((a,b)=>a.time-b.time||a.id-b.id);
}

function intervalMs(interval:string):number{const units:Record<string,number>={m:60*1000,h:60*60*1000,d:24*60*60*1000};const n=Number(interval.slice(0,-1));return Math.max(60*1000,(Number.isFinite(n)?n:1)*(units[interval.slice(-1)]??60*1000));}
export default function Home(){
 const [mode,setMode]=useState<Mode>("combined"),[isModePending,startModeTransition]=useTransition(),[symbol,setSymbol]=useState("BTCUSDT"),[interval,setInterval]=useState<(typeof intervals)[number]>("15m"),[marketType,setMarketType]=useState<MarketKind>("spot");
 const [theme,setTheme]=useState<"tradingview"|"cyber">("tradingview");
 const [newsEvents,setNewsEvents]=useState<NewsEvent[]>([]),[newsNow,setNewsNow]=useState(Date.now()),[newsLoading,setNewsLoading]=useState(true),[newsError,setNewsError]=useState(false);

 const [candles,setCandles]=useState<Candle[]>([]),[analysisCandles,setAnalysisCandles]=useState<Candle[]>([]),[pairs,setPairs]=useState<BinanceSymbol[]>([]);
 const [pairSearch,setPairSearch]=useState(""),[quoteFilter,setQuoteFilter]=useState("USDT"),[mtfCandles,setMtfCandles]=useState<{interval:string;candles:Candle[]}[]>([]);
 const [connected,setConnected]=useState(false),[restConnected,setRestConnected]=useState(false),[footprintConnected,setFootprintConnected]=useState(false),[footprintVersion,setFootprintVersion]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(""),[derivatives,setDerivatives]=useState<Derivatives>(null);
 const [chartReady,setChartReady]=useState(false),[viewportTick,setViewportTick]=useState(0),[layers,setLayers]=useState({structure:true,zones:true,liquidity:true,trade:true,reversal:true});
 const [account,setAccount]=useState(1000),[riskPercent,setRiskPercent]=useState(1),[feeBps,setFeeBps]=useState(0),[slippageBps,setSlippageBps]=useState(0),[riskR,setRiskR]=useState(1),[maxHoldingCandles,setMaxHoldingCandles]=useState(30),[backtest,setBacktest]=useState<any>(null),[scanner,setScanner]=useState<Ticker[]>([]),[orderFlowScanner,setOrderFlowScanner]=useState<OrderFlowScanRow[]>([]),[orderFlowScanTf,setOrderFlowScanTf]=useState<string>("5m"),[orderFlowScannerEnabled,setOrderFlowScannerEnabled]=useState(false),[orderFlowScanBusy,setOrderFlowScanBusy]=useState(false),[orderFlowScanUpdated,setOrderFlowScanUpdated]=useState(0),[orderFlowScanProgress,setOrderFlowScanProgress]=useState(""),[orderFlowScanError,setOrderFlowScanError]=useState("");
 const chartRef=useRef<HTMLDivElement>(null),chartWrapRef=useRef<HTMLDivElement>(null),chartObj=useRef<any>(null),seriesRef=useRef<any>(null),footprintBookRef=useRef<FootprintBook|null>(null);

 const smc=useMemo(()=>analyzeSMC(analysisCandles),[analysisCandles]);
 const elliott=useMemo(()=>analyzeElliott(analysisCandles),[analysisCandles]);
 const mtf=useMemo(()=>analyzeMTF(mtfCandles),[mtfCandles]);
 const flow=useMemo(()=>flowSnapshot(analysisCandles),[analysisCandles]);
 const footprintSnapshots=useMemo<FootprintSnapshot[]>(()=>footprintBookRef.current?.snapshots(analysisCandles,Date.now())??[],[analysisCandles,footprintVersion]);
 const orderFlow=useMemo(()=>analyzeOrderFlow(analysisCandles,footprintSnapshots),[analysisCandles,footprintSnapshots]);
 const reversal=useMemo<ReversalEngineResult>(()=>analyzeReversal(analysisCandles,smc,orderFlow),[analysisCandles,smc,orderFlow]);
 const mtfReversal=useMemo(()=>analyzeReversalMTF(mtfCandles),[mtfCandles]);
 const regime=useMemo(()=>detectRegime(analysisCandles),[analysisCandles]);
 const conf=useMemo(()=>confluence(smc,flow,regime),[smc,flow,regime]);
 const last=candles.at(-1),prev=candles.at(-2),priceChange=last&&prev?(last.close-prev.close)/prev.close*100:0;
 const selectedPair=pairs.find(p=>p.symbol===symbol); const risk=useMemo(()=>riskPlan(account,riskPercent,smc.setup.status==="ACTIVE"?smc.setup.entry:null,smc.setup.status==="ACTIVE"?smc.stop:null,selectedPair,smc.setup.direction),[account,riskPercent,smc.setup.status,smc.setup.entry,smc.stop,selectedPair,smc.setup.direction]);
 const newsRisk:NewsRisk=useMemo(()=>newsError?{level:"HIGH",blocked:true,message:"News calendar unavailable — trading blocked until news data is available"}:getNewsRisk(newsEvents,newsNow,30),[newsError,newsEvents,newsNow]);
 const combinedParts=[smc.score,elliott.score,mtf.score].filter(v=>v>0); const combined=combinedParts.length?Math.round(combinedParts.reduce((s,v)=>s+v,0)/combinedParts.length):0;
 const showOrderFlow=mode==="orderflow";

 useEffect(()=>{ const controller=new AbortController(); const load=async()=>{setNewsLoading(true);try{setNewsEvents(await fetchNewsEvents(controller.signal));setNewsError(false)}catch{setNewsEvents([]);setNewsError(true)}finally{if(!controller.signal.aborted)setNewsLoading(false)}}; load(); const refresh=window.setInterval(load,10*60*1000); const clock=window.setInterval(()=>setNewsNow(Date.now()),30*1000); return()=>{controller.abort();clearInterval(refresh);clearInterval(clock)}; },[]);

 useEffect(()=>{let stop=false;setPairs([]);const cfg=marketConfig[marketType];const load=async()=>{try{const d=await binanceFetchJson(`${cfg.rest}/exchangeInfo`);const next=(d.symbols||[]).filter((x:any)=>x.status==="TRADING"&&(x.contractStatus==null||x.contractStatus==="TRADING")).map((x:any)=>{const filters=x.filters||[];const lot=filters.find((f:any)=>f.filterType==="LOT_SIZE")||filters.find((f:any)=>f.filterType==="MARKET_LOT_SIZE")||{};const notional=filters.find((f:any)=>f.filterType==="NOTIONAL")||filters.find((f:any)=>f.filterType==="MIN_NOTIONAL")||{};const priceFilter=filters.find((f:any)=>f.filterType==="PRICE_FILTER")||{};return{symbol:x.symbol,baseAsset:x.baseAsset,quoteAsset:x.quoteAsset,minQty:Number(lot.minQty)||0,maxQty:Number(lot.maxQty)||Infinity,stepSize:Number(lot.stepSize)||0,minNotional:Number(notional.minNotional)||Number(notional.notional)||0,maxNotional:Number(notional.maxNotional)||Infinity,tickSize:Number(priceFilter.tickSize)||0}});if(!stop){setPairs(next);setQuoteFilter(marketType==="coinm"?"ALL":"USDT");setSymbol(prev=>next.some((p:any)=>p.symbol===prev)?prev:(next[0]?.symbol||""))}}catch{if(!stop){setPairs([]);setSymbol("")}}};load();return()=>{stop=true}},[marketType]);
 useEffect(()=>{let stop=false;const cfg=marketConfig[marketType];const load=()=>binanceFetchJson(`${cfg.rest}/ticker/24hr`).then((d:any[])=>{if(stop||!Array.isArray(d))return;setScanner(d.filter(x=>typeof x.symbol==="string"&&Number(x.quoteVolume)>10000000).map(x=>({symbol:x.symbol,priceChangePercent:Number(x.priceChangePercent),quoteVolume:Number(x.quoteVolume)})).filter(x=>Number.isFinite(x.priceChangePercent)&&Number.isFinite(x.quoteVolume)).sort((a,b)=>b.quoteVolume-a.quoteVolume).slice(0,20))}).catch(()=>{});load();const id=window.setInterval(load,60000);return()=>{stop=true;clearInterval(id)}},[marketType]);
 useEffect(()=>{
  let stop=false;
  const scan=async()=>{
   if(stop||!orderFlowScannerEnabled||!pairs.length||orderFlowScanBusy)return;
   setOrderFlowScanBusy(true);
   try{
    const candidates=pairs
      .filter(p=>quoteFilter==="ALL"||p.quoteAsset===quoteFilter)
      .filter(p=>p.symbol!==symbol)
      .map(p=>({pair:p,rank:scanner.findIndex(x=>x.symbol===p.symbol)}))
      .sort((a,b)=>(a.rank<0?999:a.rank)-(b.rank<0?999:b.rank))
      .slice(0,6);
    const rows:OrderFlowScanRow[]=[];
    setOrderFlowScanProgress(`0/${candidates.length}`);
    setOrderFlowScanError("");
    for(let i=0;i<candidates.length;i+=1){
     const c=candidates[i];
     if(stop)break;
     setOrderFlowScanProgress(`${i+1}/${candidates.length} · ${c.pair.symbol}`);
     if(stop)break;
     try{
      const candles=(await fetchKlines(c.pair.symbol,orderFlowScanTf,180,marketType)).filter(x=>x.closed!==false);
      const tfMs=intervalMs(orderFlowScanTf);
      const lookback=Math.min(3*60*60*1000,Math.max(tfMs*14,60*60*1000));
      const trades=await fetchAggTrades(c.pair.symbol,marketType,Date.now()-lookback,Date.now()-1500,undefined,3000);
      const book=new FootprintBook(tfMs,c.pair.tickSize,36);
      book.load(trades);
      const fps=book.snapshots(candles,Date.now());
      const result=analyzeOrderFlow(candles,fps);
      rows.push(classifyOrderFlowSetup(c.pair.symbol,orderFlowScanTf,result));
     }catch{
      rows.push({symbol:c.pair.symbol,timeframe:orderFlowScanTf,state:"WAIT",direction:"NONE",score:0,price:null,deltaRatio:0,pressure:"BALANCED",liquiditySweep:"NONE",absorption:"NONE",footprintBars:0,reason:"Scanner data unavailable"});
     }
    }
    if(!stop){const confirmed=rows.filter(x=>x.state==="CONFIRMED").sort((a,b)=>b.score-a.score);setOrderFlowScanner(confirmed);setOrderFlowScanUpdated(Date.now());setOrderFlowScanProgress(`DONE · ${confirmed.length} confirmed`)}
   }catch(e){if(!stop)setOrderFlowScanError(e instanceof Error?e.message:"Scanner request failed")}
   finally{if(!stop)setOrderFlowScanBusy(false)}
  };
  scan();
  const id=window.setInterval(scan,120000);
  return()=>{stop=true;clearInterval(id)};
 },[marketType,quoteFilter,orderFlowScanTf,orderFlowScannerEnabled,pairs.length,symbol,scanner.length]);

 useEffect(()=>{const controller=new AbortController();Promise.all(mtfIntervals.map(async tf=>{try{return{interval:tf,candles:(await fetchKlines(symbol,tf,180,marketType)).filter(x=>x.closed!==false)}}catch{return{interval:tf,candles:[]}}})).then(rows=>{if(!controller.signal.aborted)setMtfCandles(rows)});return()=>controller.abort()},[symbol,marketType]);

 useEffect(()=>{
  let ws:WebSocket|undefined;
  let stop=false;
  let retryTimer:ReturnType<typeof setTimeout>|undefined;
  let staleTimer:ReturnType<typeof setTimeout>|undefined;
  let stableTimer:ReturnType<typeof setTimeout>|undefined;
  let reconnectAttempt=0;
  let establishedOnce=false;
  let restSyncInFlight=false;
  const MAX_RECONNECT_DELAY=30000;
  const STALE_AFTER_MS=45000;

  const mergeCandles=(incoming:Candle[],existing:Candle[]=[],preferIncoming=false)=>{
   const byTime=new Map<number,Candle>();
   if(preferIncoming){
    for(const c of existing)byTime.set(c.time,c);
    for(const c of incoming)byTime.set(c.time,c);
   }else{
    for(const c of incoming)byTime.set(c.time,c);
    for(const c of existing)byTime.set(c.time,c);
   }
   return [...byTime.values()].sort((a,b)=>a.time-b.time).slice(-350);
  };

  setCandles([]);setAnalysisCandles([]);setConnected(false);setRestConnected(false);setBacktest(null);setLoading(true);setError("");setDerivatives(null);

  const clearTimers=()=>{
   if(retryTimer){clearTimeout(retryTimer);retryTimer=undefined}
   if(staleTimer){clearTimeout(staleTimer);staleTimer=undefined}
   if(stableTimer){clearTimeout(stableTimer);stableTimer=undefined}
  };

  const armStaleTimer=(socket:WebSocket)=>{
   if(staleTimer)clearTimeout(staleTimer);
   staleTimer=setTimeout(()=>{
    if(stop||ws!==socket||socket.readyState!==WebSocket.OPEN)return;
    try{socket.close(4001,"stale market-data stream")}catch{}
   },STALE_AFTER_MS);
  };

  const syncFromRest=async()=>{
   if(stop||restSyncInFlight)return;
   restSyncInFlight=true;
   try{
    const data=await fetchKlines(symbol,interval,350,marketType);
    if(stop)return;
    setRestConnected(true);
    setError("");
    setCandles(prev=>mergeCandles(data,prev));
    setAnalysisCandles(data.filter(x=>x.closed!==false));
   }catch(e){
    if(stop)return;
    setRestConnected(false);
    if(e instanceof Error&&e.name!=="AbortError")setError(e.message||"Market data resync failed");
   }finally{restSyncInFlight=false}
  };

  const scheduleReconnect=()=>{
   if(stop||retryTimer)return;
   const baseDelay=Math.min(MAX_RECONNECT_DELAY,1000*Math.pow(2,Math.min(reconnectAttempt,5)));
   const jitter=Math.round(baseDelay*0.2*(Math.random()*2-1));
   const delay=Math.max(750,baseDelay+jitter);
   reconnectAttempt+=1;
   retryTimer=setTimeout(()=>{retryTimer=undefined;connect()},delay);
  };

  const connect=()=>{
   if(stop)return;
   if(retryTimer){clearTimeout(retryTimer);retryTimer=undefined}
   if(staleTimer){clearTimeout(staleTimer);staleTimer=undefined}
   const socket=new WebSocket(marketConfig[marketType].ws + symbol.toLowerCase() + "@kline_" + interval);
   ws=socket;

   socket.onopen=()=>{
    if(stop||ws!==socket)return;
    setConnected(true);
    if(stableTimer)clearTimeout(stableTimer);
    stableTimer=setTimeout(()=>{if(!stop&&ws===socket)reconnectAttempt=0},10000);
    armStaleTimer(socket);
    if(establishedOnce)void syncFromRest();
    establishedOnce=true;
   };

   socket.onmessage=e=>{
    if(stop||ws!==socket)return;
    try{
     const k=JSON.parse(e.data).k;
     if(!k)return;
     const c={time:+k.t,open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v,takerBuyVolume:+k.V,closed:!!k.x};
     setCandles(prev=>mergeCandles([c],prev,true));
     if(c.closed){
      setAnalysisCandles(prev=>{
       const byTime=new Map<number,Candle>();
       for(const item of prev)byTime.set(item.time,item);
       byTime.set(c.time,c);
       return [...byTime.values()].sort((a,b)=>a.time-b.time).slice(-350);
      });
     }
     armStaleTimer(socket);
    }catch{}
   };

   socket.onerror=()=>{
    if(stop||ws!==socket)return;
    setConnected(false);
   };

   socket.onclose=()=>{
    if(ws!==socket)return;
    if(stableTimer){clearTimeout(stableTimer);stableTimer=undefined}
    if(staleTimer){clearTimeout(staleTimer);staleTimer=undefined}
    setConnected(false);
    scheduleReconnect();
   };
  };

  fetchKlines(symbol,interval,350,marketType).then(data=>{
   if(stop)return;
   setRestConnected(true);
   setCandles(data);
   setAnalysisCandles(data.filter(x=>x.closed!==false));
   setLoading(false);
   connect();
  }).catch(e=>{
   if(stop)return;
   setRestConnected(false);
   setLoading(false);
   setError(e instanceof Error?e.message:"Market data error");
   scheduleReconnect();
  });

  return()=>{
   stop=true;
   clearTimers();
   const oldSocket=ws;
   ws=undefined;
   try{oldSocket?.close(1000,"effect cleanup")}catch{}
  };
 },[symbol,interval,marketType]);

 useEffect(()=>{
  let stop=false;let socket:WebSocket|undefined;let retry:number|undefined;let flush:number|undefined;let attempt=0;
  const tfMs=intervalMs(interval);const tick=selectedPair?.tickSize??0;const book=new FootprintBook(tfMs,tick,36);footprintBookRef.current=book;setFootprintVersion(v=>v+1);
  const schedule=()=>{if(stop||retry)return;const delay=Math.min(15000,1000*Math.pow(2,Math.min(attempt++,4)));retry=window.setTimeout(()=>{retry=undefined;connect()},delay)};
  const connect=()=>{if(stop)return;try{socket?.close()}catch{};socket=new WebSocket(marketConfig[marketType].ws+symbol.toLowerCase()+"@aggTrade");
   socket.onopen=()=>{if(stop)return;attempt=0;setFootprintConnected(true)};
   socket.onmessage=e=>{if(stop)return;try{const t=normalizeAggTrade(JSON.parse(e.data));if(t)book.add(t)}catch{}};
   socket.onerror=()=>{if(!stop)setFootprintConnected(false)};
   socket.onclose=()=>{if(stop)return;setFootprintConnected(false);schedule()};
  };
  const loadHistory=async()=>{if(!symbol||!selectedPair?.tickSize)return;try{const lookback=Math.min(3*60*60*1000,Math.max(tfMs*6,60*60*1000));const trades=await fetchAggTrades(symbol,marketType,Date.now()-lookback,Date.now()-1500);if(stop)return;book.load(trades);setFootprintVersion(v=>v+1);setFootprintConnected(true)}catch{if(!stop)setFootprintConnected(false)}};
  void loadHistory();connect();
  flush=window.setInterval(()=>setFootprintVersion(v=>v+1),1000);
  return()=>{stop=true;if(retry)clearTimeout(retry);if(flush)clearInterval(flush);try{socket?.close(1000,"cleanup")}catch{};if(footprintBookRef.current===book)footprintBookRef.current=null;setFootprintConnected(false)};
 },[symbol,interval,marketType,selectedPair?.tickSize]);

 const lastClosed=candles.at(-1)?.closed!==false?candles.at(-1):candles.at(-2);
 const lastClosedTime=lastClosed?.time??0;
 useEffect(()=>{if(!lastClosedTime)return;setAnalysisCandles(prev=>prev.at(-1)?.time===lastClosedTime?prev:candles.filter(x=>x.closed!==false))},[lastClosedTime]);

 useEffect(()=>{let stop=false;const load=async()=>{try{const cfg=marketConfig[marketType==="spot"?"usdm":marketType];const [o,p,tt]=await Promise.all([binanceFetchJson(`${cfg.rest}/openInterest?symbol=${encodeURIComponent(symbol)}`),binanceFetchJson(`${cfg.rest}/premiumIndex?symbol=${encodeURIComponent(symbol)}`),binanceFetchJson(`${cfg.rest}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`)]);if(!stop)setDerivatives({openInterest:o.openInterest,fundingRate:p.lastFundingRate,change24h:tt.priceChangePercent})}catch{if(!stop)setDerivatives(null)}};if(symbol)load();const id=window.setInterval(load,60000);return()=>{stop=true;clearInterval(id)}},[symbol,marketType]);

 useEffect(()=>{
  let disposed=false;
  let chart:any=null;
  let series:any=null;
  let ro:ResizeObserver|undefined;
  let onViewport:(()=>void)|undefined;  const host=chartRef.current;
  if(!host)return;

  import("lightweight-charts").then(({createChart,CandlestickSeries})=>{
   if(disposed||!chartRef.current)return;
   chart=createChart(host,{width:Math.max(320,host.clientWidth||900),height:Math.max(360,host.clientHeight||500),autoSize:false,layout:{background:{color:"#0b0f15"},textColor:"#8792a5"},grid:{vertLines:{color:"#151b25"},horzLines:{color:"#151b25"}},rightPriceScale:{borderColor:"#26303f",scaleMargins:{top:.08,bottom:.08}},timeScale:{borderColor:"#26303f",timeVisible:true,secondsVisible:false,rightOffset:6,barSpacing:11,minBarSpacing:5},crosshair:{mode:0},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}});
   series=chart.addSeries(CandlestickSeries,{upColor:"#36d399",downColor:"#f06b78",borderVisible:false,wickUpColor:"#36d399",wickDownColor:"#f06b78",priceLineVisible:true,lastValueVisible:true});
   chartObj.current=chart;
   seriesRef.current=series;
   setChartReady(true);

   onViewport=()=>setViewportTick(v=>v+1);
   chart.timeScale().subscribeVisibleLogicalRangeChange(onViewport);
   ro=new ResizeObserver(()=>{
    if(!chart)return;
    chart.resize(Math.max(320,host.clientWidth||900),Math.max(360,host.clientHeight||500));
    setViewportTick(v=>v+1);
   });
   ro.observe(host);
  }).catch(e=>{
   if(!disposed)setError(e instanceof Error?e.message:"Chart library failed");
  });

  return()=>{
   disposed=true;
   ro?.disconnect();
   if(chart&&onViewport){
    try{chart.timeScale().unsubscribeVisibleLogicalRangeChange(onViewport)}catch{}
   }
   chart?.remove?.();
   if(chartObj.current===chart)chartObj.current=null;
   if(seriesRef.current===series)seriesRef.current=null;
   setChartReady(false);
  };
 },[]);
 useEffect(()=>{const s=seriesRef.current;if(!chartReady||!s||candles.length<2)return;s.setData(candles.map(c=>({time:Math.floor(c.time/1000) as any,open:c.open,high:c.high,low:c.low,close:c.close})));chartObj.current?.timeScale().setVisibleLogicalRange({from:Math.max(0,candles.length-100),to:candles.length-1+4});setViewportTick(v=>v+1)},[chartReady,symbol,interval,candles.length]);
 useEffect(()=>{const s=seriesRef.current,l=candles.at(-1);if(!chartReady||!s||!l)return;s.update({time:Math.floor(l.time/1000) as any,open:l.open,high:l.high,low:l.low,close:l.close})},[candles,chartReady]);

 const quoteOptions=useMemo(()=>Array.from(new Set(pairs.map(p=>p.quoteAsset))).sort(),[pairs]);
 const filtered=useMemo(()=>pairs.filter(p=>(quoteFilter==="ALL"||p.quoteAsset===quoteFilter)&&p.symbol.includes(pairSearch)),[pairs,quoteFilter,pairSearch]);
 const reset=()=>{const c=chartObj.current;if(!c||!candles.length)return;c.timeScale().setVisibleLogicalRange({from:Math.max(0,candles.length-100),to:candles.length-1+4});setViewportTick(v=>v+1)},toggle=(k:keyof typeof layers)=>setLayers(v=>({...v,[k]:!v[k]}));
 const lastAnalysisTime=analysisCandles.at(-1)?.time??0; const runBacktest=()=>{if(analysisCandles.length>=84)setBacktest({...runSMCBacktest(analysisCandles,riskR,maxHoldingCandles,feeBps,slippageBps),symbol,interval,asOf:lastAnalysisTime,riskR,maxHoldingCandles,feeBps,slippageBps});else setBacktest(null)}; const backtestStale=!!backtest&&(backtest.symbol!==symbol||backtest.interval!==interval||backtest.asOf!==lastAnalysisTime||backtest.riskR!==riskR||backtest.maxHoldingCandles!==maxHoldingCandles||backtest.feeBps!==feeBps||backtest.slippageBps!==slippageBps);
 const fmt=(n:number|null|undefined)=>n==null?"—":n.toLocaleString(undefined,{maximumFractionDigits:8});

 return <main className={`app-shell theme-${theme}`}>
  <div className="terminal-chrome"><span>QUANTSTRUCTURE</span><i/> <b>MARKET ANALYSIS</b><em>LIVE</em></div>
  <header className="topbar"><div className="brand-block"><div className="brand">QUANT<span>STRUCTURE</span></div><div className="subtitle">Advanced SMC · Elliott · Order Flow · Risk Analytics</div></div>
   <div className="market-selector"><div className="selector-search"><span>⌕</span><input value={pairSearch} onChange={e=>setPairSearch(e.target.value.toUpperCase())} placeholder="Search symbol"/></div><select value={marketType} onChange={e=>setMarketType(e.target.value as MarketKind)}><option value="spot">SPOT</option><option value="usdm">USDⓈ-M FUTURES</option><option value="coinm">COIN-M FUTURES</option></select><select value={quoteFilter} onChange={e=>setQuoteFilter(e.target.value)}><option value="ALL">ALL QUOTES</option>{quoteOptions.map(q=><option key={q}>{q}</option>)}</select><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{filtered.length?filtered.map(p=><option key={p.symbol}>{p.symbol}</option>):<option>{symbol||"Loading…"}</option>}</select></div>
   <div className="top-status"><div className="theme-switch" aria-label="Theme"><button className={theme==="tradingview"?"active":""} onClick={()=>setTheme("tradingview")}>TV DARK</button><button className={theme==="cyber"?"active":""} onClick={()=>setTheme("cyber")}>CYBER</button></div><span className="data-status"><i className={connected?"pulse live-dot":"live-dot"}/>{connected?"LIVE DATA":"CONNECTING"}</span><span className="source-badge">BINANCE</span></div>
  </header>

  <section className="controlbar"><div className="instrument"><strong>{symbol||"—"}</strong><span>{marketConfig[marketType].label} · {interval}</span>{last&&<b>{fmt(last.close)}</b>}{last&&<em className={priceChange>=0?"positive":"negative"}>{priceChange>=0?"+":""}{priceChange.toFixed(2)}%</em>}</div>
   <div className="timeframes">{intervals.map(t=><button className={interval===t?"active":""} onClick={()=>setInterval(t)} key={t}>{t}</button>)}</div>
   <div className={`analysis-tabs${isModePending?" pending":""}`} aria-busy={isModePending}>{([["smc","SMC"],["elliott","ELLIOTT WAVE"],["combined","COMBINED"],["orderflow","ORDER FLOW"]] as const).map(([k,l])=><button className={mode===k?"active":""} onClick={()=>startModeTransition(()=>setMode(k))} key={k}>{l}</button>)}</div>
  </section>

  <section className="toolbar"><div className="toolbar-title">CHART</div>{([["structure","STRUCTURE"],["zones","FVG / OB"],["liquidity","LIQUIDITY"],["trade","SETUP LEVELS"],["reversal","REVERSAL"]] as const).map(([k,l])=><button className={layers[k]?"layer-on":""} onClick={()=>toggle(k)} key={k}><i/>{l}</button>)}<button onClick={reset}>RESET VIEW</button><span className="toolbar-note">Closed-candle analysis only</span></section>
  {error&&<div className="alert">{error}</div>}
  <div className={`news-filter news-${newsRisk.level.toLowerCase()}`}><div><span className="news-kicker">NEWS FILTER</span><strong>{newsRisk.level}</strong><span className="news-message">{newsLoading?"Checking calendar…":newsRisk.message}</span></div><b>{newsRisk.blocked?"TRADING BLOCKED":"TRADING ALLOWED"}</b></div>

  <section className="terminal-grid"><div className="chart-column">
   <div className="panel-card chart-card"><div className="panel-header"><div><span className="eyebrow">PRICE ACTION</span><h2>{symbol} <small>{interval}</small></h2></div><div className="chart-actions"><span>{candles.length} candles</span><button onClick={reset}>FIT</button></div></div>
    <div className="chart-wrap" ref={chartWrapRef}><div className="chart-left-rail"><button title="Crosshair">⌖</button><button title="Trend line">╱</button><button title="Horizontal line">━</button><button title="Rectangle">□</button><button title="Fibonacci">F</button><span/><button title="Long setup">↗</button><button title="Short setup">↘</button></div><div className="chartarea" ref={chartRef}/>{chartReady&&<MemoizedChartAnnotations chart={chartObj.current} series={seriesRef.current} host={chartWrapRef.current} candles={analysisCandles} smc={smc} elliott={elliott} orderFlow={orderFlow} reversal={reversal} mtfReversal={mtfReversal} mode={mode} tick={viewportTick} layers={layers}/>} {loading&&<div className="chart-loading"><span/>Loading market data…</div>}</div>
    <div className="chart-footer"><span><i className="legend-dot smc-dot"/> SMC</span><span><i className="legend-dot wave-dot"/> Elliott</span><span><i className="legend-dot liq-dot"/> Liquidity</span>{mode==="orderflow"&&<span><i className="legend-dot liq-dot"/> Order Flow</span>}<span className="chart-tip">Live Binance {marketConfig[marketType].label.toLowerCase()} data · analysis uses closed candles</span></div>
   </div>

   <details className="more-tools"><summary>Market details <span>Regime · Flow · Confluence</span></summary><div className="metric-grid">
    <MetricCard title="MARKET REGIME"><Row k="State" v={regime.regime}/><Row k="Strength" v={regime.strength+"/100"}/><Row k="Range" v={regime.rangePercent.toFixed(2)+"%"}/><Row k="ATR" v={fmt(regime.atr)}/></MetricCard>
    <MetricCard title="KLINE TAKER FLOW"><Row k="Pressure" v={flow.pressure}/><Row k="Window delta" v={fmt(flow.delta)}/><Row k="Window delta ratio" v={(flow.deltaRatio*100).toFixed(2)+"%"}/><Row k="Volume ratio" v={flow.volumeRatio.toFixed(2)+"×"}/></MetricCard>
    <MetricCard title="CONFLUENCE"><ScoreRow label="Structure" value={conf.structure}/><ScoreRow label="Liquidity" value={conf.liquidity}/><ScoreRow label="Zones" value={conf.zones}/><ScoreRow label="Total" value={conf.total}/></MetricCard>
   </div>

   <div className="advanced-grid">
    <div className="panel-card"><div className="section-title">RISK PLANNER</div><div className="input-grid"><label>Account<input type="number" value={account} onChange={e=>setAccount(+e.target.value)}/></label><label>Risk %<input type="number" min=".1" max="10" step=".1" value={riskPercent} onChange={e=>setRiskPercent(+e.target.value)}/></label></div><div className="risk-output"><Row k="Risk amount" v={"$"+risk.riskAmount.toFixed(2)}/><Row k="Stop distance" v={fmt(risk.stopDistance)}/><Row k="Position size" v={risk.positionSize?fmt(risk.positionSize):"—"}/><Row k="Setup R:R" v={smc.setup.rr?smc.setup.rr.toFixed(2)+":1":"—"}/></div>{risk.reason!=="OK"&&<p className="muted-copy">Sizing check: {risk.reason}. Exchange quantity/notional filters are applied when available.</p>}<div className="risk-note">Position size is based on the selected account risk and entry/stop distance; leverage is not a profit guarantee.</div></div>
    <div className="panel-card"><div className="section-title">SMC BACKTEST</div><p className="muted-copy">Uses closed candles only. Costs are per-side basis points; this remains a historical check, not a guarantee of future performance.</p><div className="input-grid"><label>Risk R / trade<input type="number" min=".1" step=".1" value={riskR} onChange={e=>setRiskR(Math.max(.1,+e.target.value||.1))}/></label><label>Max holding bars<input type="number" min="1" step="1" value={maxHoldingCandles} onChange={e=>setMaxHoldingCandles(Math.max(1,Math.floor(+e.target.value||1)))}/></label></div><div className="input-grid"><label>Fee bps / side<input type="number" min="0" step=".1" value={feeBps} onChange={e=>setFeeBps(Math.max(0,+e.target.value||0))}/></label><label>Slippage bps / side<input type="number" min="0" step=".1" value={slippageBps} onChange={e=>setSlippageBps(Math.max(0,+e.target.value||0))}/></label></div><button className="primary-action" onClick={runBacktest} disabled={analysisCandles.length<84}>RUN BACKTEST</button>{backtest&&<>{<p className="muted-copy">{backtestStale?"RESULT OUTDATED — RUN AGAIN":"RESULT UP TO DATE"} · {backtest.symbol} · {backtest.interval}</p>}<div className="backtest-grid"><Stat k="Trades" v={backtest.trades}/><Stat k="Win rate" v={backtest.winRate.toFixed(1)+"%"}/><Stat k="Net R" v={backtest.totalR.toFixed(1)}/><Stat k="Profit factor" v={backtest.profitFactor.toFixed(2)}/><Stat k="Max DD" v={backtest.maxDrawdownR.toFixed(1)+"R"}/><Stat k="Open at end" v={backtest.openAtEnd}/></div></>}</div>
   </div>
   </details>
  </div>

  <aside className="analysis-column">   <div className="panel-card analysis-card"><div className="panel-header compact"><div><span className="eyebrow">ENGINE OUTPUT</span><h2>{mode==="smc"?"SMC ANALYSIS":mode==="elliott"?"ELLIOTT WAVE":mode==="orderflow"?"ORDER FLOW ANALYSIS":"COMBINED ANALYSIS"}</h2></div><span className="mode-badge">{mode.toUpperCase()}</span></div>
    {(mode==="smc"||mode==="combined")&&<div className="section-block"><div className="section-title">SMART MONEY CONCEPT</div>{newsRisk.blocked&&<div className="news-signal-warning">⚠ HIGH-IMPACT NEWS WINDOW — signal remains analytical; confirm after the news window before executing.</div>}<Row k="Trend" v={smc.trend}/><Row k="Premium / Discount" v={smc.premiumDiscount}/><Row k="BOS / CHOCH" v={smc.events.at(-1)?.type||"None"}/><Row k="FVG / OB" v={smc.fvgs.filter(x=>!x.filled).length+" / "+smc.orderBlocks.filter(x=>!x.mitigated).length}/><Row k="Setup" v={smc.setup.status==="ACTIVE"?(smc.setup.direction+" · ACTIVE"):(smc.setup.direction==="WAIT"?"WAIT":"WAIT · "+smc.setup.direction)}/><Row k="Confluence" v={conf.total+"/100"}/>{smc.setup.confirmations.length>0&&<div className="confirmation-list">{smc.setup.confirmations.slice(0,7).map(x=><div key={x}>✓ {x}</div>)}</div>}</div>}
    {(mode==="elliott"||mode==="combined")&&<div className="section-block"><div className="section-title">ELLIOTT WAVE</div><Row k="Pattern" v={elliott.pattern}/><Row k="Degree" v={elliott.degree}/><Row k="Phase" v={elliott.phase}/><Row k="Primary" v={elliott.primary?elliott.primary.points.map(p=>p.label).filter(Boolean).join(" → "):"No candidate"}/><Row k="Direction" v={elliott.primary?.direction||"—"}/><Row k="Alternative" v={elliott.alternative?(elliott.alternative.strict?"Strict candidate":"Fallback candidate · not tradeable"):"None"}/><Row k="Count state" v={elliott.setupState==="HISTORICAL"?"HISTORICAL · NOT LIVE":elliott.setupState}/><Row k="Active leg" v={elliott.activeWave}/><Row k="Candidates" v={elliott.candidateCount+" · corrections "+elliott.correctionCandidates}/><Row k="Correction" v={elliott.correctionPattern}/><Row k="Nested W3/W5" v={elliott.nested.length?elliott.nested.map(x=>x.wave+":"+x.subwaves).join(" · "):"Limited"}/><Row k="Rule conformance" v={elliott.confidence+"/100"}/><Row k="Wave 2 end · historical" v={fmt(elliott.primary?.entry)}/><Row k="Invalidation" v={fmt(elliott.primary?.invalidation)}/><Row k="Wave 3 target · historical" v={fmt(elliott.primary?.targets?.[0])}/><Row k="Wave 5 end · historical" v={fmt(elliott.primary?.targets?.[1])}/><Row k="Extension target" v={fmt(elliott.primary?.targets?.[2])}/><Row k="Historical R:R" v={elliott.primary?.entry!=null&&elliott.primary?.invalidation!=null&&elliott.primary?.targets?.[0]!=null?(Math.abs(elliott.primary.targets[0]-elliott.primary.entry)/Math.abs(elliott.primary.entry-elliott.primary.invalidation)).toFixed(2)+":1":"—"}/></div>}
    {mode==="orderflow"&&<div className="section-block"><div className="section-title">ORDER FLOW STRATEGY</div><Row k="Signal" v={orderFlow.signal}/><Row k="Direction" v={orderFlow.direction}/><Row k="Confidence" v={orderFlow.confidence+"/100"}/><Row k="Buyer Pressure" v={orderFlow.buyerPressure.toFixed(1)+"%"}/><Row k="Seller Pressure" v={orderFlow.sellerPressure.toFixed(1)+"%"}/><Row k="Delta" v={fmt(orderFlow.delta)}/><Row k="Delta Ratio" v={(orderFlow.deltaRatio*100).toFixed(2)+"%"}/><Row k="Cumulative Delta" v={fmt(orderFlow.cumulativeDelta)}/><Row k="Pressure Trend" v={orderFlow.pressureTrend}/><Row k="Imbalance" v={orderFlow.imbalance+(orderFlow.imbalanceRatio?(" · "+orderFlow.imbalanceRatio.toFixed(2)+"×"):"—")}/><Row k="Absorption" v={orderFlow.absorption+(orderFlow.absorptionStrength?(" · "+orderFlow.absorptionStrength+"/100"):"")}/><Row k="Liquidity" v={orderFlow.liquiditySweep}/><Row k="Micro Structure" v={orderFlow.microStructure}/><Row k="Entry" v={fmt(orderFlow.entry)}/><Row k="Stop" v={fmt(orderFlow.stop)}/><Row k="TP1 / TP2 / TP3" v={orderFlow.targets.length?orderFlow.targets.map(x=>x.toFixed(4)).join(" · "):"—"}/><Row k="Data Source" v={orderFlow.source==="BINANCE_TAKER_FLOW"?"Binance taker-buy flow":"Candle estimate fallback"}/>{orderFlow.confirmations.length>0&&<div className="confirmation-list">{orderFlow.confirmations.map(x=><div key={x}>✓ {x}</div>)}</div>}<p className="muted-copy">Independent Order Flow module. Binance kline taker-buy volume is used when available; this is not a full L2 footprint reconstruction.</p></div>}{mode==="combined"&&<div className="confluence-box"><div><span>INDEPENDENT CONFLUENCE</span><strong>{combined}<small>/100</small></strong></div><p>SMC, Elliott and MTF remain separate evidence streams. Combined is a heuristic summary, not a calibrated probability.</p></div>}
   </div>

   <div className={`section-block reversal-engine-block reversal-${reversal.state.toLowerCase()}`}><div className="section-title">REVERSAL ENGINE</div><Row k="State" v={reversal.state}/><Row k="Direction" v={reversal.direction}/><Row k="Confluence" v={reversal.score+"/100"}/><Row k="MTF 15m / 5m" v={mtfReversal.direction+" · "+mtfReversal.score+"/100"}/><Row k="MTF State" v={mtfReversal.state}/><Row k="1h Context" v={mtfReversal.contextDirection}/><Row k="Liquidity Sweep" v={reversal.sweepIndex!=null?(reversal.direction==="BUY"?"SELL-SIDE LOW":"BUY-SIDE HIGH"):"None"}/><Row k="MSS / CHOCH" v={reversal.structureIndex!=null?"CONFIRMED":"WAITING"}/><Row k="Displacement" v={(reversal.displacementRatio?reversal.displacementRatio.toFixed(2):"0.00")+"× ATR"}/><Row k="FVG / OB" v={(reversal.fvg?"YES":"NO")+" / "+(reversal.orderBlock?"YES":"NO")}/><Row k="Order Flow" v={reversal.orderflowConfirmed?"CONFIRMED":"WAITING"}/><Row k="Delta Divergence" v={reversal.deltaDivergence?"YES":"NO"}/><Row k="Trigger" v={fmt(reversal.triggerPrice)}/><Row k="Invalidation" v={fmt(reversal.invalidation)}/>{reversal.evidence.filter(x=>x.active).length>0&&<div className="confirmation-list">{reversal.evidence.filter(x=>x.active).map(x=><div key={x.name}>✓ {x.name} · {x.points}</div>)}</div>}<p className="muted-copy">{reversal.reason}</p></div>
      {showOrderFlow&&<div className="panel-card mtf-card orderflow-scanner-card">
    <div className="section-title">ORDER FLOW PAIR SCANNER <span>{orderFlowScannerEnabled?(orderFlowScanBusy?"SCANNING…":orderFlowScanUpdated?new Date(orderFlowScanUpdated).toLocaleTimeString():"—"):"OFF"}</span></div>
    <div className="scanner-controls">
      <label className="scanner-toggle"><input type="checkbox" checked={orderFlowScannerEnabled} onChange={e=>{setOrderFlowScannerEnabled(e.target.checked);if(!e.target.checked){setOrderFlowScanner([]);setOrderFlowScanProgress("");setOrderFlowScanError("")}}}/><b>{orderFlowScannerEnabled?"ON":"OFF"}</b><small>Show CONFIRMED setups only</small></label>
      <select value={orderFlowScanTf} onChange={e=>setOrderFlowScanTf(e.target.value)} disabled={!orderFlowScannerEnabled}>{intervals.map(tf=><option key={tf}>{tf}</option>)}</select>
      <small>{orderFlowScanBusy?"Scanning "+(orderFlowScanProgress||"…"):orderFlowScanProgress||"Ready"} · Top 6 candidates · closed candles only · Binance footprint</small>
    </div>
    {!orderFlowScannerEnabled&&<div className="setup-empty">Scanner OFF — no pair scan is running.</div>}
    {orderFlowScannerEnabled&&orderFlowScanError&&<div className="setup-empty">Scanner error: {orderFlowScanError}</div>}
    {orderFlowScannerEnabled&&orderFlowScanner.length===0&&!orderFlowScanBusy&&!orderFlowScanError&&<div className="setup-empty">No CONFIRMED Order Flow setups found.</div>}
    {orderFlowScannerEnabled&&orderFlowScanner.map(x=><div className="scanner-row" key={x.symbol+"-"+x.timeframe}>
      <span><b>{x.symbol}</b><small>{x.timeframe} · FP {x.footprintBars}/12</small></span>
      <b className="positive">{x.direction} · CONFIRMED</b>
      <small>{x.score}/100</small>
    </div>)}
    {orderFlowScannerEnabled&&orderFlowScanner.slice(0,3).map(x=><div className="scanner-reason" key={"reason-"+x.symbol}>{x.symbol}: {x.reason}</div>)}
   </div>}

<details className="more-tools side-tools"><summary>More market data <span>MTF · Derivatives · Scanner · Status</span></summary><div className="panel-card mtf-card"><div className="section-title">MULTI-TIMEFRAME</div>{mtf.frames.map(f=><div className="mtf-row" key={f.interval}><span>{f.interval}</span><b className={f.trend==="Bullish"?"positive":f.trend==="Bearish"?"negative":""}>{f.available?f.trend:"UNAVAILABLE"}</b><small>{f.structure} · SMC/COMBINED {f.score}/100 · EW {f.elliottTrend} {f.elliottScore}/100</small></div>)}</div>
   <div className="panel-card mtf-card"><div className="section-title">DERIVATIVES</div><div className="mtf-row"><span>Open Interest</span><b>{derivatives?Number(derivatives.openInterest).toLocaleString(): "—"}</b><small>{marketType==="coinm"?"COIN-M":"USDⓈ-M"}</small></div><div className="mtf-row"><span>Funding</span><b>{derivatives?Number(derivatives.fundingRate).toFixed(5):"—"}</b><small>8h</small></div><div className="mtf-row"><span>24h</span><b className={derivatives&&+derivatives.change24h>=0?"positive":"negative"}>{derivatives?Number(derivatives.change24h).toFixed(2)+"%":"—"}</b><small>Futures</small></div></div>

   <div className="panel-card mtf-card"><div className="section-title">MARKET SCANNER</div>{scanner.slice(0,8).map(x=><div className="scanner-row" key={x.symbol}><span>{x.symbol}</span><b className={x.priceChangePercent>=0?"positive":"negative"}>{x.priceChangePercent>=0?"+":""}{x.priceChangePercent.toFixed(2)}%</b><small>{(x.quoteVolume/1e6).toFixed(1)}M</small></div>)}</div>
   <div className="panel-card feed-card"><div className="section-title">SYSTEM STATUS</div><div className="status-line"><span>{marketConfig[marketType].label} REST</span><b className={restConnected?"positive":"negative"}>{restConnected?"CONNECTED":loading?"CONNECTING":"OFFLINE"}</b></div><div className="status-line"><span>WebSocket</span><b className={connected?"positive":"negative"}>{connected?"LIVE":"RECONNECTING"}</b></div><div className="status-line"><span>SMC / Elliott</span><b className={analysisCandles.length>=30?"positive":analysisCandles.length>=25?"":"negative"}>{analysisCandles.length>=30?"READY":analysisCandles.length>=25?"SMC ONLY":"WAITING"}</b></div><div className="status-line"><span>Derivatives</span><b>{derivatives?"LIVE":"N/A"}</b></div><div className="status-line"><span>Execution</span><b>DISABLED</b></div></div></details>
  </aside></section>
  <footer className="footer"><span>QUANTSTRUCTURE · ADVANCED MARKET ANALYSIS WORKSTATION</span><span>Binance {marketConfig[marketType].label.toLowerCase()} data · all TRADING pairs exposed · analysis only</span></footer>
 </main>;
}

function ChartAnnotations({chart,series,host,candles,smc,elliott,orderFlow,reversal,mtfReversal,mode,tick,layers}:{chart:any;series:any;host:HTMLElement|null;candles:Candle[];smc:any;elliott:any;orderFlow:OrderFlowResult;reversal:ReversalEngineResult;mtfReversal:any;mode:Mode;tick:number;layers:any}){
 const width=host?.clientWidth||0,height=host?.clientHeight||0;
 if(!chart||!series||!host||!candles.length)return null;if(!chart||!series||candles.length<2||!width||!height)return null;
 const ts=chart.timeScale(),lastIndex=candles.length-1,xCache=new Map<number,number|null>(),yCache=new Map<number,number|null>();
 const xOf=(i:number)=>{if(i<0||i>=candles.length)return null;if(xCache.has(i))return xCache.get(i)!;try{const x=ts.timeToCoordinate?.(Math.floor(candles[i].time/1000) as any);const value=x!=null?x:(ts.logicalToCoordinate?.(i)??null);xCache.set(i,value);return value}catch{xCache.set(i,null);return null}};
 const yOf=(p:number)=>{if(yCache.has(p))return yCache.get(p)!;try{const y=series.priceToCoordinate(p)??null;yCache.set(p,y);return y}catch{yCache.set(p,null);return null}};
 const showSMC=mode==="smc"||mode==="combined",showElliott=mode==="elliott"||mode==="combined",showOrderFlow=mode==="orderflow";
 const xLast=xOf(lastIndex)??width,x0=0;
 const text=(x:number|null,y:number|null,s:string,cls:string)=>x==null||y==null?null:<g><rect x={x-3} y={y-13} width={Math.max(32,s.length*5.9+8)} height="17" rx="3" className="label-bg"/><text x={x+1} y={y-1} className={`chart-label ${cls}`}>{s}</text></g>;
 const zone=(low:number,high:number,start:number,end:number,cls:string,title:string)=>{const xa=xOf(start)??x0,xb=xOf(end)??xLast,y1=yOf(high),y2=yOf(low);if(y1==null||y2==null)return null;return <g><rect x={Math.min(xa,xb)} y={Math.min(y1,y2)} width={Math.max(2,Math.abs(xb-xa))} height={Math.max(2,Math.abs(y2-y1))} className={cls}/>{text(Math.min(xa,xb)+4,Math.min(y1,y2)+16,title,cls+"-label")}</g>};
 const structure=showSMC&&layers.structure?<>{smc.events.slice(-8).map((e:any,i:number)=>{const x=xOf(e.index),y=yOf(e.price);return x==null||y==null?null:<g key={"e"+i}><line x1={x} x2={x} y1={y} y2={e.direction==="bullish"?Math.max(18,y-24):Math.min(height-18,y+24)} className={e.type==="CHOCH"?"choch-line":"bos-line"}/>{text(x+6,e.direction==="bullish"?Math.max(18,y-24):Math.min(height-18,y+24),e.type+" "+(e.direction==="bullish"?"BULL":"BEAR"),e.type==="CHOCH"?"choch-label":"bos-label")}</g>})}{smc.pivots.slice(-12).map((p:any,i:number)=>{const x=xOf(p.index),y=yOf(p.price);return x==null||y==null?null:<text key={"p"+i} x={x+3} y={y+(p.type==="H"?-6:12)} className="marker-text">{p.label}</text>})}</>:null;
 const zones=showSMC&&layers.zones?<>{smc.fvgs.slice(-8).map((z:any,i:number)=>zone(z.low,z.high,z.from,z.filled&&z.fillIndex!==undefined?z.fillIndex:lastIndex,z.type==="bullish"?"fvg-bull":"fvg-bear",z.type==="bullish"?"FVG BULL":"FVG BEAR"))}{smc.orderBlocks.slice(-6).map((o:any,i:number)=>zone(o.low,o.high,o.index,o.mitigated&&o.mitigationIndex!==undefined?o.mitigationIndex:lastIndex,o.type==="bullish"?"ob-bull":"ob-bear",o.type==="bullish"?"BULL OB":"BEAR OB"))}</>:null;
 const liquidity=showSMC&&layers.liquidity?<>{[...smc.liquidityHighs.slice(-3).map((p:any)=>({...p,t:"LIQ HIGH"})),...smc.liquidityLows.slice(-3).map((p:any)=>({...p,t:"LIQ LOW"}))].map((p:any,i:number)=>{const x=xOf(p.index)??x0,y=yOf(p.price);return y==null?null:<g key={"l"+i}><line x1={x} x2={xLast} y1={y} y2={y} className="liquidity-line"/>{text(x+3,y,p.t,"liquidity-label")}</g>})}{smc.sweeps.slice(-6).map((s:any,i:number)=>{const x=xOf(s.index),y=yOf(s.price);return x==null||y==null?null:<g key={"s"+i}><circle cx={x} cy={y} r="4" className="marker-sweep"/>{text(x+7,y,s.type==="high"?"SWEEP H":"SWEEP L","sweep-label")}</g>})}</>:null;
 const trade=showSMC&&layers.trade&&smc.entryZone?<>{zone(smc.entryZone.low,smc.entryZone.high,Math.max(0,lastIndex-18),lastIndex,"entry-zone","ENTRY ZONE")}{smc.setup.entry!=null&&(()=>{const y=yOf(smc.setup.entry);return y==null?null:<g><line x1={x0} x2={xLast} y1={y} y2={y} className="entry-line"/>{text(xLast-108,y,"ENTRY "+smc.setup.entry.toFixed(4),"entry-label")}</g>})()}{smc.stop!=null&&(()=>{const y=yOf(smc.stop);return y==null?null:<g><line x1={x0} x2={xLast} y1={y} y2={y} className="sl-line"/>{text(xLast-92,y,"SL "+smc.stop.toFixed(4),"sl-label")}</g>})()}{(smc.targets||[]).slice(0,3).map((p:number,i:number)=>{const y=yOf(p);return y==null?null:<g key={"t"+i}><line x1={x0} x2={xLast} y1={y} y2={y} className="tp-line"/>{text(xLast-52,y,"TP"+(i+1),"tp-label")}</g>})}</>:null;
 const elite=elliott.primary;
 const eliteTrade=showElliott&&layers.trade&&elite&&elite.entry!=null&&elite.invalidation!=null?<>{(()=>{const p2=elite.points.find((p:any)=>p.label==="2"),xe=p2?xOf(p2.index):null,ye=yOf(elite.entry);return ye==null?null:<g>{xe!=null&&<circle cx={xe} cy={ye} r="5" className="elite-entry-marker"/>}<line x1={x0} x2={xLast} y1={ye} y2={ye} className="elite-entry-line"/>{text(xLast-120,ye,"EW ENTRY "+elite.entry.toFixed(4),"elite-entry-label")}</g>})()}{(()=>{const y=yOf(elite.invalidation);return y==null?null:<g><line x1={x0} x2={xLast} y1={y} y2={y} className="elite-sl-line"/>{text(xLast-100,y,"EW SL "+elite.invalidation.toFixed(4),"elite-sl-label")}</g>})()}{(elite.targets||[]).slice(0,3).map((p:number,i:number)=>{const y=yOf(p);return y==null?null:<g key={"ewtp"+i}><line x1={x0} x2={xLast} y1={y} y2={y} className="elite-tp-line"/>{text(xLast-60,y,"EW TP"+(i+1),"elite-tp-label")}</g>})}</>:null;
 const drawWave=(points:any[],keyPrefix:string,labelClass="wave-label")=><>{points.map((p:any,i:number)=>{const x=xOf(p.index),y=yOf(p.price),n=points[i+1],nx=n?xOf(n.index):null,ny=n?yOf(n.price):null;return x==null||y==null?null:<g key={keyPrefix+i}>{nx!=null&&ny!=null&&<line x1={x} y1={y} x2={nx} y2={ny} className="wave-line"/>}{p.label&&text(x,y,p.label,labelClass)}</g>})}</>;
 const mtfSignalMarker = layers.reversal && mtfReversal.confirmed && mtfReversal.direction !== "NONE" ? (() => {
  const dirCls = mtfReversal.direction === "BUY" ? "reversal-buy" : "reversal-sell";
  const idx = candles.length - 1;
  const px = xOf(idx);
  const py = yOf(candles[idx]?.close ?? 0);
  const label = mtfReversal.direction + " REVERSAL · MTF 15m + 5m CONFIRMED · " + mtfReversal.score + "/100";
  return <g className="reversal-chart-layer">
    <circle cx={px} cy={py} r="11" className={dirCls+"-mtf-marker"}/>
    {text(Math.max(8,Math.min(width-260,px+14)),Math.max(20,py-14),label,dirCls+"-mtf-label")}
  </g>;
 })() : null;
 const reversalMarker = layers.reversal && reversal.state !== "NONE" ? (() => {
  const sweepX=reversal.sweepIndex!=null?xOf(reversal.sweepIndex):null;
  const sweepY=reversal.sweepPrice!=null?yOf(reversal.sweepPrice):null;
  const triggerX=reversal.triggerIndex!=null?xOf(reversal.triggerIndex):null;
  const triggerY=reversal.triggerPrice!=null?yOf(reversal.triggerPrice):null;
  const invalidationY=reversal.invalidation!=null?yOf(reversal.invalidation):null;
  const dirCls=reversal.direction==="BUY"?"reversal-buy":"reversal-sell";
  const label=reversal.direction+" REVERSAL · "+reversal.state+" · "+reversal.score+"/100";
  return <g className="reversal-chart-layer">
    {sweepX!=null&&sweepY!=null&&<><circle cx={sweepX} cy={sweepY} r="6" className={dirCls+"-sweep"}/>{text(Math.min(width-180,sweepX+8),sweepY,reversal.direction==="BUY"?"REV SWEEP LOW":"REV SWEEP HIGH",dirCls+"-label")}</>}
    {reversal.structureIndex!=null&&(()=>{const e=smc.events.find((x:any)=>x.index===reversal.structureIndex&&x.type==="CHOCH");const ex=e?xOf(e.index):null,ey=e?yOf(e.price):null;return ex!=null&&ey!=null?<g><circle cx={ex} cy={ey} r="5" className={dirCls+"-choch"}/>{text(Math.min(width-170,ex+8),ey,"REV CHOCH",dirCls+"-label")}</g>:null})()}
    {triggerX!=null&&triggerY!=null&&<><circle cx={triggerX} cy={triggerY} r="8" className={dirCls+"-marker"}/>{text(Math.min(width-205,triggerX+10),triggerY,label,dirCls+"-label")}</>}
    {reversal.entryZone&&zone(reversal.entryZone.low,reversal.entryZone.high,Math.max(0,lastIndex-18),lastIndex,"reversal-zone","REVERSAL ZONE")}
    {invalidationY!=null&&<><line x1={x0} x2={xLast} y1={invalidationY} y2={invalidationY} className="reversal-invalidation-line"/>{text(Math.max(8,xLast-110),invalidationY,"REV INVALIDATION","reversal-invalidation-label")}</>}
  </g>;
 })() : null;
 const orderFlowMarker = showOrderFlow ? (() => {
  const bars=orderFlow.recentBars;
  const latest=bars.at(-1);
  const level=(price:number|null|undefined,cls:string,label:string)=>{if(price==null)return null;const y=yOf(price);if(y==null)return null;return <g><line x1={x0} x2={xLast} y1={y} y2={y} className={cls}/>{text(xLast-100,y,label,cls+"-label")}</g>};
  return <g className="orderflow-chart-layer">
   {bars.map((b:any,i:number)=>{const x=xOf(b.index),closeY=yOf(candles[b.index]?.close??0),sweepY=b.sweepPrice!=null?yOf(b.sweepPrice):null;if(x==null)return null;const barH=Math.max(3,Math.min(24,Math.abs(b.deltaRatio)*30));const base=height-16;return <g key={"ofb"+b.index}>
    <line x1={x} x2={x} y1={base} y2={base-(b.deltaRatio>=0?barH:-barH)} className={b.deltaRatio>=0?"orderflow-delta-buy":"orderflow-delta-sell"}/>
    {b.imbalance!=="NONE"&&closeY!=null&&<circle cx={x} cy={closeY} r="5" className={b.imbalance==="BUY"?"of-buy-marker":"of-sell-marker"}/>}
    {b.absorption!=="NONE"&&closeY!=null&&<text x={x+5} y={closeY-8} className="orderflow-absorption-label">{b.absorption==="BUYER"?"ABS BUY":"ABS SELL"}</text>}
    {b.liquiditySweep!=="NONE"&&sweepY!=null&&<g><line x1={x-12} x2={x+12} y1={sweepY} y2={sweepY} className="orderflow-sweep-line"/><text x={x+8} y={sweepY-5} className="orderflow-sweep-label">{b.liquiditySweep==="LOW"?"OF SWEEP LOW":"OF SWEEP HIGH"}</text></g>}
   </g>})}
   {latest&&<g>
    {latest.microStructure!=="NEUTRAL"&&latest.index>=0&&<text x={Math.max(8,(xOf(latest.index)??xLast)-42)} y={latest.microStructure==="BULLISH"?22:height-22} className="orderflow-structure-label">{latest.microStructure==="BULLISH"?"OF BULL BREAK":"OF BEAR BREAK"}</text>}
    {latest.deltaRatio!==0&&<text x={Math.max(8,xLast-170)} y={22} className="orderflow-delta-label">DELTA {(latest.deltaRatio*100).toFixed(1)}% · {latest.imbalance}</text>}
   </g>}
   {level(orderFlow.entry,"orderflow-entry-line","OF ENTRY "+(orderFlow.entry!=null?orderFlow.entry.toFixed(4):"—"))}
   {level(orderFlow.stop,"orderflow-sl-line","OF SL "+(orderFlow.stop!=null?orderFlow.stop.toFixed(4):"—"))}
   {(orderFlow.targets||[]).slice(0,3).map((p:number,i:number)=>level(p,"orderflow-tp-line","OF TP"+(i+1)+" "+p.toFixed(4)))}
   {latest&&orderFlow.direction!=="WAIT"&&<g>{(()=>{const x=xOf(latest.index),y=yOf(candles[latest.index]?.close??0);if(x==null||y==null)return null;const label=orderFlow.direction==="BUY"?"OF BUY CONFIRMED":"OF SELL CONFIRMED";return <><circle cx={x} cy={y} r="8" className={orderFlow.direction==="BUY"?"of-buy-marker":"of-sell-marker"}/>{text(Math.min(x+10,width-125),y,label,"orderflow-signal-label")}</>})()}</g>}
  </g>;
 })() : null;
 const footprintOverlay = showOrderFlow && orderFlow.footprint ? (() => {
  const fp=orderFlow.footprint;
  const fpIndex=candles.findIndex(c=>c.time===fp.candleTime);
  const sourceLevels=[...fp.levels].filter(l=>Number.isFinite(yOf(l.price))).sort((a,b)=>b.totalVolume-a.totalVolume).slice(0,24).sort((a,b)=>a.price-b.price);
  const maxVol=Math.max(...sourceLevels.map(l=>l.totalVolume),1e-12);
  const xBase=Math.min(Math.max(10,(xOf(fpIndex)??xLast)+18),Math.max(10,width-92));
  return <g className="footprint-chart-layer">
   {sourceLevels.map((l,i)=>{const y=yOf(l.price);if(y==null)return null;const buyW=Math.max(2,32*(l.buyVolume/maxVol));const sellW=Math.max(2,32*(l.sellVolume/maxVol));return <g key={"fp"+i}>
    <rect x={xBase-buyW} y={y-3} width={buyW} height="5" rx="1" className="footprint-buy"/>
    <rect x={xBase+2} y={y-3} width={sellW} height="5" rx="1" className="footprint-sell"/>
    <text x={xBase+sellW+5} y={y+3} className="footprint-value">{l.delta>0?"+" : ""}{l.delta.toFixed(2)}</text>
   </g>})}
   {fp.poc!=null&&(()=>{const y=yOf(fp.poc);return y==null?null:<g><line x1={Math.max(0,xBase-38)} x2={Math.min(width,xBase+62)} y1={y} y2={y} className="footprint-poc"/>{text(xBase+3,y,"POC","footprint-poc-label")}</g>})()}
  </g>;
 })() : null;
 const fib=showElliott&&elliott.fibLevels?.length?<>{elliott.fibLevels.slice(0,10).map((f:any,i:number)=>{const y=yOf(f.price);return y==null?null:<g key={"f"+i}><line x1={x0} x2={xLast} y1={y} y2={y} className={f.label==="161.8%"||f.label==="261.8%"?"fib-ext-line":"fib-line"}/>{text(xLast-72,y,f.label,"fib-label")}</g>})}</>:null;
 const wave=showElliott?[
  elliott.primary?drawWave(elliott.primary.points,"impulse-"):null,
  elliott.correction?drawWave(elliott.correction.points.slice(0,3),"abc-","wave-abc-label"):null
 ]:null;
 const smcPanel=showSMC?(
  <div className={`setup-panel smc-setup-panel ${smc.setup.direction.toLowerCase()}`}>
   <div className="setup-head"><span>SMC SETUP LEVELS</span><strong className={smc.setup.status==="ACTIVE"?"setup-active":"setup-wait"}>{smc.setup.status==="ACTIVE"?"ACTIVE":smc.setup.direction==="WAIT"?"WAIT":"WAIT · "+smc.setup.direction}</strong></div>
   <div className="setup-grid">
    <span>Trend<b>{smc.trend}</b></span><span>Score<b>{smc.setup.confidence}/100</b></span><span>Entry<b>{smc.setup.entry!=null?smc.setup.entry.toFixed(4):"—"}</b></span><span>SL<b>{smc.stop!=null?smc.stop.toFixed(4):"—"}</b></span>
    <span>TP1<b>{smc.targets?.[0]?.toFixed(4)||"—"}</b></span><span>TP2<b>{smc.targets?.[1]?.toFixed(4)||"—"}</b></span><span>TP3<b>{smc.targets?.[2]?.toFixed(4)||"—"}</b></span><span>R:R<b>{smc.setup.rr?smc.setup.rr.toFixed(2)+":1":"—"}</b></span>
   </div>
  </div>
 ):null;
 const elitewavePanel=showElliott?(
  <div className={`setup-panel elitewave-setup-panel ${elite?.direction==="bearish"?"bear":""}`}>
   <div className="setup-head"><span>ELITEWAVE COUNT LEVELS</span><strong className={elite?"setup-wait":""}>{elite?"HISTORICAL":"WAIT"}</strong></div>
   {elite&&elite.entry!=null&&elite.invalidation!=null?(
    <>
     <div className="setup-grid">
      <span>Pattern<b>{elliott.pattern}</b></span><span>Degree<b>{elliott.degree}</b></span><span>Phase<b>{elliott.phase}</b></span><span>Quality<b>{elliott.confidence}/100</b></span>
      <span>W2 END<b>{elite.entry.toFixed(4)}</b></span><span>INVALIDATION<b>{elite.invalidation.toFixed(4)}</b></span><span>W3 END<b>{elite.targets?.[0]?.toFixed(4)||"—"}</b></span><span>W5 END<b>{elite.targets?.[1]?.toFixed(4)||"—"}</b></span><span>EXT TARGET<b>{elite.targets?.[2]?.toFixed(4)||"—"}</b></span><span>STATE<b>NOT LIVE</b></span>
     </div>
     <div className="setup-empty">{elliott.setupReason}</div>
    </>
   ):<div className="setup-empty">NO QUALIFIED 1–5 TRADE COUNT</div>}
  </div>
 ):null;
 const fmt=(n:number|null|undefined)=>n==null?"—":n.toLocaleString(undefined,{maximumFractionDigits:8});
 const orderFlowPanel=showOrderFlow?(
  <div className={`setup-panel orderflow-setup-panel ${orderFlow.direction==="SELL"?"bear":""}`}>
   <div className="setup-head"><span>ORDER FLOW SETUP</span><strong className={orderFlow.direction!=="WAIT"?"setup-active":"setup-wait"}>{orderFlow.direction!=="WAIT"?"CONFIRMED":"WAIT"}</strong></div>
   <div className="setup-grid">
    <span>Source<b>{orderFlow.source==="BINANCE_FOOTPRINT"?"FOOTPRINT":"WAIT"}</b></span><span>Signal<b>{orderFlow.direction}</b></span><span>Confidence<b>{orderFlow.confidence}/100</b></span><span>FP Bars<b>{orderFlow.footprintHistoryCount}/12</b></span>
    <span>Buyer P<b>{orderFlow.buyerPressure.toFixed(1)}%</b></span><span>Seller P<b>{orderFlow.sellerPressure.toFixed(1)}%</b></span><span>Delta<b>{fmt(orderFlow.delta)}</b></span><span>FP Imbalance<b>{orderFlow.footprint?("B "+orderFlow.footprint.stackedBuyImbalances+" / S "+orderFlow.footprint.stackedSellImbalances):"—"}</b></span>
    <span>Absorption<b>{orderFlow.absorption}</b></span><span>Liquidity<b>{orderFlow.liquiditySweep}</b></span><span>POC<b>{orderFlow.footprint?.poc!=null?orderFlow.footprint.poc.toFixed(4):"—"}</b></span><span>FP Δ<b>{orderFlow.footprint?orderFlow.footprint.deltaRatio.toFixed(3):"—"}</b></span>
    <span>Entry<b>{fmt(orderFlow.entry)}</b></span><span>SL<b>{fmt(orderFlow.stop)}</b></span><span>TP1<b>{orderFlow.targets[0]?.toFixed(4)||"—"}</b></span><span>TP2<b>{orderFlow.targets[1]?.toFixed(4)||"—"}</b></span><span>TP3<b>{orderFlow.targets[2]?.toFixed(4)||"—"}</b></span>
   </div>
   <div className="setup-empty">{orderFlow.confirmations.length?orderFlow.confirmations.join(" · "):orderFlow.signal}</div>
  </div>
 ):null;
 return (
  <div className="chart-overlay-wrap">
   <div className="analysis-debug">
    ANALYSIS · {candles.length} CLOSED CANDLES · SMC {smc.events.length} BOS/CHOCH · FVG {smc.fvgs.length} · OB {smc.orderBlocks.length} · LIQ {smc.liquidityHighs.length+smc.liquidityLows.length} · REVERSAL {reversal.state} {reversal.direction} {reversal.score}/100 · MTF {mtfReversal.state} {mtfReversal.direction} {mtfReversal.score}/100 · FOOTPRINT {orderFlow.footprintHistoryCount}/12 · ELLIOTT {elliott.primary?(elliott.pattern+" "+elliott.degree):elliott.correction?(elliott.correctionPattern+" CANDIDATE"):"—"}
   </div>
   <svg className="chart-overlay" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
    {showSMC&&<>{zones}{structure}{liquidity}{trade}</>}
    {showElliott&&<>{eliteTrade}{wave}{fib}</>}
    {orderFlowMarker}
    {footprintOverlay}
    {reversalMarker}
    {mtfSignalMarker}
   </svg>
   {smcPanel}
   {elitewavePanel}
   {orderFlowPanel}
  </div>
 );
}

const MemoizedChartAnnotations=memo(ChartAnnotations);

function MetricCard({title,children}:{title:string;children:ReactNode}){return <div className="panel-card metric-card"><div className="section-title">{title}</div>{children}</div>}
function Row({k,v}:{k:string;v:string}){return <div className="data-row"><span>{k}</span><b>{v}</b></div>}
function ScoreRow({label,value}:{label:string;value:number}){return <div className="score-row"><div><span>{label}</span><b>{value}<small>/100</small></b></div><div className="score-track"><i style={{width:`${Math.max(0,Math.min(100,value))}%`}}/></div></div>}
function Stat({k,v}:{k:string;v:string|number}){return <div className="stat-box"><span>{k}</span><b>{v}</b></div>}