"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CandlestickSeries, createChart } from "lightweight-charts";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle } from "../src/analysis/engine";

type Mode = "smc" | "elliott" | "combined";
type BinanceSymbol = { symbol:string;baseAsset:string;quoteAsset:string };
type Derivatives = { openInterest:string; fundingRate:string; change24h:string } | null;
const intervals = ["1m","5m","15m","1h","4h","1d"] as const;
const mtfIntervals = ["4h","1h","15m","5m"];

async function fetchKlines(symbol:string, interval:string, limit=250):Promise<Candle[]>{
 const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
 if(!r.ok) throw new Error(`Binance returned ${r.status}`);
 const rows=await r.json();
 return rows.map((x:any)=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5]}));
}

export default function Home(){
 const [mode,setMode]=useState<Mode>("smc");
 const [symbol,setSymbol]=useState("BTCUSDT");
 const [interval,setInterval]=useState<(typeof intervals)[number]>("15m");
 const [candles,setCandles]=useState<Candle[]>([]);
 const [pairs,setPairs]=useState<BinanceSymbol[]>([]);
 const [pairSearch,setPairSearch]=useState("");
 const [quoteFilter,setQuoteFilter]=useState("USDT");
 const [mtfCandles,setMtfCandles]=useState<{interval:string;candles:Candle[]}[]>([]);
 const [connected,setConnected]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [derivatives,setDerivatives]=useState<Derivatives>(null);
 const [chartReady,setChartReady]=useState(false);
 const [viewportTick,setViewportTick]=useState(0);
 const [layers,setLayers]=useState({structure:true,zones:true,liquidity:true,trade:true});

 const chartRef=useRef<HTMLDivElement>(null);
 const chartObj=useRef<any>(null);
 const seriesRef=useRef<any>(null);

 const smc=useMemo(()=>analyzeSMC(candles),[candles]);
 const elliott=useMemo(()=>analyzeElliott(candles),[candles]);
 const mtf=useMemo(()=>analyzeMTF(mtfCandles),[mtfCandles]);
 const combined=Math.round((smc.score+elliott.score)/2);
 const last=candles.at(-1),previous=candles.at(-2);
 const priceChange=last&&previous?((last.close-previous.close)/previous.close)*100:0;

 useEffect(()=>{
  let stop=false;
  fetch("https://api.binance.com/api/v3/exchangeInfo").then(r=>r.json()).then(d=>{
   if(stop)return;
   setPairs((d.symbols||[]).filter((x:any)=>x.status==="TRADING").map((x:any)=>({symbol:x.symbol,baseAsset:x.baseAsset,quoteAsset:x.quoteAsset})));
  }).catch(()=>{});
  return()=>{stop=true};
 },[]);

 useEffect(()=>{
  const controller=new AbortController();
  setMtfCandles([]);
  Promise.all(mtfIntervals.map(async tf=>{
   try{return {interval:tf,candles:await fetchKlines(symbol,tf,180)}}
   catch{return {interval:tf,candles:[]}}
  })).then(rows=>{if(!controller.signal.aborted)setMtfCandles(rows)});
  return()=>controller.abort();
 },[symbol]);

 useEffect(()=>{
  let ws:WebSocket|undefined,stop=false,retry:ReturnType<typeof setTimeout>|undefined;
  setCandles([]);setConnected(false);setLoading(true);setError("");
  const connect=()=>{
   if(stop)return;
   ws=new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);
   ws.onopen=()=>setConnected(true);
   ws.onclose=()=>{setConnected(false);if(!stop)retry=setTimeout(connect,2500)};
   ws.onerror=()=>setConnected(false);
   ws.onmessage=e=>{
    try{
     const k=JSON.parse(e.data).k;if(!k)return;
     const c={time:+k.t,open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};
     setCandles(p=>{const a=[...p],i=a.findIndex(x=>x.time===c.time);if(i>=0)a[i]=c;else a.push(c);return a.slice(-250)});
    }catch{}
   };
  };
  fetchKlines(symbol,interval,250).then(data=>{if(stop)return;setCandles(data);setLoading(false);connect()}).catch(e=>{if(!stop){setLoading(false);setError(e instanceof Error?e.message:"Market data error")}});
  return()=>{stop=true;if(retry)clearTimeout(retry);ws?.close()};
 },[symbol,interval]);

 useEffect(()=>{
  if(!chartRef.current)return;
  const host=chartRef.current;
  const chart=createChart(host,{
   autoSize:true,height:500,
   layout:{background:{color:"#0b0f15"},textColor:"#8792a5"},
   grid:{vertLines:{color:"#151b25"},horzLines:{color:"#151b25"}},
   rightPriceScale:{borderColor:"#26303f",scaleMargins:{top:.08,bottom:.08}},
   timeScale:{borderColor:"#26303f",timeVisible:true,secondsVisible:false,rightOffset:6,barSpacing:8},
   crosshair:{mode:0},
   handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},
   handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}
  });
  const series=chart.addSeries(CandlestickSeries,{upColor:"#36d399",downColor:"#f06b78",borderVisible:false,wickUpColor:"#36d399",wickDownColor:"#f06b78",priceLineVisible:true,lastValueVisible:true});
  chartObj.current=chart;seriesRef.current=series;setChartReady(true);
  const onViewport=()=>setViewportTick(v=>v+1);
  chart.timeScale().subscribeVisibleLogicalRangeChange(onViewport);
  const ro=new ResizeObserver(()=>setViewportTick(v=>v+1));ro.observe(host);
  return()=>{ro.disconnect();try{chart.timeScale().unsubscribeVisibleLogicalRangeChange(onViewport)}catch{};chart.remove();chartObj.current=null;seriesRef.current=null;setChartReady(false)};
 },[]);

 useEffect(()=>{
  const series=seriesRef.current;if(!series||candles.length<2)return;
  series.setData(candles.map(c=>({time:Math.floor(c.time/1000) as any,open:c.open,high:c.high,low:c.low,close:c.close})));
 },[candles]);

 useEffect(()=>{if(chartObj.current&&candles.length)chartObj.current.timeScale().fitContent()},[symbol,interval]);

 const filtered=pairs.filter(p=>(quoteFilter==="ALL"||p.quoteAsset===quoteFilter)&&p.symbol.includes(pairSearch)).slice(0,500);
 const resetChart=()=>chartObj.current?.timeScale().fitContent();
 const toggle=(k:keyof typeof layers)=>setLayers(v=>({...v,[k]:!v[k]}));

 return <main className="app-shell">
  <header className="topbar">
   <div className="brand-block"><div className="brand">QUANT<span>STRUCTURE</span></div><div className="subtitle">Professional market-structure & wave analysis workstation</div></div>
   <div className="market-selector">
    <div className="selector-search"><span>⌕</span><input value={pairSearch} onChange={e=>setPairSearch(e.target.value.toUpperCase())} placeholder="Search symbol"/></div>
    <select value={quoteFilter} onChange={e=>setQuoteFilter(e.target.value)}><option>USDT</option><option>USDC</option><option>BTC</option><option>FDUSD</option><option>ALL</option></select>
    <select value={symbol} onChange={e=>setSymbol(e.target.value)}>{filtered.length?filtered.map(p=><option key={p.symbol}>{p.symbol}</option>):<option>{symbol}</option>}</select>
   </div>
   <div className="top-status"><span className="data-status"><i className={connected?"pulse live-dot":"live-dot"}/>{connected?"LIVE DATA":"CONNECTING"}</span><span className="source-badge">BINANCE</span></div>
  </header>

  <section className="controlbar">
   <div className="instrument"><strong>{symbol}</strong><span>{interval}</span>{last&&<b>{last.close.toLocaleString(undefined,{maximumFractionDigits:8})}</b>}{last&&<em className={priceChange>=0?"positive":"negative"}>{priceChange>=0?"+":""}{priceChange.toFixed(2)}%</em>}</div>
   <div className="timeframes">{intervals.map(t=><button className={interval===t?"active":""} onClick={()=>setInterval(t)} key={t}>{t}</button>)}</div>
   <div className="analysis-tabs">{([["smc","SMC"],["elliott","ELLIOTT WAVE"],["combined","COMBINED"]] as const).map(([k,l])=><button className={mode===k?"active":""} onClick={()=>setMode(k)} key={k}>{l}</button>)}</div>
  </section>

  <section className="toolbar">
   <div className="toolbar-title">CHART LAYERS</div>
   {([["structure","STRUCTURE"],["zones","FVG / OB"],["liquidity","LIQUIDITY"],["trade","SETUP LEVELS"]] as const).map(([k,l])=><button className={layers[k]?"layer-on":""} onClick={()=>toggle(k)} key={k}><i/>{l}</button>)}
   <span className="toolbar-note">SMC and Elliott engines remain independent</span>
  </section>

  {error&&<div className="alert">{error}</div>}

  <section className="terminal-grid">
   <div className="chart-column">
    <div className="panel-card chart-card">
     <div className="panel-header"><div><span className="eyebrow">PRICE ACTION</span><h2>{symbol} <small>{interval}</small></h2></div><div className="chart-actions"><span>{candles.length} candles</span><button onClick={resetChart}>RESET VIEW</button></div></div>
     <div className="chart-wrap">
      <div className="chartarea" ref={chartRef}/>
      {chartReady&&<ChartAnnotations chart={chartObj.current} host={chartRef.current} candles={candles} smc={smc} elliott={elliott} mode={mode} tick={viewportTick} layers={layers}/>}
      {loading&&<div className="chart-loading"><span/>Loading market data…</div>}
     </div>
     <div className="chart-footer"><span><i className="legend-dot smc-dot"/> SMC</span><span><i className="legend-dot wave-dot"/> Elliott</span><span><i className="legend-dot liq-dot"/> Liquidity</span><span className="chart-tip">Wheel/pinch: zoom · drag: pan</span></div>
    </div>

    <div className="metric-grid">
     <MetricCard title="MARKET STRUCTURE"><Row k="Trend" v={smc.trend}/><Row k="Swing" v={smc.pivots.at(-1)?.label||"—"}/><Row k="BOS / CHOCH" v={smc.events.at(-1)?.type||"None"}/><Row k="Displacement" v={smc.displacement.toFixed(2)+"× ATR"}/></MetricCard>
     <MetricCard title="LIQUIDITY & ZONES"><Row k="FVG" v={String(smc.fvgs.filter(x=>!x.filled).length)+" active"}/><Row k="Order Blocks" v={String(smc.orderBlocks.filter(x=>!x.mitigated).length)+" active"}/><Row k="EQH / EQL" v={smc.equalHighs.length+" / "+smc.equalLows.length}/><Row k="Sweeps" v={String(smc.sweeps.length)}/></MetricCard>
     <MetricCard title="MODEL SCORES"><ScoreRow label="SMC" value={smc.score}/><ScoreRow label="ELLIOTT" value={elliott.score}/><ScoreRow label="MTF" value={mtf.score}/><ScoreRow label="COMBINED" value={combined}/></MetricCard>
    </div>
   </div>

   <aside className="analysis-column">
    <div className="panel-card analysis-card">
     <div className="panel-header compact"><div><span className="eyebrow">ENGINE OUTPUT</span><h2>{mode==="smc"?"SMC ANALYSIS":mode==="elliott"?"ELLIOTT WAVE":"COMBINED ANALYSIS"}</h2></div><span className="mode-badge">{mode.toUpperCase()}</span></div>
     {(mode==="smc"||mode==="combined")&&<div className="section-block">
      <div className="section-title">SMART MONEY CONCEPT</div><Row k="Trend" v={smc.trend}/><Row k="Premium / Discount" v={smc.premiumDiscount}/><Row k="Structure events" v={String(smc.events.length)}/><Row k="Active FVG / OB" v={smc.fvgs.filter(x=>!x.filled).length+" / "+smc.orderBlocks.filter(x=>!x.mitigated).length}/><Row k="Setup" v={smc.setup.direction}/><Row k="Confidence" v={smc.setup.confidence+"/100"}/><Row k="Confirmations" v={String(smc.setup.confirmations.length)}/>
      {smc.setup.confirmations.length>0&&<div className="confirmation-list">{smc.setup.confirmations.slice(0,6).map(x=><div key={x}>✓ {x}</div>)}</div>}
     </div>}
     {(mode==="elliott"||mode==="combined")&&<div className="section-block">
      <div className="section-title">ELLIOTT WAVE</div><Row k="Phase" v={elliott.phase}/><Row k="Primary" v={elliott.primary?elliott.primary.points.map(p=>p.label).join(" → "):"No candidate"}/><Row k="Direction" v={elliott.primary?.direction||"—"}/><Row k="Alternative" v={elliott.alternative?"Available":"None"}/><Row k="ABC" v={elliott.correction?"Candidate":"None"}/><Row k="Confidence" v={elliott.confidence+"/100"}/><Row k="Invalidation" v={elliott.primary?.invalidation.toFixed(4)||"—"}/>
      {elliott.fib&&<div className="mini-fib"><span>W2 {elliott.fib.w2}</span><span>W3 {elliott.fib.w3}</span><span>W4 {elliott.fib.w4}</span><span>W5 {elliott.fib.w5}</span></div>}
     </div>}
     {mode==="combined"&&<div className="confluence-box"><div><span>INDEPENDENT CONFLUENCE</span><strong>{combined}<small>/100</small></strong></div><p>SMC, Elliott and MTF are displayed as separate evidence streams; no automatic trade execution.</p></div>}
    </div>

    <div className="panel-card mtf-card"><div className="section-title">MULTI-TIMEFRAME CONTEXT</div>{mtf.frames.map(f=><div className="mtf-row" key={f.interval}><span>{f.interval}</span><b className={f.trend==="Bullish"?"positive":f.trend==="Bearish"?"negative":""}>{f.trend}</b><small>{f.structure} · {f.score}</small></div>)}</div>

    <div className="panel-card mtf-card"><div className="section-title">DERIVATIVES SNAPSHOT</div><div className="mtf-row"><span>Open Interest</span><b>{derivatives?Number(derivatives.openInterest).toLocaleString(undefined,{maximumFractionDigits:2}):"—"}</b><small>Futures</small></div><div className="mtf-row"><span>Funding</span><b>{derivatives?Number(derivatives.fundingRate).toFixed(5):"—"}</b><small>8h rate</small></div><div className="mtf-row"><span>24h</span><b className={derivatives&&Number(derivatives.change24h)>=0?"positive":"negative"}>{derivatives?Number(derivatives.change24h).toFixed(2)+"%":"—"}</b><small>Futures</small></div></div>

 <div className="panel-card feed-card"><div className="section-title">SYSTEM STATUS</div><div className="status-line"><span>REST API</span><b className="positive">CONNECTED</b></div><div className="status-line"><span>WebSocket</span><b className={connected?"positive":"negative"}>{connected?"LIVE":"RECONNECTING"}</b></div><div className="status-line"><span>Analysis engine</span><b className="positive">READY</b></div><div className="status-line"><span>Execution</span><b>DISABLED</b></div></div>
   </aside>
  </section>

  <footer className="footer"><span>QUANTSTRUCTURE · MARKET ANALYSIS WORKSTATION</span><span>Binance market data · analysis only · not financial advice</span></footer>
 </main>;
}

