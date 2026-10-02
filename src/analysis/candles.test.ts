import { describe, expect, it } from "vitest";
import { normalizeCandleSeries } from "./candles";

const candle=(time:number,overrides:Partial<{open:number;high:number;low:number;close:number;volume:number;takerBuyVolume:number;closed:boolean}>={})=>({
  time,open:100,high:102,low:99,close:101,volume:100,takerBuyVolume:60,closed:true,...overrides
});

describe("normalizeCandleSeries",()=>{
  it("sorts out-of-order candles and stops before the first open candle",()=>{
    const rows=[
      candle(3),
      candle(1),
      candle(2,{closed:false}),
      candle(4)
    ];
    expect(normalizeCandleSeries(rows,true).map(x=>x.time)).toEqual([1]);
  });

  it("preserves a richer duplicate when only taker-buy volume is missing",()=>{
    const rich=candle(1,{takerBuyVolume:60});
    const sparse=candle(1,{takerBuyVolume:undefined});
    const result=normalizeCandleSeries([rich,sparse],true);
    expect(result).toHaveLength(1);
    expect(result[0]?.takerBuyVolume).toBe(60);
  });

  it("drops conflicting duplicate timestamps instead of last-write-wins",()=>{
    const result=normalizeCandleSeries([
      candle(1,{close:101}),
      candle(1,{close:101.5})
    ],true);
    expect(result).toEqual([]);
  });

  it("prefers a closed snapshot over an open snapshot with the same timestamp",()=>{
    const result=normalizeCandleSeries([
      candle(1,{closed:false,close:100.5}),
      candle(1,{closed:true,close:101})
    ],true);
    expect(result).toHaveLength(1);
    expect(result[0]?.closed).toBe(true);
    expect(result[0]?.close).toBe(101);
  });

  it("rejects malformed OHLC and negative volume",()=>{
    const result=normalizeCandleSeries([
      candle(1,{high:98}),
      candle(2,{volume:-1}),
      candle(3)
    ],true);
    expect(result.map(x=>x.time)).toEqual([3]);
  });
});
