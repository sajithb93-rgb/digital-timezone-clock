import { describe, expect, it } from "vitest";
import { buildAutoFibonacci } from "./fibonacci";

const candles = [
  {time:1,open:100,high:101,low:99,close:100,volume:10,closed:true},
  {time:2,open:100,high:103,low:100,close:102,volume:10,closed:true},
  {time:3,open:102,high:106,low:101,close:105,volume:12,closed:true},
  {time:4,open:105,high:108,low:104,close:107,volume:13,closed:true},
  {time:5,open:107,high:110,low:106,close:109,volume:14,closed:true},
  {time:6,open:109,high:111,low:108,close:110,volume:15,closed:true},
];

function baseSMC() {
  return {
    pivots:[
      {index:1,price:103,type:"H",confirmedAt:4},
      {index:2,price:101,type:"L",confirmedAt:5},
      {index:4,price:110,type:"H",confirmedAt:5},
    ],
    events:[{index:5,price:110,type:"BOS",direction:"bullish",strength:"normal"}],
  } as any;
}

function baseElliott() {
  return {
    primary:{
      points:[
        {index:0,price:95,label:"0"},
        {index:1,price:100,label:"1"},
        {index:2,price:98,label:"2"},
        {index:3,price:110,label:"3"},
        {index:4,price:105,label:"4"},
        {index:5,price:115,label:"5"},
      ],
    },
    correction:null,
    activeWave:"Wave 4",
    liveSetup:null,
  } as any;
}

function baseOrderFlow() {
  return {
    recentBars:[
      {index:2,time:3,liquiditySweep:"LOW",sweepPrice:100,microStructure:"NEUTRAL"},
      {index:4,time:5,liquiditySweep:"NONE",sweepPrice:null,microStructure:"BULLISH"},
    ],
  } as any;
}

