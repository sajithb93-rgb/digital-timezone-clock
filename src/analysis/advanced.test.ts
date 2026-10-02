import { describe, expect, it } from "vitest";\nimport { flowSnapshot, detectRegime, runSMCBacktest } from "./advanced";\nimport type { Candle } from "./engine";\n\nfunction candle(i:number):Candle {\n  return {time:i,open:100,high:101,low:99,close:100,volume:100,takerBuyVolume:50,closed:true};\n}\n\ndescribe("advanced backtest input normalization",()=>{\n  it("produces the same result for chronological and out-of-order closed candles",()=>{\n    const sorted=Array.from({length:90},(_,i)=>candle(i));\n    const shuffled=[...sorted].reverse();\n    const a=runSMCBacktest(sorted);\n    const b=runSMCBacktest(shuffled);\n    expect(b).toEqual(a);\n  });\n\n  it("ignores malformed candles instead of letting them affect backtest indexes",()=>{\n    const valid=Array.from({length:90},(_,i)=>candle(i));\n    const malformed:Candle={time:999,open:100,high:90,low:95,close:100,volume:100,takerBuyVolume:50,closed:true};\n    const withBad=[...valid,malformed];\n    expect(runSMCBacktest(withBad)).toEqual(runSMCBacktest(valid));\n  });\n});\n

describe("advanced flow/regime input normalization",()=>{
  it("makes flowSnapshot independent of candle ordering and duplicate timestamps",()=>{
    const bars=[
      {...candle(1),volume:100,takerBuyVolume:70},
      {...candle(2),volume:120,takerBuyVolume:80},
      {...candle(3),volume:90,takerBuyVolume:60}
    ];
    const duplicate={...bars[1],volume:999,takerBuyVolume:999};
    expect(flowSnapshot([...bars].reverse())).toEqual(flowSnapshot([...bars,duplicate]));
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
