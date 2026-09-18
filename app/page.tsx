"use client";

import { useMemo, useState } from "react";

type Mode = "smc" | "elliott" | "combined";

const candles = [
  {t:"09:00",o:104200,h:104700,l:103900,c:104550},
  {t:"09:15",o:104550,h:105100,l:104300,c:104900},
  {t:"09:30",o:104900,h:105350,l:104500,c:105200},
  {t:"09:45",o:105200,h:105450,l:104600,c:104800},
  {t:"10:00",o:104800,h:105000,l:104100,c:104350},
  {t:"10:15",o:104350,h:105100,l:104200,c:104950},
  {t:"10:30",o:104950,h:106000,l:104700,c:105800},
  {t:"10:45",o:105800,h:106450,l:105500,c:106200},
  {t:"11:00",o:106200,h:106350,l:105700,c:105950},
  {t:"11:15",o:105950,h:107000,l:105800,c:106800}
];

export default function Home(){
  const [mode,setMode]=useState<Mode>("smc");
  const [symbol,setSymbol]=useState("BTCUSDT");
  const [tf,setTf]=useState("15m");

  const stats=useMemo(()=>mode==="smc"
    ? [["Trend","Bullish"],["Structure","HH → HL → HH"],["BOS","Bullish"],["FVG","2"],["Order Blocks","1"],["Liquidity","High sweep"]]
    : mode==="elliott"
    ? [["Structure","Impulse"],["Primary Count","1 → 2 → 3 → 4 → 5"],["Current Wave","4"],["Fib Status","Checking"],["Target","Pending live data"],["Invalidation","Pending live data"]]
    : [["SMC","Bullish"],["Elliott","Impulse / Wave 4"],["FVG","2"],["Liquidity","High sweep"],["Confluence","Calculating"],["Status","Watch setup"]], [mode]);

  return <main className="page">
    <header className="top">
      <div><div className="brand">QUANT<span>STRUCTURE</span></div><small>Crypto Market Analysis</small></div>
      <select value={symbol} onChange={e=>setSymbol(e.target.value)}>{["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT"].map(x=><option key={x}>{x}</option>)}</select>
      <div className="tf">{["1m","5m","15m","1h","4h","1d"].map(x=><button className={tf===x?"active":""} onClick={()=>setTf(x)} key={x}>{x}</button>)}</div>
    </header>

    <section className="tabs">
      <button className={mode==="smc"?"selected":""} onClick={()=>setMode("smc")}>SMC ANALYSIS</button>
      <button className={mode==="elliott"?"selected":""} onClick={()=>setMode("elliott")}>ELLIOTT WAVE</button>
      <button className={mode==="combined"?"selected":""} onClick={()=>setMode("combined")}>COMBINED</button>
    </section>

    <section className="grid">
      <div className="chart card">
        <div className="cardhead"><b>{symbol}</b><span>{tf} · Live engine</span></div>
        <div className="chartarea">
          <svg viewBox="0 0 1000 420" preserveAspectRatio="none">
            {[70,140,210,280,350].map(y=><line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="currentColor" opacity=".08"/>)}
            <polyline fill="none" stroke="currentColor" strokeWidth="3" points={candles.map((c,i)=>`${i*105+35},${390-(c.c-103500)/12}`).join(" ")}/>
            {candles.map((c,i)=>{const x=i*105+35; const y=390-(c.c-103500)/12; return <circle key={i} cx={x} cy={y} r="4" fill="currentColor"/>})}
            {mode==="smc" && <><text x="660" y="90" className="label">BOS</text><text x="460" y="280" className="label">FVG</text><text x="775" y="145" className="label">LIQUIDITY SWEEP</text></>}
            {mode==="elliott" && <><text x="100" y="350" className="wave">1</text><text x="205" y="320" className="wave">2</text><text x="310" y="245" className="wave">3</text><text x="415" y="285" className="wave">4</text><text x="520" y="190" className="wave">5?</text></>}
          </svg>
        </div>
      </div>

      <aside className="panel card">
        <h3>{mode==="smc"?"SMC ANALYSIS":mode==="elliott"?"ELLIOTT WAVE":"COMBINED ANALYSIS"}</h3>
        {stats.map(([k,v])=><div className="row" key={k}><span>{k}</span><b>{v}</b></div>)}
      </aside>
    </section>

    <section className="bottom">
      <div className="card"><h3>Analysis Engine</h3><p>{mode==="smc"?"SMC engine analyzes market structure independently from Elliott Wave.":mode==="elliott"?"Elliott Wave engine analyzes wave structure independently from SMC.":"Combined view consumes both independent engines."}</p></div>
      <div className="card"><h3>Signal</h3><div className="signal">NO TRADE SIGNAL</div><small>Waiting for live confirmations</small></div>
    </section>
  </main>
}