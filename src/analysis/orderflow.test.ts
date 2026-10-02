import { describe, expect, it } from "vitest";
import { analyzeOrderFlow } from "./orderflow";
import type { Candle } from "./engine";
import type { FootprintSnapshot } from "./footprint";

function candle(i:number, open:number, high:number, low:number, close:number, volume:number, buy:number):Candle{
  return {time:i,open,high,low,close,volume,takerBuyVolume:buy,closed:true};
}



function confirmedFootprints(direction:"BUY"|"SELL", latestOverrides:Partial<FootprintSnapshot>={}):FootprintSnapshot[]{
  return Array.from({length:12},(_,i)=>{
    const buy=direction==="BUY"?60:40;
    const sell=direction==="BUY"?40:60;
    return {
      candleTime:i,intervalMs:60000,confirmed:true,levels:[],
      buyVolume:buy,sellVolume:sell,delta:buy-sell,deltaRatio:(buy-sell)/(buy+sell),poc:100,
      stackedBuyImbalances:direction==="BUY"?2:0,stackedSellImbalances:direction==="SELL"?2:0,
      maxBuyImbalanceRatio:direction==="BUY"?4:0,maxSellImbalanceRatio:direction==="SELL"?4:0,
      maxPositiveDelta:direction==="BUY"?20:0,maxNegativeDelta:direction==="SELL"?-20:0,
      absorption:direction==="BUY"?"BUYER":"SELLER",absorptionStrength:80,
      ...(i===11?latestOverrides:{})
    };
  });
}

function fullLongCandles():Candle[]{
  return [
    ...Array.from({length:8},(_,i)=>candle(i,100,102,99,101,100,60)),
    candle(8,101,101.5,95,100.5,100,55),
    candle(9,100.5,101,95,100.5,100,30),
    candle(10,100.5,103,99.5,102,100,65),
    candle(11,102,106,101,105,100,70)
  ];
}

function fullShortCandles():Candle[]{
  return [
    ...Array.from({length:8},(_,i)=>candle(i,100,102,99,101,100,40)),
    candle(8,101,105,97,99.5,100,45),
    candle(9,99.5,105,99,100,100,70),
    candle(10,100,103,97,98,100,35),
    candle(11,98,99,94,95,100,30)
  ];
}

