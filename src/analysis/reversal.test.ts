import { describe, expect, it } from "vitest";
import { analyzeReversal, reversalWindowProfile, analyzeReversalMTF } from "./reversal";
import type { Candle, SMCResult } from "./engine";
import type { OrderFlowResult } from "./orderflow";

function candle(i:number, open:number, high:number, low:number, close:number, volume=100):Candle {
  return { time:i, open, high, low, close, volume, takerBuyVolume: volume * 0.5, closed:true };
}

function smc(overrides: Partial<SMCResult> = {}): SMCResult {
  const base: SMCResult = {
    trend:"Bearish", asOf:34, asOfTime:34, pivots:[], internalPivots:[], events:[],
    fvgs:[], orderBlocks:[], breakers:[], liquidityHighs:[], liquidityLows:[],
    equalHighs:[], equalLows:[], sweeps:[], premiumDiscount:"Discount",
    premiumDiscountRange:{high:120,low:80,mid:100}, vwap:100, volumeRatio:1,
    displacement:0, entryZone:null, stop:null, targets:[], score:0,
    setup:{direction:"WAIT",status:"WAIT",entry:null,stop:null,targets:[],rr:null,confidence:0,confirmations:[]},
  };
  return {...base,...overrides};
}

function flow(overrides: Partial<OrderFlowResult> = {}): OrderFlowResult {
  const base: OrderFlowResult = {
    source:"BINANCE_TAKER_FLOW",buyVolume:700,sellVolume:300,delta:400,deltaRatio:.4,
    cumulativeDelta:400,buyerPressure:70,sellerPressure:30,pressure:"BUYERS",
    pressureTrend:"BUYING PRESSURE INCREASING",imbalance:"BUY",imbalanceRatio:2,
    absorption:"BUYER",absorptionStrength:80,liquiditySweep:"LOW",liquiditySweepPrice:95,
    microStructure:"BULLISH",direction:"BUY",signal:"BUY CONFIRMATION",confidence:80,
    confirmations:["Liquidity sweep low","Buyer absorption"],entry:100,stop:94,targets:[109,112,118],
    recentBars:[],diagnostics:[],rejectionReason:"test fixture",footprint:null,footprintHistoryCount:0,
  };
  return {...base,...overrides};
}

describe("reversal timeframe windows", () => {
  it("keeps the baseline 5m elapsed windows", () => {
    const candles = Array.from({length:4}, (_,i)=>({
      time:i*5*60_000,open:100+i,high:101+i,low:99+i,close:100.5+i,volume:10,closed:true
    }));
    const w=reversalWindowProfile(candles);
    expect(w.sweepLookbackBars).toBe(20);
    expect(w.structureGapBars).toBe(12);
    expect(w.fvgGapBars).toBe(12);
    expect(w.orderBlockGapBars).toBe(20);
  });

  it("compresses reversal windows on higher timeframes", () => {
    const candles = Array.from({length:4}, (_,i)=>({
      time:i*60*60_000,open:100+i,high:101+i,low:99+i,close:100.5+i,volume:10,closed:true
    }));
    const w=reversalWindowProfile(candles);
    expect(w.sweepLookbackBars).toBe(2);
    expect(w.structureGapBars).toBe(1);
    expect(w.fvgGapBars).toBe(1);
    expect(w.orderBlockGapBars).toBe(2);
  });
});

