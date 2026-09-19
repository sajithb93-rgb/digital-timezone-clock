"use client";
import { useEffect,useMemo,useRef,useState } from "react";
import { createChart,CandlestickSeries,LineSeries,LineStyle,createSeriesMarkers } from "lightweight-charts";
import { analyzeSMC,analyzeElliott,Candle } from "../src/analysis/engine";

type Mode="smc"|"elliott"|"combined";
type BinanceSymbol={symbol:string;baseAsset:string;quoteAsset:string};
const intervals=["1m","5m","15m","1h","4h","1d"] as const;

export default function Home(){
 const [mode,setMode]=useState<Mode>("smc"),[symbol,setSymbol]=useState("BTCUSDT"),[interval,setInterval]=useState<(typeof intervals)[number]>("15m");
 const [candles,setCandles]=useState<Candle[]>([]),[pairs,setPairs]=useState<BinanceSymbol[]>([]),[pairSearch,setPairSearch]=useState(""),[quoteFilter,setQuoteFilter]=useState("USDT");
 const [connected,setConnected]=useState(false),[error,setError]=useState("");
 const chartRef=useRef<HTMLDivElement>(null),chartObj=useRef<any>(null),seriesRef=useRef<any>(null),overlayRef=useRef<any[]>([]),markersRef=useRef<any>(null);
 const smc=useMemo(()=>analyzeSMC(candles),[candles]),elliott=useMemo(()=>analyzeElliott(candles),[candles]);

 useEffect(()=>{let stop=false;fetch("https://api.binance.com/api/v3/exchangeInfo").then(r=>r.json()).then(d=>{if(stop)return;setPairs((d.symbols||[]).filter((x:any)=>x.status==="TRADING").map((x:any)=>({symbol:x.symbol,baseAsset:x.baseAsset,quoteAsset:x.quoteAsset})))}).catch(()=>{});return()=>{stop=true}},[]);

 useEffect(()=>{let ws:WebSocket|undefined,stop=false,retry:any;setCandles([]);setConnected(false);
  const load=async()=>{try{setError("");const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=250`);if(!r.ok)throw Error("Binance REST error");const rows=await r.json();if(stop)return;setCandles(rows.map((x:any)=>({time:x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5]})));
   const connect=()=>{if(stop)return;ws=new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);ws.onopen=()=>setConnected(true);ws.onclose=()=>{setConnected(false);if(!stop)retry=setTimeout(connect,2500)};ws.onerror=()=>setConnected(false);ws.onmessage=e=>{const k=JSON.parse(e.data).k;if(!k)return;const c={time:k.t,open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};setCandles(p=>{const a=[...p],i=a.findIndex(x=>x.time===c.time);if(i>=0)a[i]=c;else a.push(c);return a.slice(-250)})}};connect()
  }catch(e){if(!stop)setError(e instanceof Error?e.message:"Data error")}};load();return()=>{stop=true;if(retry)clearTimeout(retry);ws?.close()}},[symbol,interval]);

 useEffect(()=>{if(!chartRef.current)return;const el=chartRef.current;
  const chart=createChart(el,{autoSize:true,height:470,layout:{background:{color:"#0e131c"},textColor:"#8d99ad"},grid:{vertLines:{color:"#151d29"},horzLines:{color:"#151d29"}},rightPriceScale:{borderColor:"#263143"},timeScale:{borderColor:"#263143",timeVisible:true},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}});
  const series=chart.addSeries(CandlestickSeries,{upColor:"#49d88b",downColor:"#ef6b73",borderVisible:false,wickUpColor:"#49d88b",wickDownColor:"#ef6b73"});
  chartObj.current=chart;seriesRef.current=series;
  return()=>{overlayRef.current.forEach(x=>{try{series.removePriceLine(x)}catch{}});overlayRef.current=[];chart.remove();chartObj.current=null;seriesRef.current=null}
 },[]);

 useEffect(()=>{const chart=chartObj.current,series=seriesRef.current;if(!chart||!series||candles.length<2)return;
  series.setData(candles.map(c=>({time:Math.floor(c.time/1000) as any,open:c.open,high:c.high,low:c.low,close:c.close})));
  overlayRef.current.forEach(x=>{try{series.removePriceLine(x)}catch{}});overlayRef.current=[];
  if(mode!=="elliott"){smc.events.slice(-6).forEach(e=>overlayRef.current.push(series.createPriceLine({price:e.price,color:e.direction==="bullish"?"#49d88b":"#ef6b73",lineWidth:1 as any,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:e.type})));
   smc.orderBlocks.slice(-4).forEach(o=>{overlayRef.current.push(series.createPriceLine({price:o.low,color:o.type==="bullish"?"#49d88b":"#ef6b73",lineWidth:1 as any,lineStyle:LineStyle.Dotted,axisLabelVisible:true,title:"OB"}));overlayRef.current.push(series.createPriceLine({price:o.high,color:o.type==="bullish"?"#49d88b":"#ef6b73",lineWidth:1 as any,lineStyle:LineStyle.Dotted,axisLabelVisible:false,title:""}))});
   smc.fvgs.slice(-4).forEach(x=>{overlayRef.current.push(series.createPriceLine({price:x.low,color:"#5da9ff",lineWidth:1 as any,lineStyle:LineStyle.Dotted,axisLabelVisible:true,title:x.filled?"FVG✓":"FVG"}));overlayRef.current.push(series.createPriceLine({price:x.high,color:"#5da9ff",lineWidth:1 as any,lineStyle:LineStyle.Dotted,axisLabelVisible:false,title:""}))});
   smc.liquidityHighs.slice(-3).forEach(p=>overlayRef.current.push(series.createPriceLine({price:p.price,color:"#d8b35c",lineWidth:1 as any,lineStyle:LineStyle.Dotted,axisLabelVisible:true,title:"LQH"})));
   smc.liquidityLows.slice(-3).forEach(p=>overlayRef.current.push(series.createPriceLine({price:p.price,color:"#d8b35c",lineWidth:1 as any,lineStyle:LineStyle.Dotted,axisLabelVisible:true,title:"LQL"})));
  }
  if(mode!=="smc"&&elliott.primary){const ls=chart.addSeries(LineSeries,{lineWidth:2,color:"#c084fc",crosshairMarkerVisible:true});const pts=elliott.primary.points.map(p=>({time:Math.floor(candles[p.index].time/1000) as any,value:p.price}));ls.setData(pts);overlayRef.current.push({remove:()=>chart.removeSeries(ls)});}
  if(markersRef.current){try{markersRef.current.setMarkers([])}catch{}}
  const markers=smc.sweeps.filter(s=>candles[s.index]).map(s=>({time:Math.floor(candles[s.index].time/1000) as any,position:s.type==="low"?"belowBar":"aboveBar",color:"#d8b35c",shape:s.type==="low"?"arrowUp":"arrowDown",text:"SWEEP"}));
  try{if(!markersRef.current)markersRef.current=createSeriesMarkers(series,markers as any);else markersRef.current.setMarkers(markers as any)}catch{}
 },[candles,mode,smc,elliott]);

 useEffect(()=>{if(chartObj.current&&candles.length){chartObj.current.timeScale().fitContent()}},[symbol,interval]);

 const filtered=pairs.filter(p=>(quoteFilter==="ALL"||p.quoteAsset===quoteFilter)&&p.symbol.includes(pairSearch)).slice(0,500);
 const combined=Math.round((smc.score+elliott.score)/2);
 return <main className="page">
  <header className="top"><div><div className="brand">QUANT<span>STRUCTURE</span></div><small>Live Crypto Market Analysis</small></div>
   <div className="pairpicker"><input value={pairSearch} onChange={e=>setPairSearch(e.target.value.toUpperCase())} placeholder="Search pair..."/><select value={quoteFilter} onChange={e=>setQuoteFilter(e.target.value)}><option value="USDT">USDT</option><option value="USDC">USDC</option><option value="BTC">BTC</option><option value="FDUSD">FDUSD</option><option value="ALL">ALL</option></select><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{filtered.map(p=><option key={p.symbol}>{p.symbol}</option>)}</select></div>
   <div className="tf">{intervals.map(t=><button className={interval===t?"active":""} onClick={()=>setInterval(t)} key={t}>{t}</button>)}</div><span className={connected?"live":"offline"}>{connected?"● LIVE":"○ OFFLINE"}</span>
  </header>
  <section className="tabs"><button className={mode==="smc"?"selected":""} onClick={()=>setMode("smc")}>SMC</button><button className={mode==="elliott"?"selected":""} onClick={()=>setMode("elliott")}>ELLIOTT WAVE</button><button className={mode==="combined"?"selected":""} onClick={()=>setMode("combined")}>COMBINED</button></section>
  {error&&<div className="error card">{error}</div>}
  <section className="workspace"><div className="maincol"><div className="card chart"><div className="cardhead"><b>{symbol} · {interval}</b><span>250 candles · {pairs.length.toLocaleString()} active pairs</span></div><div className="chartarea" ref={chartRef}/><div className="charthelp">Scroll / pinch = zoom · drag = move · double-click = reset view</div></div>
   <div className="quickgrid"><div className="card"><h3>Market</h3><Row k="Trend" v={smc.trend}/><Row k="Structure" v={smc.pivots.at(-1)?.label||"—"}/><Row k="BOS / CHOCH" v={smc.events.at(-1)?.type||"None"}/></div><div className="card"><h3>Levels</h3><Row k="FVG" v={String(smc.fvgs.filter(x=>!x.filled).length)}/><Row k="Order Blocks" v={String(smc.orderBlocks.filter(x=>!x.mitigated).length)}/><Row k="Liquidity" v={`${smc.liquidityHighs.length}H / ${smc.liquidityLows.length}L`}/></div><div className="card"><h3>Scores</h3><Row k="SMC Score" v={smc.score+"/100"}/><Row k="Wave Score" v={elliott.score+"/100"}/><Row k="Confluence" v={combined+"/100"}/></div></div>
  </div><aside className="panel card"><h3>{mode==="smc"?"SMC ANALYSIS":mode==="elliott"?"ELLIOTT WAVE":"COMBINED ANALYSIS"}</h3>
   {(mode==="smc"||mode==="combined")&&<><Row k="Trend" v={smc.trend}/><Row k="P/D" v={smc.premiumDiscount}/><Row k="Sweeps" v={String(smc.sweeps.length)}/>{smc.entryZone&&<><Row k="Entry zone" v={`${smc.entryZone.low.toFixed(2)} – ${smc.entryZone.high.toFixed(2)}`}/><Row k="SL" v={smc.stop?.toFixed(2)||"—"}/><Row k="Targets" v={smc.targets.map(x=>x.toFixed(2)).join(" · ")||"—"}/></>}</>}
   {(mode==="elliott"||mode==="combined")&&<><Row k="Phase" v={elliott.phase}/><Row k="Primary" v={elliott.primary?elliott.primary.points.map(p=>p.label).join(" → "):"No candidate"}/><Row k="Direction" v={elliott.primary?.direction||"—"}/><Row k="Alternative" v={elliott.alternative?"Available":"None"}/><Row k="ABC" v={elliott.correction?"Candidate":"None"}/><Row k="Invalidation" v={elliott.primary?.invalidation.toFixed(2)||"—"}/><Row k="Wave Score" v={elliott.score+"/100"}/></>}
   {mode==="combined"&&<div className="combined"><b>Confluence</b><strong>{combined}/100</strong><small>SMC + Elliott alignment only.</small></div>}
  </aside></section>
  <section className="bottom"><div className="card"><h3>Data Feed</h3><p>Binance REST + WebSocket</p><small>Only the selected pair uses the live kline stream.</small></div><div className="card"><h3>Analysis</h3><div className="signal">ANALYSIS ONLY</div><small>No automatic order execution.</small></div></section>
 </main>
}
function Row({k,v}:{k:string,v:string}){return <div className="row"><span>{k}</span><b>{v}</b></div>}
