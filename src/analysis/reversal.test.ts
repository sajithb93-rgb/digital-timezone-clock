import { describe, expect, it } from "vitest";
import { analyzeReversal } from "./reversal";
import type { Candle, SMCResult } from "./engine";
import type { OrderFlowResult } from "./orderflow";

function candle(i:number, open:number, high:number, low:number, close:number, volume=100):Candle {
  return { time:i, open, high, low, close, volume, takerBuyVolume: volume * 0.5, closed:true };
}

function smc(overrides: Partial<SMCResult> = {}): SMCResult {
  const base: SMCResult = {
    trend:"Bearish", asOf:34, pivots:[], internalPivots:[], events:[],
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
    recentBars:[],footprint:null,footprintHistoryCount:0,
  };
  return {...base,...overrides};
}

describe("reversal engine",()=>{
  it("confirms a bullish reversal after sweep, opposite structure, CHOCH, displacement and order flow",()=>{
    const candles = Array.from({length:35},(_,i)=>candle(i,100,101,99,100));
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
      fvgs:[{from:32,to:34,low:101,high:103,type:"bullish",filled:false,size:1}],
      orderBlocks:[{index:30,low:96,high:99,type:"bullish",mitigated:false,strength:1}],
    }),flow());
    expect(r.direction).toBe("BUY");
    expect(r.state).toBe("CONFIRMED");
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.structureIndex).toBe(33);
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

  it("ignores the forming candle",()=>{
    const candles = Array.from({length:30},(_,i)=>candle(i,100,101,99,100));
    candles[29]={...candle(29,100,112,94,111),closed:false};
    const r=analyzeReversal(candles,smc({asOf:28,sweeps:[{index:28,price:94,type:"low",confirmed:true,displacement:true}]}),flow());
    expect(r.asOf).toBe(28);
  });
});
