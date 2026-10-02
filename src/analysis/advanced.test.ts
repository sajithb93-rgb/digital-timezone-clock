import { describe, expect, it } from "vitest";
import { flowSnapshot, detectRegime, runSMCBacktest } from "./advanced";
import type { Candle } from "./engine";

function candle(i:number):Candle {
  return {time:i,open:100,high:101,low:99,close:100,volume:100,takerBuyVolume:50,closed:true};
}

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