describe("strategy-aware auto Fibonacci", () => {
  it("draws SMC retracement from confirmed swing low to BOS high", () => {
    const [set] = buildAutoFibonacci(candles as any, baseSMC(), baseElliott(), baseOrderFlow(), "smc");
    expect(set.source).toBe("SMC");
    expect(set.startPrice).toBe(101);
    expect(set.endPrice).toBe(110);
    expect(set.levels.map(x => x.label)).toEqual(["0%","23.6%","38.2%","50.0%","61.8%","78.6%","100%"]);
    expect(set.levels[3].price).toBeCloseTo(105.5);
  });

  it("uses the validated Elliott Wave-3 leg for Wave-4 retracement", () => {
    const [set] = buildAutoFibonacci(candles as any, baseSMC(), baseElliott(), baseOrderFlow(), "elliott");
    expect(set.source).toBe("ELLIOTT");
    expect(set.startIndex).toBe(2);
    expect(set.endIndex).toBe(3);
    expect(set.startPrice).toBe(98);
    expect(set.endPrice).toBe(110);
    expect(set.levels[3].price).toBeCloseTo(104);
  });

  it("uses order-flow sweep to confirmed micro-structure break", () => {
    const [set] = buildAutoFibonacci(candles as any, baseSMC(), baseElliott(), baseOrderFlow(), "orderflow");
    expect(set.source).toBe("ORDER_FLOW");
    expect(set.startIndex).toBe(2);
    expect(set.endIndex).toBe(4);
    expect(set.startPrice).toBe(100);
    expect(set.endPrice).toBe(110);
    expect(set.levels[3].price).toBeCloseTo(105);
  });

  it("shows all valid strategy-specific sets in Combined mode", () => {
    const sets = buildAutoFibonacci(candles as any, baseSMC(), baseElliott(), baseOrderFlow(), "combined");
    expect(sets.map(x => x.source)).toEqual(["SMC","ELLIOTT","ORDER_FLOW"]);
  });

  it("does not create a set from an open final candle", () => {
    const openCandles = [...candles.slice(0, -1), {...candles.at(-1)!, closed:false}];
    const sets = buildAutoFibonacci(openCandles as any, baseSMC(), baseElliott(), baseOrderFlow(), "smc");
    expect(sets).toHaveLength(0);
  });
  it("uses the completed Wave-5 leg after the Elliott engine enters ABC continuation", () => {
    const elliott = {
      ...baseElliott(),
      activeWave:"A",
      liveSetup:{points:[]},
    } as any;
    const [set] = buildAutoFibonacci(candles as any, baseSMC(), elliott, baseOrderFlow(), "elliott");
    expect(set.source).toBe("ELLIOTT");
    expect(set.startIndex).toBe(4);
    expect(set.endIndex).toBe(5);
    expect(set.startPrice).toBe(105);
    expect(set.endPrice).toBe(115);
  });

  it("does not use a pivot whose confirmation occurs after the SMC event", () => {
    const smc = {
      pivots:[
        {index:1,price:103,type:"H",confirmedAt:2},
        {index:2,price:101,type:"L",confirmedAt:6},
        {index:4,price:110,type:"H",confirmedAt:5},
      ],
      events:[{index:5,price:110,type:"BOS",direction:"bullish",strength:"normal"}],
    } as any;
    const sets = buildAutoFibonacci(candles as any, smc, baseElliott(), baseOrderFlow(), "smc");
    expect(sets.length).toBe(0);
  });

  it("selects the latest SMC event by causal candle index, not array order", () => {
    const smc = {
      pivots: [
        {index:1,price:103,type:"H",confirmedAt:2},
        {index:2,price:101,type:"L",confirmedAt:3},
        {index:4,price:110,type:"H",confirmedAt:5},
        {index:5,price:112,type:"H",confirmedAt:6},
        {index:6,price:105,type:"L",confirmedAt:7},
      ],
      events: [
        {index:5,price:110,type:"BOS",direction:"bullish",strength:"normal"},
        {index:3,price:101,type:"CHOCH",direction:"bullish",strength:"normal"},
      ],
    } as any;
    const [set] = buildAutoFibonacci(candles as any, smc, baseElliott(), baseOrderFlow(), "smc");
    expect(set.endIndex).toBe(4);
    expect(set.endPrice).toBe(110);
  });

  it("does not use an unconfirmed SMC pivot after the structural event", () => {
    const smc = {
      pivots: [
        {index:1,price:103,type:"H",confirmedAt:2},
        {index:2,price:101,type:"L",confirmedAt:6},
        {index:4,price:110,type:"H",confirmedAt:5},
      ],
      events:[{index:5,price:110,type:"BOS",direction:"bullish",strength:"normal"}],
    } as any;
    const [set] = buildAutoFibonacci(candles as any, smc, baseElliott(), baseOrderFlow(), "smc");
    expect(set).toBeUndefined();
  });



  it("uses the full timeframe-scaled lookback for bearish order-flow Fibonacci", () => {
    const candles = Array.from({ length: 20 }, (_, i) => ({
      time: i * 60 * 60 * 1000,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 10,
      closed: true,
    }));
    const orderFlow = {
      recentBars: [
        { index:10, time:10 * 60 * 60 * 1000, liquiditySweep:"NONE", sweepPrice:null, microStructure:"BEARISH" },
      ],
    } as any;
    const sets = buildAutoFibonacci(candles as any, baseSMC(), baseElliott(), orderFlow, "orderflow");
    expect(sets[0]?.source).toBe("ORDER_FLOW");
    expect(sets[0]?.startIndex).toBe(7);
    expect(sets[0]?.endIndex).toBe(10);
  });

  it("uses a timeframe-scaled order-flow swing lookback", () => {
    const shortTf = candles.map((x,i)=>({...x,time:i*60_000}));
    const longTf = candles.map((x,i)=>({...x,time:i*15*60_000}));
    const orderFlow = {
      recentBars:[
        {index:2,time:2,liquiditySweep:"NONE",sweepPrice:null,microStructure:"BULLISH"},
      ],
    } as any;
    const short = buildAutoFibonacci(shortTf as any, baseSMC(), baseElliott(), orderFlow, "orderflow");
    const long = buildAutoFibonacci(longTf as any, baseSMC(), baseElliott(), orderFlow, "orderflow");
    expect(short[0]?.startIndex).toBe(0);
    expect(long[0]?.startIndex).toBe(0);
  });
});
