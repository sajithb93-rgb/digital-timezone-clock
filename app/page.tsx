"use client";

import "./globals.css";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle } from "../src/analysis/engine";
import { confluence, detectRegime, flowSnapshot, riskPlan, runSMCBacktest } from "../src/analysis/advanced";

type Mode="smc"|"elliott"|"combined";
type BinanceSymbol={symbol:string;baseAsset:string;quoteAsset:string;minQty:number;maxQty:number;stepSize:number;minNotional:number;maxNotional:number};
type Derivatives={openInterest:string;fundingRate:string;change24h:string}|null;
type Ticker={symbol:string,priceChangePercent:number,quoteVolume:number};
const intervals=["1m","5m","15m","1h","4h","1d"] as const;
const mtfIntervals=["4h","1h","15m","5m"];

async function fetchKlines(symbol:string,interval:string,limit=300):Promise<Candle[]>{
 const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
 if(!r.ok)throw new Error(`Binance returned ${r.status}`);
 const rows=await r.json();
 return rows.map((x:any)=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],takerBuyVolume:+x[9]}));
}

export default function Home(){
 const [mode,setMode]=useState<Mode>("smc"),[symbol,setSymbol]=useState("BTCUSDT"),[interval,setInterval]=useState<(typeof intervals)[number]>("15m");
 const [theme,setTheme]=useState<"tradingview"|"cyber">("tradingview");

 const [candles,setCandles]=useState<Candle[]>([]),[analysisCandles,setAnalysisCandles]=useState<Candle[]>([]),[pairs,setPairs]=useState<BinanceSymbol[]>([]);
 const [pairSearch,setPairSearch]=useState(""),[quoteFilter,setQuoteFilter]=useState("USDT"),[mtfCandles,setMtfCandles]=useState<{interval:string;candles:Candle[]}[]>([]);
 const [connected,setConnected]=useState(false),[restConnected,setRestConnected]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(""),[derivatives,setDerivatives]=useState<Derivatives>(null);
 const [chartReady,setChartReady]=useState(false),[viewportTick,setViewportTick]=useState(0),[layers,setLayers]=useState({structure:true,zones:true,liquidity:true,trade:true});
 const [account,setAccount]=useState(1000),[riskPercent,setRiskPercent]=useState(1),[backtest,setBacktest]=useState<any>(null),[scanner,setScanner]=useState<Ticker[]>([]);
 const chartRef=useRef<HTMLDivElement>(null),chartWrapRef=useRef<HTMLDivElement>(null),chartObj=useRef<any>(null),seriesRef=useRef<any>(null);

 const smc=useMemo(()=>analyzeSMC(analysisCandles),[analysisCandles]);
 const elliott=useMemo(()=>analyzeElliott(analysisCandles),[analysisCandles]);
 const mtf=useMemo(()=>analyzeMTF(mtfCandles),[mtfCandles]);
 const flow=useMemo(()=>flowSnapshot(analysisCandles),[analysisCandles]);
 const regime=useMemo(()=>detectRegime(analysisCandles),[analysisCandles]);
 const conf=useMemo(()=>confluence(smc,flow,regime),[smc,flow,regime]);
 const last=candles.at(-1),prev=candles.at(-2),priceChange=last&&prev?(last.close-prev.close)/prev.close*100:0;
 const selectedPair=pairs.find(p=>p.symbol===symbol); const risk=useMemo(()=>riskPlan(account,riskPercent,smc.setup.entry,smc.stop,selectedPair,smc.setup.direction),[account,riskPercent,smc.setup.entry,smc.stop,selectedPair,smc.setup.direction]);
 const combined=Math.round((smc.score+elliott.score+mtf.score)/3);

 useEffect(()=>{let stop=false;fetch("https://api.binance.com/api/v3/exchangeInfo").then(r=>r.json()).then(d=>{if(!stop)setPairs((d.symbols||[]).filter((x:any)=>x.status==="TRADING").map((x:any)=>{const filters=x.filters||[];const lot=filters.find((f:any)=>f.filterType==="LOT_SIZE")||filters.find((f:any)=>f.filterType==="MARKET_LOT_SIZE")||{};const notional=filters.find((f:any)=>f.filterType==="NOTIONAL")||filters.find((f:any)=>f.filterType==="MIN_NOTIONAL")||{};return{symbol:x.symbol,baseAsset:x.baseAsset,quoteAsset:x.quoteAsset,minQty:Number(lot.minQty)||0,maxQty:Number(lot.maxQty)||Infinity,stepSize:Number(lot.stepSize)||0,minNotional:Number(notional.minNotional)||Number(notional.notional)||0,maxNotional:Number(notional.maxNotional)||Infinity}}))}).catch(()=>{});return()=>{stop=true}},[]);
 useEffect(()=>{let stop=false;const load=()=>fetch("https://api.binance.com/api/v3/ticker/24hr").then(r=>r.json()).then((d:any[])=>{if(stop||!Array.isArray(d))return;setScanner(d.filter(x=>typeof x.symbol==="string"&&x.symbol.endsWith("USDT")&&Number(x.quoteVolume)>10000000).map(x=>({symbol:x.symbol,priceChangePercent:Number(x.priceChangePercent),quoteVolume:Number(x.quoteVolume)})).filter(x=>Number.isFinite(x.priceChangePercent)&&Number.isFinite(x.quoteVolume)).sort((a,b)=>Math.abs(b.priceChangePercent)-Math.abs(a.priceChangePercent)).slice(0,8))}).catch(()=>{});load();const id=window.setInterval(load,30000);return()=>{stop=true;clearInterval(id)}},[]);
 useEffect(()=>{const controller=new AbortController();Promise.all(mtfIntervals.map(async tf=>{try{return{interval:tf,candles:await fetchKlines(symbol,tf,180)}}catch{return{interval:tf,candles:[]}}})).then(rows=>{if(!controller.signal.aborted)setMtfCandles(rows)});return()=>controller.abort()},[symbol]);

 useEffect(()=>{
  let ws:WebSocket|undefined,stop=false,retry:ReturnType<typeof setTimeout>|undefined;
  setCandles([]);setAnalysisCandles([]);setConnected(false);setRestConnected(false);setBacktest(null);setLoading(true);setError("");setDerivatives(null);
  const connect=()=>{if(stop)return;ws=new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);
   ws.onopen=()=>setConnected(true);ws.onclose=()=>{setConnected(false);if(!stop)retry=setTimeout(connect,2500)};ws.onerror=()=>setConnected(false);
   ws.onmessage=e=>{try{const k=JSON.parse(e.data).k;if(!k)return;const c={time:+k.t,open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v,takerBuyVolume:+k.V};setCandles(p=>{const a=[...p],l=a.at(-1);if(l?.time===c.time)a[a.length-1]=c;else a.push(c);return a.length>350?a.slice(-350):a})}catch{}};
  };
  fetchKlines(symbol,interval,350).then(data=>{if(stop)return;setRestConnected(true);setCandles(data);setAnalysisCandles(data);setLoading(false);connect()}).catch(e=>{if(!stop){setRestConnected(false);setLoading(false);setError(e instanceof Error?e.message:"Market data error")}});
  return()=>{stop=true;if(retry)clearTimeout(retry);ws?.close()};
 },[symbol,interval]);

 useEffect(()=>{if(!candles.length)return;const id=window.setTimeout(()=>setAnalysisCandles(candles),750);return()=>window.clearTimeout(id)},[candles]);

 useEffect(()=>{let stop=false;const load=async()=>{try{const [oi,pi,t]=await Promise.all([fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`)]);if(!oi.ok||!pi.ok||!t.ok)throw new Error();const [o,p,tt]=await Promise.all([oi.json(),pi.json(),t.json()]);if(!stop)setDerivatives({openInterest:o.openInterest,fundingRate:p.lastFundingRate,change24h:tt.priceChangePercent})}catch{if(!stop)setDerivatives(null)}};load();const id=window.setInterval(load,15000);return()=>{stop=true;clearInterval(id)}},[symbol]);

 useEffect(()=>{
  let disposed=false;
  let chart:any=null;
  let series:any=null;
  let ro:ResizeObserver|undefined;
  let onViewport:(()=>void)|undefined;
  const host=chartRef.current;
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

 const filtered=pairs.filter(p=>(quoteFilter==="ALL"||p.quoteAsset===quoteFilter)&&p.symbol.includes(pairSearch)).slice(0,500);
 const reset=()=>{const c=chartObj.current;if(!c||!candles.length)return;c.timeScale().setVisibleLogicalRange({from:Math.max(0,candles.length-100),to:candles.length-1+4});setViewportTick(v=>v+1)},toggle=(k:keyof typeof layers)=>setLayers(v=>({...v,[k]:!v[k]}));
 const lastAnalysisTime=analysisCandles.at(-1)?.time??0; const runBacktest=()=>{if(analysisCandles.length>=84)setBacktest({...runSMCBacktest(analysisCandles),symbol,interval,asOf:lastAnalysisTime});else setBacktest(null)}; const backtestStale=!!backtest&&(backtest.symbol!==symbol||backtest.interval!==interval||backtest.asOf!==lastAnalysisTime);
 const fmt=(n:number|null|undefined)=>n==null?"—":n.toLocaleString(undefined,{maximumFractionDigits:8});

 return <main className={`app-shell theme-${theme}`}>
  <div className="terminal-chrome"><span>QUANTSTRUCTURE</span><i/> <b>MARKET ANALYSIS</b><em>LIVE</em></div>
  <header className="topbar"><div className="brand-block"><div className="brand">QUANT<span>STRUCTURE</span></div><div className="subtitle">Advanced SMC · Elliott · Order Flow · Risk Analytics</div></div>
   <div className="market-selector"><div className="selector-search"><span>⌕</span><input value={pairSearch} onChange={e=>setPairSearch(e.target.value.toUpperCase())} placeholder="Search symbol"/></div><select value={quoteFilter} onChange={e=>setQuoteFilter(e.target.value)}><option>USDT</option><option>USDC</option><option>BTC</option><option>FDUSD</option><option>ALL</option></select><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{filtered.length?filtered.map(p=><option key={p.symbol}>{p.symbol}</option>):<option>{symbol}</option>}</select></div>
   <div className="top-status"><div className="theme-switch" aria-label="Theme"><button className={theme==="tradingview"?"active":""} onClick={()=>setTheme("tradingview")}>TV DARK</button><button className={theme==="cyber"?"active":""} onClick={()=>setTheme("cyber")}>CYBER</button></div><span className="data-status"><i className={connected?"pulse live-dot":"live-dot"}/>{connected?"LIVE DATA":"CONNECTING"}</span><span className="source-badge">BINANCE</span></div>
  </header>

  <section className="controlbar"><div className="instrument"><strong>{symbol}</strong><span>{interval}</span>{last&&<b>{fmt(last.close)}</b>}{last&&<em className={priceChange>=0?"positive":"negative"}>{priceChange>=0?"+":""}{priceChange.toFixed(2)}%</em>}</div>
   <div className="timeframes">{intervals.map(t=><button className={interval===t?"active":""} onClick={()=>setInterval(t)} key={t}>{t}</button>)}</div>
   <div className="analysis-tabs">{([["smc","SMC"],["elliott","ELLIOTT WAVE"],["combined","COMBINED"]] as const).map(([k,l])=><button className={mode===k?"active":""} onClick={()=>setMode(k)} key={k}>{l}</button>)}</div>
  </section>

  <section className="toolbar"><div className="toolbar-title">CHART</div>{([["structure","STRUCTURE"],["zones","FVG / OB"],["liquidity","LIQUIDITY"],["trade","SETUP LEVELS"]] as const).map(([k,l])=><button className={layers[k]?"layer-on":""} onClick={()=>toggle(k)} key={k}><i/>{l}</button>)}<button onClick={reset}>RESET VIEW</button><span className="toolbar-note">Analysis only</span></section>
  {error&&<div className="alert">{error}</div>}

  <section className="terminal-grid"><div className="chart-column">
   <div className="panel-card chart-card"><div className="panel-header"><div><span className="eyebrow">PRICE ACTION</span><h2>{symbol} <small>{interval}</small></h2></div><div className="chart-actions"><span>{candles.length} candles</span><button onClick={reset}>FIT</button></div></div>
    <div className="chart-wrap" ref={chartWrapRef}><div className="chart-left-rail"><button title="Crosshair">⌖</button><button title="Trend line">╱</button><button title="Horizontal line">━</button><button title="Rectangle">□</button><button title="Fibonacci">F</button><span/><button title="Long setup">↗</button><button title="Short setup">↘</button></div><div className="chartarea" ref={chartRef}/>{chartReady&&<ChartAnnotations chart={chartObj.current} series={seriesRef.current} host={chartWrapRef.current} candles={candles} smc={smc} elliott={elliott} mode={mode} tick={viewportTick} layers={layers}/>} {loading&&<div className="chart-loading"><span/>Loading market data…</div>}</div>
    <div className="chart-footer"><span><i className="legend-dot smc-dot"/> SMC</span><span><i className="legend-dot wave-dot"/> Elliott</span><span><i className="legend-dot liq-dot"/> Liquidity</span><span className="chart-tip">Live Binance spot data · overlays are analytical</span></div>
   </div>

   <details className="more-tools"><summary>Market details <span>Regime · Flow · Confluence</span></summary><div className="metric-grid">
    <MetricCard title="MARKET REGIME"><Row k="State" v={regime.regime}/><Row k="Strength" v={regime.strength+"/100"}/><Row k="Range" v={regime.rangePercent.toFixed(2)+"%"}/><Row k="ATR" v={fmt(regime.atr)}/></MetricCard>
    <MetricCard title="ORDER FLOW PROXY"><Row k="Pressure" v={flow.pressure}/><Row k="Delta" v={fmt(flow.delta)}/><Row k="Delta ratio" v={(flow.deltaRatio*100).toFixed(2)+"%"}/><Row k="Volume ratio" v={flow.volumeRatio.toFixed(2)+"×"}/></MetricCard>
    <MetricCard title="CONFLUENCE"><ScoreRow label="Structure" value={conf.structure}/><ScoreRow label="Liquidity" value={conf.liquidity}/><ScoreRow label="Zones" value={conf.zones}/><ScoreRow label="Total" value={conf.total}/></MetricCard>
   </div>

   <div className="advanced-grid">
    <div className="panel-card"><div className="section-title">RISK PLANNER</div><div className="input-grid"><label>Account<input type="number" value={account} onChange={e=>setAccount(+e.target.value)}/></label><label>Risk %<input type="number" min=".1" max="10" step=".1" value={riskPercent} onChange={e=>setRiskPercent(+e.target.value)}/></label></div><div className="risk-output"><Row k="Risk amount" v={"$"+risk.riskAmount.toFixed(2)}/><Row k="Stop distance" v={fmt(risk.stopDistance)}/><Row k="Position size" v={risk.positionSize?fmt(risk.positionSize):"—"}/><Row k="Setup R:R" v={smc.setup.rr?smc.setup.rr.toFixed(2)+":1":"—"}/></div>{risk.reason!=="OK"&&<p className="muted-copy">Sizing check: {risk.reason}. Exchange quantity/notional filters are applied when available.</p>}<div className="risk-note">Position size is based on the selected account risk and entry/stop distance; leverage is not a profit guarantee.</div></div>
    <div className="panel-card"><div className="section-title">SMC BACKTEST</div><p className="muted-copy">Runs the current SMC rules over the loaded candles. This is a historical check, not a guarantee of future performance.</p><button className="primary-action" onClick={runBacktest} disabled={analysisCandles.length<84}>RUN BACKTEST</button>{backtest&&<>{<p className="muted-copy">{backtestStale?"RESULT OUTDATED — RUN AGAIN":"RESULT UP TO DATE"} · {backtest.symbol} · {backtest.interval}</p>}<div className="backtest-grid"><Stat k="Trades" v={backtest.trades}/><Stat k="Win rate" v={backtest.winRate.toFixed(1)+"%"}/><Stat k="Net R" v={backtest.totalR.toFixed(1)}/><Stat k="Profit factor" v={backtest.profitFactor.toFixed(2)}/><Stat k="Max DD" v={backtest.maxDrawdownR.toFixed(1)+"R"}/><Stat k="Open at end" v={backtest.openAtEnd}/></div></>}</div>
   </div>
   </details>
  </div>

  <aside className="analysis-column">
   <div className="panel-card analysis-card"><div className="panel-header compact"><div><span className="eyebrow">ENGINE OUTPUT</span><h2>{mode==="smc"?"SMC ANALYSIS":mode==="elliott"?"ELLIOTT WAVE":"COMBINED ANALYSIS"}</h2></div><span className="mode-badge">{mode.toUpperCase()}</span></div>
    {(mode==="smc"||mode==="combined")&&<div className="section-block"><div className="section-title">SMART MONEY CONCEPT</div><Row k="Trend" v={smc.trend}/><Row k="Premium / Discount" v={smc.premiumDiscount}/><Row k="BOS / CHOCH" v={smc.events.at(-1)?.type||"None"}/><Row k="FVG / OB" v={smc.fvgs.filter(x=>!x.filled).length+" / "+smc.orderBlocks.filter(x=>!x.mitigated).length}/><Row k="Setup" v={smc.setup.direction}/><Row k="Confluence" v={conf.total+"/100"}/>{smc.setup.confirmations.length>0&&<div className="confirmation-list">{smc.setup.confirmations.slice(0,7).map(x=><div key={x}>✓ {x}</div>)}</div>}</div>}
    {(mode==="elliott"||mode==="combined")&&<div className="section-block"><div className="section-title">ELLIOTT WAVE</div><Row k="Phase" v={elliott.phase}/><Row k="Primary" v={elliott.primary?elliott.primary.points.map(p=>p.label).join(" → "):"No candidate"}/><Row k="Direction" v={elliott.primary?.direction||"—"}/><Row k="Alternative" v={elliott.alternative?"Available":"None"}/><Row k="ABC" v={elliott.correction?"Candidate":"None"}/><Row k="Confidence" v={elliott.confidence+"/100"}/><Row k="Invalidation" v={fmt(elliott.primary?.invalidation)}/></div>}
    {mode==="combined"&&<div className="confluence-box"><div><span>INDEPENDENT CONFLUENCE</span><strong>{combined}<small>/100</small></strong></div><p>SMC, Elliott and MTF remain separate evidence streams. Combined is a heuristic summary, not a calibrated probability.</p></div>}
   </div>

   <details className="more-tools side-tools"><summary>More market data <span>MTF · Derivatives · Scanner · Status</span></summary><div className="panel-card mtf-card"><div className="section-title">MULTI-TIMEFRAME</div>{mtf.frames.map(f=><div className="mtf-row" key={f.interval}><span>{f.interval}</span><b className={f.trend==="Bullish"?"positive":f.trend==="Bearish"?"negative":""}>{f.trend}</b><small>{f.structure} · {f.score}/100</small></div>)}</div>
   <div className="panel-card mtf-card"><div className="section-title">DERIVATIVES</div><div className="mtf-row"><span>Open Interest</span><b>{derivatives?Number(derivatives.openInterest).toLocaleString(): "—"}</b><small>USDⓈ-M</small></div><div className="mtf-row"><span>Funding</span><b>{derivatives?Number(derivatives.fundingRate).toFixed(5):"—"}</b><small>8h</small></div><div className="mtf-row"><span>24h</span><b className={derivatives&&+derivatives.change24h>=0?"positive":"negative"}>{derivatives?Number(derivatives.change24h).toFixed(2)+"%":"—"}</b><small>Futures</small></div></div>

   <div className="panel-card mtf-card"><div className="section-title">MARKET SCANNER</div>{scanner.map(x=><div className="scanner-row" key={x.symbol}><span>{x.symbol}</span><b className={x.priceChangePercent>=0?"positive":"negative"}>{x.priceChangePercent>=0?"+":""}{x.priceChangePercent.toFixed(2)}%</b><small>{(x.quoteVolume/1e6).toFixed(1)}M</small></div>)}</div>
   <div className="panel-card feed-card"><div className="section-title">SYSTEM STATUS</div><div className="status-line"><span>Spot REST</span><b className={restConnected?"positive":"negative"}>{restConnected?"CONNECTED":loading?"CONNECTING":"OFFLINE"}</b></div><div className="status-line"><span>WebSocket</span><b className={connected?"positive":"negative"}>{connected?"LIVE":"RECONNECTING"}</b></div><div className="status-line"><span>SMC / Elliott</span><b className={analysisCandles.length>=25?"positive":"negative"}>{analysisCandles.length>=25?"READY":"WAITING"}</b></div><div className="status-line"><span>Derivatives</span><b>{derivatives?"LIVE":"N/A"}</b></div><div className="status-line"><span>Execution</span><b>DISABLED</b></div></div></details>
  </aside></section>
  <footer className="footer"><span>QUANTSTRUCTURE · ADVANCED MARKET ANALYSIS WORKSTATION</span><span>Binance data · order-flow values are kline-derived proxies · analysis only</span></footer>
 </main>;
}

function ChartAnnotations({chart,series,host,candles,smc,elliott,mode,tick,layers}:{chart:any;series:any;host:HTMLElement|null;candles:Candle[];smc:any;elliott:any;mode:Mode;tick:number;layers:any}){
 const width=host?.clientWidth||0,height=host?.clientHeight||0;
 if(!chart||!series||!host||!candles.length)return null;if(!chart||!series||candles.length<2||!width||!height)return null;
 const ts=chart.timeScale(),lastIndex=candles.length-1,xOf=(i:number)=>{if(i<0||i>=candles.length)return null;try{const x=ts.timeToCoordinate?.(Math.floor(candles[i].time/1000) as any);if(x!=null)return x;const logical=ts.logicalToCoordinate?.(i);return logical??null}catch{return null}},yOf=(p:number)=>{try{const y=series.priceToCoordinate(p);return y??null}catch{return null}};
 const xLast=xOf(lastIndex)??width,x0=0;
 const text=(x:number|null,y:number|null,s:string,cls:string)=>x==null||y==null?null:<g><rect x={x-3} y={y-13} width={Math.max(32,s.length*5.9+8)} height="17" rx="3" className="label-bg"/><text x={x+1} y={y-1} className={`chart-label ${cls}`}>{s}</text></g>;
 const zone=(low:number,high:number,start:number,end:number,cls:string,title:string)=>{const xa=xOf(start)??x0,xb=xOf(end)??xLast,y1=yOf(high),y2=yOf(low);if(y1==null||y2==null)return null;return <g><rect x={Math.min(xa,xb)} y={Math.min(y1,y2)} width={Math.max(2,Math.abs(xb-xa))} height={Math.max(2,Math.abs(y2-y1))} className={cls}/>{text(Math.min(xa,xb)+4,Math.min(y1,y2)+16,title,cls+"-label")}</g>};
 const structure=layers.structure?<>{smc.events.slice(-8).map((e:any,i:number)=>{const x=xOf(e.index),y=yOf(e.price);return x==null||y==null?null:<g key={"e"+i}><line x1={x} x2={x} y1={y} y2={e.direction==="bullish"?Math.max(18,y-24):Math.min(height-18,y+24)} className={e.type==="CHOCH"?"choch-line":"bos-line"}/>{text(x+6,e.direction==="bullish"?Math.max(18,y-24):Math.min(height-18,y+24),e.type+" "+(e.direction==="bullish"?"BULL":"BEAR"),e.type==="CHOCH"?"choch-label":"bos-label")}</g>})}{smc.pivots.slice(-12).map((p:any,i:number)=>{const x=xOf(p.index),y=yOf(p.price);return x==null||y==null?null:<text key={"p"+i} x={x+3} y={y+(p.type==="H"?-6:12)} className="marker-text">{p.label}</text>})}</>:null;
 const zones=layers.zones?<>{smc.fvgs.slice(-8).map((z:any,i:number)=>zone(z.low,z.high,z.from,z.filled&&z.fillIndex!==undefined?z.fillIndex:lastIndex,z.type==="bullish"?"fvg-bull":"fvg-bear",z.type==="bullish"?"FVG BULL":"FVG BEAR"))}{smc.orderBlocks.slice(-6).map((o:any,i:number)=>zone(o.low,o.high,o.index,o.mitigated&&o.mitigationIndex!==undefined?o.mitigationIndex:lastIndex,o.type==="bullish"?"ob-bull":"ob-bear",o.type==="bullish"?"BULL OB":"BEAR OB"))}</>:null;
 const liquidity=layers.liquidity?<>{[...smc.liquidityHighs.slice(-3).map((p:any)=>({...p,t:"LIQ HIGH"})),...smc.liquidityLows.slice(-3).map((p:any)=>({...p,t:"LIQ LOW"}))].map((p:any,i:number)=>{const x=xOf(p.index)??x0,y=yOf(p.price);return y==null?null:<g key={"l"+i}><line x1={x} x2={xLast} y1={y} y2={y} className="liquidity-line"/>{text(x+3,y,p.t,"liquidity-label")}</g>})}{smc.sweeps.slice(-6).map((s:any,i:number)=>{const x=xOf(s.index),y=yOf(s.price);return x==null||y==null?null:<g key={"s"+i}><circle cx={x} cy={y} r="4" className="marker-sweep"/>{text(x+7,y,s.type==="high"?"SWEEP H":"SWEEP L","sweep-label")}</g>})}</>:null;
 const trade=layers.trade&&smc.entryZone?<>{zone(smc.entryZone.low,smc.entryZone.high,Math.max(0,lastIndex-18),lastIndex,"entry-zone","ENTRY")}{smc.stop!=null&&(()=>{const y=yOf(smc.stop);return y==null?null:<g><line x1={x0} x2={xLast} y1={y} y2={y} className="sl-line"/>{text(xLast-72,y,"SL "+smc.stop.toFixed(4),"sl-label")}</g>})()}{(smc.targets||[]).slice(0,3).map((p:number,i:number)=>{const y=yOf(p);return y==null?null:<g key={"t"+i}><line x1={xLast-120} x2={xLast} y1={y} y2={y} className="tp-line"/>{text(xLast-95,y,"TP"+(i+1),"tp-label")}</g>})}</>:null;
 const wave=mode!=="smc"&&elliott.primary?<>{elliott.primary.points.map((p:any,i:number)=>{const x=xOf(p.index),y=yOf(p.price),n=elliott.primary.points[i+1],nx=n?xOf(n.index):null,ny=n?yOf(n.price):null;return x==null||y==null?null:<g key={"w"+i}>{nx!=null&&ny!=null&&<line x1={x} y1={y} x2={nx} y2={ny} className="wave-line"/>}{text(x,y,p.label,"wave-label")}</g>})}</>:null;
 const fib=mode!=="smc"&&elliott.fibLevels?.length?<>{elliott.fibLevels.slice(0,10).map((f:any,i:number)=>{const y=yOf(f.price);return y==null?null:<g key={"f"+i}><line x1={x0} x2={xLast} y1={y} y2={y} className={f.label==="161.8%"||f.label==="261.8%"?"fib-ext-line":"fib-line"}/>{text(xLast-72,y,f.label,"fib-label")}</g>})}</>:null;
 return <div className="chart-overlay-wrap"><div className="analysis-debug">ANALYSIS · {candles.length} CANDLES · SMC {smc.events.length} BOS/CHOCH · FVG {smc.fvgs.length} · OB {smc.orderBlocks.length} · LIQ {smc.liquidityHighs.length+smc.liquidityLows.length} · ELLIOTT {elliott.primary?"READY":"—"}</div><svg className="chart-overlay" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>{mode!=="elliott"&&<>{zones}{structure}{liquidity}{trade}</>}{wave}{fib}</svg>{mode!=="elliott"&&<div className={`setup-panel ${smc.setup.direction.toLowerCase()}`}><div className="setup-head"><span>SMC SETUP</span><strong>{smc.setup.direction}</strong></div><div className="setup-grid"><span>Trend<b>{smc.trend}</b></span><span>Score<b>{smc.setup.confidence}/100</b></span><span>Entry<b>{smc.setup.entry!=null?smc.setup.entry.toFixed(4):"—"}</b></span><span>SL<b>{smc.stop!=null?smc.stop.toFixed(4):"—"}</b></span><span>TP1<b>{smc.targets?.[0]?.toFixed(4)||"—"}</b></span><span>R:R<b>{smc.setup.rr?smc.setup.rr.toFixed(2)+":1":"—"}</b></span></div></div>}</div>;
}

function MetricCard({title,children}:{title:string;children:ReactNode}){return <div className="panel-card metric-card"><div className="section-title">{title}</div>{children}</div>}
function Row({k,v}:{k:string;v:string}){return <div className="data-row"><span>{k}</span><b>{v}</b></div>}
function ScoreRow({label,value}:{label:string;value:number}){return <div className="score-row"><div><span>{label}</span><b>{value}<small>/100</small></b></div><div className="score-track"><i style={{width:`${Math.max(0,Math.min(100,value))}%`}}/></div></div>}
function Stat({k,v}:{k:string;v:string|number}){return <div className="stat-box"><span>{k}</span><b>{v}</b></div>}
