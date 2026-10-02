import { describe, expect, it } from "vitest";
import { backtestCostR, flowSnapshot, detectRegime, riskPlan, runSMCBacktest, confluence } from "./advanced";
import type { Candle } from "./engine";

function candle(i:number):Candle {
  return {time:i,open:100,high:101,low:99,close:100,volume:100,takerBuyVolume:50,closed:true};
}

describe("confluence zone integrity",()=>{
  it("does not score a partially mitigated FVG as a fresh zone",()=>{
    const base:any={asOf:20,events:[],sweeps:[],fvgs:[{to:19,filled:false,partial:true}],orderBlocks:[],premiumDiscount:"Premium",displacement:0};
    const flow={volumeRatio:0} as any;
    const regime={regime:"RANGING"} as any;
    const result=confluence(base,flow,regime);
    expect(result.zones).toBe(0);
  });
});

describe("risk sizing precision",()=>{
  it("rejects risk percentages above the hard safety limit",()=>{
    const r=riskPlan(1000,12,100,98,{},"BUY");
    expect(r.valid).toBe(false);
    expect(r.positionSize).toBe(0);
    expect(r.reason).toContain("<= 10");
  });

  it("scales backtest transaction costs with Risk R",()=>{
    const oneR=backtestCostR(100,110,5,10,1);
    const twoR=backtestCostR(100,110,5,10,2);
    expect(twoR).toBeCloseTo(oneR*2,12);
  });

  it("ignores invalid exchange constraint values instead of producing NaN sizing",()=>{
    const r=riskPlan(1000,1,100,98,{minQty:Number.NaN,stepSize:0.1},"BUY");
    expect(r.valid).toBe(true);
    expect(Number.isFinite(r.positionSize)).toBe(true);
  });

  it("returns exchange-step quantities without floating-point residue",()=>{
    const r=riskPlan(1000,1,100,98,{minQty:0.001,maxQty:10,stepSize:0.1,minNotional:0}, "BUY");
    expect(r.valid).toBe(true);
    expect(r.positionSize).toBe(5);
  });
});

describe("advanced backtest input normalization",()=>{
  it("produces the same result for chronological and out-of-order closed candles",()=>{
    const sorted=Array.from({length:90},(_,i)=>candle(i));
    const shuffled=[...sorted].reverse();
    const a=runSMCBacktest(sorted);
    const b=runSMCBacktest(shuffled);
    expect(b).toEqual(a);
  });

  it("ignores malformed candles instead of letting them affect backtest indexes",()=>{
    const valid=Array.from({length:90},(_,i)=>candle(i));
    const malformed:Candle={time:999,open:100,high:90,low:95,close:100,volume:100,takerBuyVolume:50,closed:true};
    const withBad=[...valid,malformed];
    expect(runSMCBacktest(withBad)).toEqual(runSMCBacktest(valid));
  });
});


describe("advanced flow/regime input normalization",()=>{
  it("makes flowSnapshot independent of candle ordering and duplicate timestamps",()=>{
    const bars=[
      {...candle(1),volume:100,takerBuyVolume:70},
      {...candle(2),volume:120,takerBuyVolume:80},
      {...candle(3),volume:90,takerBuyVolume:60}
    ];
    const duplicate={...bars[1]};
    expect(flowSnapshot([...bars].reverse())).toEqual(flowSnapshot([...bars,duplicate]));
  });

  it("uses the recent 20-bar window for pressure while preserving full-history cumulative delta",()=>{
    const old=Array.from({length:30},(_,i)=>({...candle(i),volume:100,takerBuyVolume:i<20?20:90}));
    const r=flowSnapshot(old);
    expect(r.pressure).toBe("BUYERS");
    expect(r.deltaRatio).toBeGreaterThan(0);
    expect(r.cumulativeDelta).toBeLessThan(r.delta);
  });

  it("stops flow pressure at the first forming candle",()=>{
    const prefix=Array.from({length:20},(_,i)=>({...candle(i),takerBuyVolume:20}));
    const gap={...candle(20),time:20,closed:false,high:150};
    const later=Array.from({length:20},(_,i)=>({...candle(21+i),takerBuyVolume:90}));
    const expected=flowSnapshot(prefix);
    const actual=flowSnapshot([...prefix,gap,...later]);
    expect(actual).toEqual(expected);
    expect(actual.pressure).toBe("SELLERS");
  });

  it("stops regime detection at the first forming candle",()=>{
    const prefix=Array.from({length:25},(_,i)=>({...candle(i),close:100-i*0.2,open:100-i*0.2+0.05,high:100-i*0.2+0.1,low:100-i*0.2-0.1}));
    const gap={...candle(25),time:25,closed:false,high:150};
    const later=Array.from({length:25},(_,i)=>({...candle(26+i),close:110+i,open:109.9+i,high:110.1+i,low:109.8+i}));
    const expected=detectRegime(prefix);
    const actual=detectRegime([...prefix,gap,...later]);
    expect(actual).toEqual(expected);
  });

  it("does not treat an impossible taker-buy volume as exact data",()=>{
    const bars=[
      {...candle(1),volume:100,takerBuyVolume:200},
      {...candle(2),volume:100,takerBuyVolume:60}
    ];
    const invalid=flowSnapshot(bars);
    const fallback=flowSnapshot([
      {...bars[0],takerBuyVolume:undefined},
      bars[1]
    ]);
    expect(invalid).toEqual(fallback);
  });

  it("makes detectRegime independent of feed ordering and duplicates",()=>{
    const bars=Array.from({length:30},(_,i)=>({
      ...candle(i),
      open:100+i,
      close:100+i+0.5,
      high:101+i,
      low:99+i,
      volume:100
    }));
    const duplicate={...bars[10],close:999};
    expect(detectRegime([...bars].reverse())).toEqual(detectRegime([...bars,duplicate]));
  });
});


describe("advanced history guards",()=>{
  it("does not manufacture a volume ratio from an undersized history",()=>{
    const candles=Array.from({length:3},(_,i)=>({time:i,open:100,high:101,low:99,close:100+i,volume:100,takerBuyVolume:50,closed:true}));
    expect(flowSnapshot(candles).volumeRatio).toBe(0);
  });

});