function ChartAnnotations({chart,host,candles,smc,elliott,mode,tick,layers}:{chart:any;host:HTMLElement|null;candles:Candle[];smc:any;elliott:any;mode:Mode;tick:number;layers:{structure:boolean;zones:boolean;liquidity:boolean;trade:boolean}}){
 const width=host?.clientWidth||0,height=host?.clientHeight||0;
 if(!chart||candles.length<2||!width||!height)return null;
 const ts=chart.timeScale(),ps=chart.priceScale("right"),lastIndex=candles.length-1;
 const xOf=(i:number)=>i>=0&&i<candles.length?ts.timeToCoordinate(Math.floor(candles[i].time/1000) as any):null;
 const yOf=(p:number)=>ps.priceToCoordinate(p);
 const xLast=xOf(lastIndex)??width,x0=Math.max(0,xOf(0)??0);
 const label=(x:number|null,y:number|null,text:string,cls:string)=>x==null||y==null?null:<g><rect x={x-4} y={y-14} width={Math.max(36,text.length*6.1+10)} height="18" rx="4" className={cls}/><text x={x+1} y={y-2} className="chart-label">{text}</text></g>;
 const zone=(low:number,high:number,start?:number,end?:number,cls="fvg-bull",title="ZONE")=>{const a=Math.max(0,Math.min(lastIndex,start??lastIndex-40)),b=Math.max(a,Math.min(lastIndex,end??lastIndex)),xa=xOf(a)??x0,xb=xOf(b)??xLast,y1=yOf(high),y2=yOf(low);if(y1==null||y2==null)return null;return <g><rect x={Math.min(xa,xb)} y={Math.min(y1,y2)} width={Math.max(2,Math.abs(xb-xa))} height={Math.max(2,Math.abs(y2-y1))} className={cls}/>{label(Math.min(xa,xb)+5,Math.min(y1,y2)+18,title,cls+"-label")}</g>};

 const smcVisible=mode!=="elliott";
 const structures=smcVisible&&layers.structure?<>
  {smc.events.slice(-10).map((e:any,i:number)=>{const x=xOf(e.index),y=yOf(e.price);if(x==null||y==null)return null;const bull=e.direction==="bullish",ay=bull?Math.max(22,y-25):Math.min(height-22,y+25),d=bull?`M ${x-7} ${ay+7} L ${x} ${ay} L ${x+7} ${ay+7}`:`M ${x-7} ${ay-7} L ${x} ${ay} L ${x+7} ${ay-7}`;return <g key={"e"+i}><line x1={x} x2={x} y1={Math.min(y,ay)} y2={Math.max(y,ay)} className={e.type==="CHOCH"?"choch-line":"bos-line"}/><path d={d} className={e.type==="CHOCH"?"choch-arrow":"bos-arrow"}/>{label(x+8,ay,e.type+" · "+(bull?"BULL":"BEAR"),e.type==="CHOCH"?"choch-label":"bos-label")}</g>})}
  {smc.pivots.slice(-14).map((p:any,i:number)=>{const x=xOf(p.index),y=yOf(p.price);return x==null||y==null?null:<g key={"p"+i}>{label(x,y,p.label||"", "pivot-label")}</g>})}
 </>:null;

 const zones=smcVisible&&layers.zones?<>
  {smc.fvgs.slice(-7).map((z:any,i:number)=>zone(z.low,z.high,z.from,z.filled&&z.fillIndex!==undefined?z.fillIndex:lastIndex,z.type==="bullish"?"fvg-bull":"fvg-bear",z.filled?"FVG ✓":"FVG"))}
  {smc.orderBlocks.slice(-5).map((o:any,i:number)=>zone(o.low,o.high,o.index,o.mitigated&&o.mitigationIndex!==undefined?o.mitigationIndex:lastIndex,o.type==="bullish"?"ob-bull":"ob-bear",o.type==="bullish"?"BULL OB":"BEAR OB"))}
  {smc.breakers.slice(-4).map((b:any,i:number)=>zone(b.low,b.high,b.index,lastIndex,b.type==="bullish"?"breaker-bull":"breaker-bear",b.type==="bullish"?"BULL BREAKER":"BEAR BREAKER"))}
 </>:null;

 const liquidity=smcVisible&&layers.liquidity?<>
  {[...smc.liquidityHighs.slice(-4).map((p:any)=>({...p,t:"EQH / LIQ HIGH"})),...smc.liquidityLows.slice(-4).map((p:any)=>({...p,t:"EQL / LIQ LOW"}))].map((p:any,i:number)=>{const x=xOf(p.index)??x0,y=yOf(p.price);return y==null?null:<g key={"l"+i}><line x1={x} x2={xLast} y1={y} y2={y} className="liquidity-line"/>{label(x+5,y,p.t,"liquidity-label")}</g>})}
  {smc.sweeps.slice(-8).map((s:any,i:number)=>{const x=xOf(s.index),y=yOf(s.price);if(x==null||y==null)return null;const high=s.type==="high",ty=high?y-22:y+22,d=high?`M ${x-8} ${ty-7} L ${x} ${ty} L ${x+8} ${ty-7}`:`M ${x-8} ${ty+7} L ${x} ${ty} L ${x+8} ${ty+7}`;return <g key={"s"+i}><line x1={x} x2={x} y1={y} y2={ty} className="sweep-mark"/><path d={d} className="sweep-arrow"/>{label(x+8,ty,high?"HIGH SWEEP":"LOW SWEEP","sweep-label")}</g>})}
 </>:null;

 const trade=smcVisible&&layers.trade&&smc.entryZone?<>
  {zone(smc.entryZone.low,smc.entryZone.high,Math.max(0,lastIndex-20),lastIndex,"entry-zone","ENTRY ZONE")}
  {smc.stop!=null&&(()=>{const y=yOf(smc.stop);return y==null?null:<g><line x1={x0} x2={xLast} y1={y} y2={y} className="sl-line"/>{label(xLast-70,y,"SL "+smc.stop.toFixed(4),"sl-label")}</g>})()}
  {(smc.targets||[]).slice(0,4).map((p:number,i:number)=>{const y=yOf(p);return y==null?null:<g key={"tp"+i}><line x1={xLast-130} x2={xLast} y1={y} y2={y} className="tp-line"/>{label(xLast-100,y,"TP"+(i+1)+" "+p.toFixed(4),"tp-label")}</g>})}
 </>:null;

 const wave=mode!=="smc"&&elliott.primary?<>{elliott.primary.points.map((p:any,i:number)=>{const x=xOf(p.index),y=yOf(p.price),n=elliott.primary.points[i+1],nx=n?xOf(n.index):null,ny=n?yOf(n.price):null;if(x==null||y==null)return null;return <g key={"w"+i}>{nx!=null&&ny!=null&&<line x1={x} y1={y} x2={nx} y2={ny} className="wave-line"/>}{label(x,y,p.label,"wave-label")}</g>})}</>:null;

 const fib=mode!=="smc"&&elliott.fibLevels?.length?<>{elliott.fibLevels.map((f:any,i:number)=>{const y=yOf(f.price);return y==null?null:<g key={"f"+i}><line x1={x0} x2={xLast} y1={y} y2={y} className={f.label==="161.8%"||f.label==="261.8%"?"fib-ext-line":"fib-line"}/>{label(xLast-82,y,f.label+" "+f.price.toFixed(4),f.label==="161.8%"||f.label==="261.8%"?"fib-ext-label":"fib-label")}</g>})}</>:null;

 const setup=smc.setup.direction,entry=smc.setup.entry,rr=smc.setup.rr;
 return <div className="chart-overlay-wrap"><svg key={tick} className="chart-overlay" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{zones}{structures}{liquidity}{trade}{wave}{fib}</svg>{smcVisible&&<div className={`setup-panel ${setup.toLowerCase()}`}><div className="setup-head"><span>SMC SETUP</span><strong>{setup}</strong></div><div className="setup-grid"><span>Trend<b>{smc.trend}</b></span><span>Confidence<b>{smc.setup.confidence}/100</b></span><span>Entry<b>{entry!=null?entry.toFixed(4):"—"}</b></span><span>SL<b>{smc.stop!=null?smc.stop.toFixed(4):"—"}</b></span><span>TP1<b>{smc.targets?.[0]?.toFixed(4)||"—"}</b></span><span>R:R<b>{rr!=null?rr.toFixed(2)+":1":"—"}</b></span></div><div className="setup-foot">{smc.setup.confirmations.slice(0,2).join(" · ")||"Waiting for confluence"} </div></div>}</div>;
}

function MetricCard({title,children}:{title:string;children:ReactNode}){return <div className="panel-card metric-card"><div className="section-title">{title}</div>{children}</div>}
function Row({k,v}:{k:string;v:string}){return <div className="data-row"><span>{k}</span><b>{v}</b></div>}
function ScoreRow({label,value}:{label:string;value:number}){return <div className="score-row"><div><span>{label}</span><b>{value}<small>/100</small></b></div><div className="score-track"><i style={{width:`${Math.max(0,Math.min(100,value))}%`}}/></div></div>}