describe("reversal engine",()=>{
  it("confirms a bullish reversal after sweep, opposite structure, CHOCH, displacement and order flow",()=>{
    const candles = Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[20]=candle(20,100,160,99,100);
    candles[20]=candle(20,100,160,99,100);
    candles[31]=candle(31,100,101,95,99);
    candles[32]=candle(32,99,100,96,98);
    candles[33]=candle(33,98,106,97,105);
    candles[34]=candle(34,105,118,103,116);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[{from:32,to:33,low:103,high:105,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:30,low:96,high:99,type:"bullish",mitigated:false,strength:1}],
    }),flow());
    expect(r.direction).toBe("BUY");
    expect(r.state).toBe("CONFIRMED");
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.structureIndex).toBe(33);
  });

  it("rejects SMC context with the same index but a different terminal candle",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    const r=analyzeReversal(candles,smc({
      asOf:34,
      asOfTime:33,
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[{index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"}]
    }),flow(),{requireOrderFlow:false});
    expect(r.state).toBe("NONE");
    expect(r.reason).toContain("out of sync");
  });

  it("does not treat opposite-direction displacement as bullish reversal displacement",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99);
    candles[32]=candle(32,99,100,96,98);
    candles[33]=candle(33,98,106,97,105);
    candles[34]=candle(34,130,160,80,85);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[{from:32,to:33,low:103,high:105,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:30,low:96,high:99,type:"bullish",mitigated:false,strength:1}]
    }),flow(),{requireOrderFlow:false});
    expect(r.displacementRatio).toBe(0);
    expect(r.state).not.toBe("CONFIRMED");
  });

  it("rejects a confirmed sweep after a later invalidating close",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99);
    candles[32]=candle(32,99,100,93,94);
    candles[33]=candle(33,94,106,93,105);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[{from:32,to:33,low:103,high:105,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:32,low:98,high:100,type:"bullish",mitigated:false,strength:1}]
    }),flow(),{requireOrderFlow:false});
    expect(r.sweepIndex).toBeNull();
    expect(r.state).not.toBe("CONFIRMED");
  });

  it("requires the liquidity sweep itself to be confirmed",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99);
    candles[33]=candle(33,98,106,97,105);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:false,displacement:true}],
      events:[
        {index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[{from:32,to:33,low:103,high:105,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:32,low:98,high:100,type:"bullish",mitigated:false,strength:1}]
    }),flow(),{requireOrderFlow:false});
    expect(r.sweepIndex).toBeNull();
    expect(r.state).not.toBe("CONFIRMED");
  });

  it("rejects a stale sweep-to-CHOCH gap beyond the causal window",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[33]=candle(33,98,106,97,105);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:10,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:9,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:23,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ]
    }),flow(),{requireOrderFlow:false});
    expect(r.structureIndex).toBeNull();
    expect(r.state).not.toBe("CONFIRMED");
  });

  it("does not treat a same-candle sweep and CHOCH as a causal reversal sequence",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99);
    candles[32]=candle(32,99,100,96,98);
    candles[33]=candle(33,98,106,97,105);
    candles[34]=candle(34,105,108,103,107);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:31,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[{from:32,to:33,low:103,high:105,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:32,low:98,high:100,type:"bullish",mitigated:false,strength:1}]
    }),flow(),{requireOrderFlow:false});
    expect(r.structureIndex).toBeNull();
    expect(r.state).not.toBe("CONFIRMED");
  });

  it("does not confirm when the structure shift is missing",()=>{
    const candles = Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[32]=candle(32,100,102,95,99);
    candles[33]=candle(33,99,102,97,101);
    candles[34]=candle(34,101,103,99,102);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:32,price:95,type:"low",confirmed:true,displacement:true}],
    }),flow());
    expect(r.state).not.toBe("CONFIRMED");
    expect(r.direction).toBe("BUY");
  });

  it("supports a structural confirmation mode without pretending order flow exists",()=>{
    const candles = Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[20]=candle(20,100,160,99,100);
    candles[31]=candle(31,100,101,95,99);
    candles[32]=candle(32,99,100,96,98);
    candles[33]=candle(33,98,106,97,105);
    candles[34]=candle(34,105,118,103,116);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[{from:32,to:33,low:103,high:105,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:30,low:96,high:99,type:"bullish",mitigated:false,strength:1}],
    }),flow({direction:"WAIT",pressure:"BALANCED",absorption:"NONE",signal:"WAIT"}),{requireOrderFlow:false});
    expect(r.targets).toHaveLength(3);
    expect(r.targets.some(t=>Math.abs(t-160)<1e-9)).toBe(true);
    expect(r.orderflowConfirmed).toBe(false);
    expect(r.state).toBe("CONFIRMED");
    expect(r.reason).toContain("structural MTF mode");
  });

  it("does not confirm a reversal when targets are only mathematical R multiples",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99);
    candles[32]=candle(32,99,100,96,98);
    candles[33]=candle(33,98,106,97,105);
    candles[34]=candle(34,105,118,103,116);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[{from:32,to:33,low:103,high:105,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:30,low:96,high:99,type:"bullish",mitigated:false,strength:1}],
    }),flow(),{requireOrderFlow:false});
    expect(r.state).not.toBe("CONFIRMED");
    expect(r.targets).toHaveLength(3);
  });

  it("does not confirm without a causal entry zone and three future targets",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99);
    candles[32]=candle(32,99,100,96,98);
    candles[33]=candle(33,98,106,97,105);
    candles[34]=candle(34,105,108,103,107);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[],
      orderBlocks:[]
    }),flow());
    expect(r.entryZone).toBeNull();
    expect(r.targets).toEqual([]);
    expect(r.state).not.toBe("CONFIRMED");
  });

  it("does not use the signal candle high/low as an already-reached reversal target",()=>{
    const candles = Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99);
    candles[32]=candle(32,99,100,96,98);
    candles[33]=candle(33,98,106,97,105);
    candles[34]=candle(34,105,130,103,107);
    const r=analyzeReversal(candles,smc({
      sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],
      events:[
        {index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},
        {index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}
      ],
      fvgs:[{from:32,to:33,low:101,high:103,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:32,low:98,high:100,type:"bullish",mitigated:false,strength:1}],
    }),flow());
    expect(r.targets.every(t=>t>candles[34].high)).toBe(true);
  });

  it("ignores the forming candle",()=>{
    const candles = Array.from({length:30},(_,i)=>candle(i,100,101,99,100));
    candles[29]={...candle(29,100,112,94,111),closed:false};
    const r=analyzeReversal(candles,smc({asOf:28,sweeps:[{index:28,price:94,type:"low",confirmed:true,displacement:true}]}),flow());
    expect(r.asOf).toBe(28);
  });
  it("does not accept pressure plus absorption as full order-flow confirmation",()=>{
    const candles = Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99); candles[32]=candle(32,99,100,96,98); candles[33]=candle(33,98,106,97,105); candles[34]=candle(34,105,108,103,107);
    const r=analyzeReversal(candles,smc({sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],events:[{index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},{index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}],fvgs:[{from:32,to:34,low:101,high:103,type:"bullish",filled:false,size:1}],orderBlocks:[{index:32,low:98,high:100,type:"bullish",mitigated:false,strength:1}]}),flow({direction:"WAIT",pressure:"BUYERS",absorption:"BUYER",signal:"CONTEXT ONLY"}));
    expect(r.orderflowConfirmed).toBe(false); expect(r.state).not.toBe("CONFIRMED");
  });

  it("does not use a prior structural level already touched by the signal candle as a future BUY target",()=>{
    const candles=Array.from({length:30},(_,i)=>candle(i,100,101,99,100));
    candles[20]={...candles[20],high:105};
    candles[29]={...candles[29],open:100,high:106,low:99,close:104};
    const r=analyzeReversal(candles,smc({sweeps:[{index:25,price:95,type:"low",confirmed:true,displacement:true}],events:[{index:26,price:101,type:"CHOCH",direction:"bullish",strength:"displacement"}]}),flow(),{requireOrderFlow:false});
    expect(r.targets.every(t=>t>candles[29].high)).toBe(true);
  });

  it("requires a symmetric six-vs-six delta history for divergence",()=>{
    const candles=Array.from({length:35},(_,i)=>i<29
      ? candle(i,100,102,99,101)
      : candle(i,100,103,95,102));
    const recentBars=Array.from({length:12},(_,i)=>({
      index:i,time:23+i,buyVolume:0,sellVolume:0,delta:0,deltaRatio:i<6?-0.2:0.1,
      buyerPressure:0,sellerPressure:0,imbalanceRatio:1,imbalance:"NONE" as const,
      absorption:"NONE" as const,absorptionStrength:0,liquiditySweep:"NONE" as const,
      sweepPrice:null,microStructure:"NEUTRAL" as const
    }));
    const r=analyzeReversal(candles,smc({sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}]}),flow({
      direction:"WAIT",recentBars
    }),{requireOrderFlow:false});
    expect(r.deltaDivergence).toBe(true);
  });

  it("stops Reversal analysis before a middle forming candle",()=>{
    const base=Array.from({length:40},(_,i)=>candle(i,100,101,99,100));
    const prefix=base.slice(0,30);
    const gap={...base[30],closed:false,high:150};
    const actual=analyzeReversal([...prefix,gap,...base.slice(31)],smc(),flow(),{requireOrderFlow:false});
    expect(actual.asOf).toBe(prefix.length-1);
  });

  it("uses the normalized chronological candle sequence for reversal indices",()=>{
    const candles = Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    candles[31]=candle(31,100,101,95,99); candles[32]=candle(32,99,100,96,98); candles[33]=candle(33,98,106,97,105); candles[34]=candle(34,105,108,103,107);
    const base=smc({sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}],events:[{index:30,price:100,type:"BOS",direction:"bearish",strength:"normal"},{index:33,price:102,type:"CHOCH",direction:"bullish",strength:"displacement"}],fvgs:[{from:32,to:34,low:101,high:103,type:"bullish",filled:false,size:1}],orderBlocks:[{index:32,low:98,high:100,type:"bullish",mitigated:false,strength:1}]});
    const ordered=analyzeReversal(candles,base,flow(),{requireOrderFlow:false}); const reversed=analyzeReversal([...candles].reverse(),base,flow(),{requireOrderFlow:false});
    expect(reversed.asOf).toBe(ordered.asOf); expect(reversed.sweepIndex).toBe(ordered.sweepIndex); expect(reversed.structureIndex).toBe(ordered.structureIndex);
  });
  it("rejects delta divergence when flow timestamps do not match price candles",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,102,99,101));
    const recentBars=Array.from({length:12},(_,i)=>({
      index:i,time:i+1000,buyVolume:60,sellVolume:40,delta:20,deltaRatio:i<6?-0.2:0.1,
      buyerPressure:60,sellerPressure:40,imbalanceRatio:1.5,imbalance:"NONE" as const,
      absorption:"NONE" as const,absorptionStrength:0,liquiditySweep:"NONE" as const,
      sweepPrice:null,microStructure:"NEUTRAL" as const
    }));
    const r=analyzeReversal(candles,smc({sweeps:[{index:31,price:95,type:"low",confirmed:true,displacement:true}]}),flow({direction:"WAIT",recentBars}),{requireOrderFlow:false});
    expect(r.deltaDivergence).toBe(false);
  });

  it("rejects reversal analysis when SMC context is from a different candle horizon",()=>{
    const candles=Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
    const r=analyzeReversal(candles,smc({asOf:30}),flow(),{requireOrderFlow:false});
    expect(r.state).toBe("NONE");
    expect(r.reason).toContain("out of sync");
  });

  it("does not increase MTF reversal score when 1h context is opposed",()=>{
    const flat=Array.from({length:45},(_,i)=>candle(i,100,101,99,100));
    const frames=[
      {interval:"1h",candles:flat.map((x,i)=>({...x,time:i,close:100-i*0.2,open:100-i*0.2+0.05,high:100-i*0.2+0.1,low:100-i*0.2-0.1}))},
      {interval:"15m",candles:flat},
      {interval:"5m",candles:flat}
    ];
    const aligned=analyzeReversalMTF(frames);
    const opposedFrames=[
      {interval:"1h",candles:flat.map((x,i)=>({...x,time:i,close:100+i*0.2,open:100+i*0.2-0.05,high:100+i*0.2+0.1,low:100+i*0.2-0.1}))},
      {interval:"15m",candles:flat},
      {interval:"5m",candles:flat}
    ];
    const opposed=analyzeReversalMTF(opposedFrames);
    expect(opposed.score).toBeLessThanOrEqual(aligned.score);
  });
});