describe("order flow strategy",()=>{
  it("uses Binance taker-buy volume as buyer volume",()=>{
    const r=analyzeOrderFlow([
      candle(0,100,102,99,101,100,70),
      candle(1,101,103,100,102,100,80),
      candle(2,102,104,101,103,100,75),
      candle(3,103,104,102,103.5,100,65)
    ]);
    expect(r.source).toBe("BINANCE_TAKER_FLOW");
    expect(r.buyVolume).toBe(290);
    expect(r.sellVolume).toBe(110);
    expect(r.delta).toBe(180);
  });

  it("calculates buyer and seller pressure from total volume",()=>{
    const r=analyzeOrderFlow([
      candle(0,100,101,99,100.5,200,150)
    ]);
    expect(r.buyerPressure).toBe(75);
    expect(r.sellerPressure).toBe(25);
    expect(r.pressure).toBe("BUYERS");
  });

  it("detects buy imbalance on a 1.6x or higher taker-flow ratio",()=>{
    const r=analyzeOrderFlow([
      candle(0,100,101,99,100.5,260,160)
    ]);
    expect(r.imbalance).toBe("BUY");
    expect(r.imbalanceRatio).toBeCloseTo(160/100);
  });

  it("detects buyer absorption when heavy selling is rejected at the lows",()=>{
    const r=analyzeOrderFlow([
      candle(0,100,104,95,103.5,100,35),
      candle(1,103,104,96,103.2,100,35),
      candle(2,103.2,104,97,103.8,100,35)
    ]);
    expect(r.recentBars.at(-1)?.absorption).toBe("BUYER");
  });

  it("detects a low liquidity sweep when price trades below prior lows and closes back above",()=>{
    const r=analyzeOrderFlow([
      candle(0,100,102,98,101,100,50),
      candle(1,101,103,99,102,100,50),
      candle(2,102,104,100,103,100,50),
      candle(3,103,104,96,101.5,100,65),
      candle(4,101.5,105,101,104,100,70)
    ]);
    expect(r.recentBars.find(x=>x.index===3)?.liquiditySweep).toBe("LOW");
  });

  it("never confirms a signal from an open candle",()=>{ 
    const r=analyzeOrderFlow([
      candle(0,100,101,99,100.2,100,70),
      candle(1,100.2,102,100,101.8,100,75),
      {...candle(2,101.8,104,99,103,100,80),closed:false}
    ]);
    expect(r.direction).toBe("WAIT");
    expect(r.entry).toBeNull();
    expect(r.targets).toEqual([]);
  });

  it("does not confirm when Binance taker-flow data is unavailable",()=>{
    const r=analyzeOrderFlow([
      {time:0,open:100,high:101,low:99,close:100.5,volume:100,closed:true},
      {time:1,open:100.5,high:102,low:100,close:101.5,volume:100,closed:true}
    ]);
    expect(r.source).toBe("CANDLE_ESTIMATE_FALLBACK");
    expect(r.direction).toBe("WAIT");
    expect(r.confidence).toBe(0);
  });

  it("waits when long and short confluence is incomplete",()=>{
    const r=analyzeOrderFlow([
      candle(0,100,101,99,100.2,100,51),
      candle(1,100.2,101,99.2,100.3,100,52),
      candle(2,100.3,101.2,99.4,100.4,100,53)
    ]);
    expect(r.direction).toBe("WAIT");
    expect(r.confidence).toBeLessThanOrEqual(60);
  });
  it("uses footprint delta and stacked imbalance for confirmed-flow confirmation data",()=>{
    const candles=Array.from({length:12},(_,i)=>candle(i,100,101,99,100.2,100,60));
    const footprint:FootprintSnapshot[]=[];
    for(let i=0;i<12;i++) footprint.push({
      candleTime:i,intervalMs:60000,confirmed:true,levels:[],
      buyVolume:60,sellVolume:40,delta:20,deltaRatio:0.2,poc:100,
      stackedBuyImbalances:2,stackedSellImbalances:0,maxBuyImbalanceRatio:4,maxSellImbalanceRatio:0,
      maxPositiveDelta:20,maxNegativeDelta:0,absorption:"BUYER",absorptionStrength:80
    });
    const r=analyzeOrderFlow(candles,footprint);
    expect(r.source).toBe("BINANCE_FOOTPRINT");
    expect(r.delta).toBe(240);
    expect(r.cumulativeDelta).toBe(240);
    expect(r.imbalance).toBe("BUY");
    expect(r.absorption).toBe("BUYER");
  });

  it("blocks confirmation when one footprint bar is only partly covered",()=>{
    const candles=Array.from({length:12},(_,i)=>candle(i,100,101,99,100.2,100,60));
    const footprint=confirmedFootprints("BUY");
    footprint[5]={...footprint[5],buyVolume:20,sellVolume:10,delta:10,deltaRatio:1/3};
    const result=analyzeOrderFlow(candles,footprint);
    expect(result.direction).toBe("WAIT");
    expect(result.footprintHistoryCount).toBe(12);
    expect(result.diagnostics.find(d=>d.key==="footprint_coverage")?.passed).toBe(false);
  });

  it("requires 12 closed candles before a 12-bar pressure setup can confirm",()=>{
    const rows=Array.from({length:11},(_,i)=>candle(i,100+i,102+i,99+i,101+i,100,70));
    const r=analyzeOrderFlow(rows);
    expect(r.direction).toBe("WAIT");
    expect(r.confidence).toBe(0);
  });

  it("exposes diagnostic blockers instead of silently returning WAIT",()=>{
    const rows=Array.from({length:11},(_,i)=>candle(i,100+i,102+i,99+i,101+i,100,70));
    const r=analyzeOrderFlow(rows);
    expect(r.diagnostics.some(d=>d.key==="history"&&!d.passed)).toBe(true);
    expect(r.rejectionReason).toContain("12+ closed candles");
  });

  it("keeps recent sweep and absorption visible before full confirmation",()=>{
    const rows=[
      ...Array.from({length:10},(_,i)=>candle(i,100,102,99,101,100,50)),
      candle(10,101,102,95,100.8,100,35),
      candle(11,100.8,105,100,104.5,100,70)
    ];
    const r=analyzeOrderFlow(rows);
    expect(r.liquiditySweep).toBe("LOW");
    expect(r.absorption).not.toBe("NONE");
  });

  it("sorts candles chronologically and rejects malformed candles",()=>{
    const r=analyzeOrderFlow([
      candle(2,102,104,101,103,100,60),
      {time:3,open:103,high:102,low:101,close:102,volume:100,takerBuyVolume:60,closed:true},
      candle(1,101,103,100,102,100,60)
    ]);
    expect(r.recentBars.map(x=>x.time)).toEqual([1,2]);
  });


  it("confirms BUY only when the complete causal sequence is present",()=>{
    const r=analyzeOrderFlow(fullLongCandles(),confirmedFootprints("BUY"));
    expect(r.direction).toBe("BUY");
    expect(r.signal).toBe("BUY CONFIRMED — CLOSED CANDLE");
    expect(r.confidence).toBe(100);
    expect(r.confirmations).toContain("Sell-side liquidity sweep → buyer absorption");
    expect(r.confirmations).toContain("2+ stacked buy imbalances");
  });

  it("confirms SELL only when the complete causal sequence is present",()=>{
    const r=analyzeOrderFlow(fullShortCandles(),confirmedFootprints("SELL"));
    expect(r.direction).toBe("SELL");
    expect(r.signal).toBe("SELL CONFIRMED — CLOSED CANDLE");
    expect(r.confidence).toBe(100);
    expect(r.confirmations).toContain("Buy-side liquidity sweep → seller absorption");
    expect(r.confirmations).toContain("2+ stacked sell imbalances");
  });

  it("blocks a BUY when the liquidity sweep is stale",()=>{
    const candles=[
      candle(0,100,102,99,101,100,50),
      candle(1,101,103,99,102,100,50),
      candle(2,102,104,99,103,100,50),
      candle(3,103,104,99,103.5,100,50),
      candle(4,103.5,104,99,103.2,100,50),
      candle(5,103.2,104,95,100.5,100,50),
      candle(6,100.5,101.5,99.5,100.8,100,50),
      candle(7,100.8,101.5,99.5,100.6,100,50),
      candle(8,100.6,101.5,99.5,100.7,100,50),
      candle(9,100.7,101.2,99.5,100.8,100,30),
      candle(10,100.8,103,99.5,102,100,60),
      candle(11,102,106,101,105,100,70)
    ];
    const r=analyzeOrderFlow(candles,confirmedFootprints("BUY"));
    expect(r.direction).toBe("WAIT");
    expect(r.entry).toBeNull();
    expect(r.diagnostics.find(d=>d.key==="sweep_recent_buy")?.passed).toBe(false);
  });

  it("blocks a BUY when the latest three footprint bars lose directional flow",()=>{
    const candles=fullLongCandles();
    const footprint=confirmedFootprints("BUY");
    footprint[9]={...footprint[9],deltaRatio:-0.2,delta:-20,buyVolume:40,sellVolume:60};
    footprint[10]={...footprint[10],deltaRatio:-0.2,delta:-20,buyVolume:40,sellVolume:60};
    const r=analyzeOrderFlow(candles,footprint);
    expect(r.direction).toBe("WAIT");
    expect(r.diagnostics.find(d=>d.key==="recent_flow_buy")?.passed).toBe(false);
    expect(r.rejectionReason).toContain("3-bar buyer flow alignment");
  });

  it("confirms a normal BUY entry without chase extension",()=>{
    const r=analyzeOrderFlow(fullLongCandles(),confirmedFootprints("BUY"));
    expect(r.direction).toBe("BUY");
    expect(r.entry).toBe(105);
    expect(r.diagnostics.find(d=>d.key==="entry_chase_buy")?.passed).toBe(true);
  });

  it("rejects an overextended BUY entry after the structure break",()=>{
    const candles=fullLongCandles().map((c,i)=>i===11?{...c,high:116,close:115}:c);
    const r=analyzeOrderFlow(candles,confirmedFootprints("BUY"));
    expect(r.direction).toBe("WAIT");
    expect(r.entry).toBeNull();
    expect(r.diagnostics.find(d=>d.key==="entry_chase_buy")?.passed).toBe(false);
  });

  it("confirms a normal SELL entry without chase extension",()=>{
    const r=analyzeOrderFlow(fullShortCandles(),confirmedFootprints("SELL"));
    expect(r.direction).toBe("SELL");
    expect(r.entry).toBe(95);
    expect(r.diagnostics.find(d=>d.key==="entry_chase_sell")?.passed).toBe(true);
  });

  it("rejects an overextended SELL entry after the structure break",()=>{
    const candles=fullShortCandles().map((c,i)=>i===11?{...c,low:84,close:85}:c);
    const r=analyzeOrderFlow(candles,confirmedFootprints("SELL"));
    expect(r.direction).toBe("WAIT");
    expect(r.entry).toBeNull();
    expect(r.diagnostics.find(d=>d.key==="entry_chase_sell")?.passed).toBe(false);
  });

  it("rejects a BUY when the computed stop is not below entry",()=>{
    const candles=[
      ...Array.from({length:7},(_,i)=>candle(i,108,110,105,109,100,50)),
      candle(7,109,111,100,106,100,50),
      candle(8,103,104,100,103,100,40),
      candle(9,103,104,101,102.5,100,40),
      candle(10,102.5,103.5,101.5,103.2,100,60),
      candle(11,103.2,104.5,102,104.2,100,65)
    ];
    const r=analyzeOrderFlow(candles,confirmedFootprints("BUY"));
    expect(r.direction).toBe("WAIT");
    expect(r.entry).toBeNull();
    expect(r.stop).toBeNull();
    expect(r.targets).toEqual([]);
    expect(r.signal).toContain("WAIT");
    expect(r.rejectionReason).toContain("invalid entry/SL/TP geometry");
    expect(r.diagnostics.find(d=>d.key==="trade_geometry")?.passed).toBe(false);
  });

  it("rejects a SELL when the computed stop is not above entry",()=>{
    const candles=[
      ...Array.from({length:7},(_,i)=>candle(i,91,95,90,92,100,50)),
      candle(7,92,100,91,94,100,50),
      candle(8,97,98,96,97,100,70),
      candle(9,97,97,96.5,96.8,100,60),
      candle(10,96.8,97,96.2,96.7,100,60),
      candle(11,96.7,97,95.2,95.4,100,65)
    ];
    const r=analyzeOrderFlow(candles,confirmedFootprints("SELL"));
    expect(r.direction).toBe("WAIT");
    expect(r.entry).toBeNull();
    expect(r.stop).toBeNull();
    expect(r.targets).toEqual([]);
    expect(r.signal).toContain("WAIT");
    expect(r.rejectionReason).toContain("invalid entry/SL/TP geometry");
    expect(r.diagnostics.find(d=>d.key==="trade_geometry")?.passed).toBe(false);
  });

  it("blocks a SELL when the liquidity sweep is stale",()=>{
    const candles=[
      candle(0,100,101,98,99,100,50),
      candle(1,99,101,97,98,100,50),
      candle(2,98,100,96,97,100,50),
      candle(3,97,99,95,96.5,100,50),
      candle(4,96.5,98,95,96.8,100,50),
      candle(5,96.8,102,94,101,100,50),
      candle(6,101,102,99.5,100.5,100,50),
      candle(7,100.5,102,99.5,100.6,100,50),
      candle(8,100.6,102,99.5,100.5,100,50),
      candle(9,100.5,101.8,99.8,100.4,100,70),
      candle(10,100.4,101,97,98,100,40),
      candle(11,98,99,94,95,100,30)
    ];
    const r=analyzeOrderFlow(candles,confirmedFootprints("SELL"));
    expect(r.direction).toBe("WAIT");
    expect(r.entry).toBeNull();
    expect(r.diagnostics.find(d=>d.key==="sweep_recent_sell")?.passed).toBe(false);
  });

  it("blocks a SELL when the latest three footprint bars lose directional flow",()=>{
    const candles=fullShortCandles();
    const footprint=confirmedFootprints("SELL");
    footprint[9]={...footprint[9],deltaRatio:0.2,delta:20,buyVolume:60,sellVolume:40};
    footprint[10]={...footprint[10],deltaRatio:0.2,delta:20,buyVolume:60,sellVolume:40};
    const r=analyzeOrderFlow(candles,footprint);
    expect(r.direction).toBe("WAIT");
    expect(r.diagnostics.find(d=>d.key==="recent_flow_sell")?.passed).toBe(false);
    expect(r.rejectionReason).toContain("3-bar seller flow alignment");
  });

  it("returns WAIT when any critical BUY footprint confirmation is missing",()=>{
    const base=fullLongCandles();
    const cases:Partial<FootprintSnapshot>[]=[
      {confirmed:false},
      {stackedBuyImbalances:1},
      {maxBuyImbalanceRatio:2.5},
      {absorption:"SELLER"},
      {deltaRatio:0.05}
    ];
    for(const overrides of cases){
      const r=analyzeOrderFlow(base,confirmedFootprints("BUY",overrides));
      expect(r.direction).toBe("WAIT");
      expect(r.confidence).toBe(0);
    }
  });

  it("returns WAIT when BUY causal context or current structure break is missing",()=>{
    const fp=confirmedFootprints("BUY");
    const noSweep=fullLongCandles().map((c,i)=>i===8?{...c,low:99.5}:c);
    expect(analyzeOrderFlow(noSweep,fp).direction).toBe("WAIT");

    const noAbsorption=fullLongCandles().map((c,i)=>i===9?{...c,close:c.open,low:c.open-0.1}:c);
    expect(analyzeOrderFlow(noAbsorption,fp).direction).toBe("WAIT");

    const noBreak=fullLongCandles().map((c,i)=>i===11?{...c,high:103,close:102.5}:c);
    expect(analyzeOrderFlow(noBreak,fp).direction).toBe("WAIT");
  });

  it("returns WAIT when a valid BUY setup is still on an open latest candle",()=>{
    const candles=fullLongCandles().map((c,i)=>i===11?{...c,closed:false}:c);
    const r=analyzeOrderFlow(candles,confirmedFootprints("BUY"));
    expect(r.direction).toBe("WAIT");
    expect(r.entry).toBeNull();
  });

  it("does not duplicate directional flow diagnostics",()=>{
    const r=analyzeOrderFlow(fullLongCandles(),confirmedFootprints("BUY"));
    expect(r.diagnostics.filter(d=>d.key==="recent_flow_buy")).toHaveLength(1);
    expect(r.diagnostics.filter(d=>d.key==="recent_flow_sell")).toHaveLength(1);
  });

  it("does not mix BUY and SELL footprint confirmations",()=>{
    const mixed=confirmedFootprints("BUY",{stackedSellImbalances:2,maxSellImbalanceRatio:4,absorption:"SELLER",deltaRatio:-0.2});
    const r=analyzeOrderFlow(fullLongCandles(),mixed);
    expect(r.direction).toBe("WAIT");
    expect(r.confidence).toBe(0);
  });

});
