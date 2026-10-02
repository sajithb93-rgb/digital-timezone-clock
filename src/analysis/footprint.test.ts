import { describe, expect, it } from "vitest";
import { FootprintBook, analyzeFootprintSnapshot, normalizeAggTrade } from "./footprint";

describe("price-level footprint engine",()=>{
  it("maps m=false to aggressive buy and m=true to aggressive sell",()=>{
    const book=new FootprintBook(60_000,1,12);
    const a=normalizeAggTrade({a:1,p:"100",q:"2",T:61_000,m:false});
    const b=normalizeAggTrade({a:2,p:"100",q:"3",T:62_000,m:true});
    expect(a&&b).toBeTruthy();
    book.add(a!);book.add(b!);
    const s=book.snapshot(60_000,undefined,120_000);
    expect(s?.buyVolume).toBe(2);
    expect(s?.sellVolume).toBe(3);
    expect(s?.delta).toBe(-1);
  });

  it("deduplicates aggregate trade ids",()=>{
    const book=new FootprintBook(60_000,0.1,12);
    const t=normalizeAggTrade({a:7,p:"100.05",q:"1",T:61_000,m:false})!;
    expect(book.add(t)).toBe(true);
    expect(book.add(t)).toBe(false);
    expect(book.snapshot(60_000,undefined,120_000)?.buyVolume).toBe(1);
  });

  it("does not mark an in-progress candle as confirmed",()=>{
    const book=new FootprintBook(60_000,0.1,12);
    book.add(normalizeAggTrade({a:1,p:"100",q:"1",T:61_000,m:false})!);
    expect(book.snapshot(60_000,undefined,119_999)?.confirmed).toBe(false);
    expect(book.snapshot(60_000,undefined,121_500)?.confirmed).toBe(true);
  });

  it("detects stacked buy imbalance using adjacent price levels",()=>{
    const book=new FootprintBook(60_000,1,12);
    book.add(normalizeAggTrade({a:1,p:"99",q:"1",T:61_000,m:true})!);
    book.add(normalizeAggTrade({a:2,p:"100",q:"4",T:61_001,m:false})!);
    book.add(normalizeAggTrade({a:3,p:"101",q:"5",T:61_002,m:false})!);
    const s=book.snapshot(60_000,undefined,120_000)!;
    expect(s.stackedBuyImbalances).toBeGreaterThanOrEqual(1);
  });

  it("preserves fractional tick prices such as 0.25 when bucketing levels",()=>{
    const book=new FootprintBook(60_000,0.25,12);
    book.add(normalizeAggTrade({a:1,p:"100.24",q:"1",T:61_000,m:false})!);
    book.add(normalizeAggTrade({a:2,p:"100.26",q:"1",T:61_001,m:true})!);
    const s=book.snapshot(60_000,undefined,120_000)!;
    expect(s.levels.map(x=>x.price)).toContain(100.25);
    expect(s.levels.some(x=>x.price===100.3)).toBe(false);
  });

  it("does not treat arbitrary prices as adjacent when tick size is unavailable",()=>{
    const snapshot:any={
      candleTime:60_000,intervalMs:60_000,confirmed:true,
      levels:[
        {price:99,buyVolume:0,sellVolume:1,delta:-1,totalVolume:1,buyTrades:0,sellTrades:1},
        {price:100,buyVolume:4,sellVolume:0,delta:4,totalVolume:4,buyTrades:1,sellTrades:0},
        {price:105,buyVolume:30,sellVolume:0,delta:30,totalVolume:30,buyTrades:1,sellTrades:0}
      ],
      buyVolume:34,sellVolume:1,delta:33,deltaRatio:33/35,poc:105
    };
    const result=analyzeFootprintSnapshot(snapshot,undefined,0);
    expect(result.stackedBuyImbalances).toBe(0);
    expect(result.maxBuyImbalanceRatio).toBe(0);
  });

  it("does not build a stacked imbalance across a missing price step",()=>{
    const snapshot:any={
      candleTime:60_000,intervalMs:60_000,confirmed:true,
      levels:[
        {price:99,buyVolume:0,sellVolume:1,delta:-1,totalVolume:1,buyTrades:0,sellTrades:1},
        {price:100,buyVolume:4,sellVolume:0,delta:4,totalVolume:4,buyTrades:1,sellTrades:0},
        {price:102,buyVolume:30,sellVolume:0,delta:30,totalVolume:30,buyTrades:1,sellTrades:0}
      ],
      buyVolume:34,sellVolume:1,delta:33,deltaRatio:33/35,poc:102
    };
    const result=analyzeFootprintSnapshot(snapshot,undefined,1);
    expect(result.stackedBuyImbalances).toBe(1);
    expect(result.maxBuyImbalanceRatio).toBe(4);
  });

  it("does not classify zero-opposing-volume flow as seller absorption",()=>{
    const snapshot:any={
      candleTime:60_000,intervalMs:60_000,confirmed:true,
      levels:[
        {price:100.9,buyVolume:10,sellVolume:0,delta:10,totalVolume:10,buyTrades:2,sellTrades:0}
      ],
      buyVolume:10,sellVolume:0,delta:10,deltaRatio:1,poc:100.9
    };
    const candle={time:60_000,open:100,high:101,low:99,close:99.2,volume:10,closed:true};
    const result=analyzeFootprintSnapshot(snapshot,candle,0.1);
    expect(result.absorption).toBe("NONE");
    expect(result.absorptionStrength).toBe(0);
  });

  it("does not classify zero-opposing-volume flow as buyer absorption",()=>{
    const snapshot:any={
      candleTime:60_000,intervalMs:60_000,confirmed:true,
      levels:[
        {price:99.1,buyVolume:0,sellVolume:10,delta:-10,totalVolume:10,buyTrades:0,sellTrades:2}
      ],
      buyVolume:0,sellVolume:10,delta:-10,deltaRatio:-1,poc:99.1
    };
    const candle={time:60_000,open:100,high:101,low:99,close:100.8,volume:10,closed:true};
    const result=analyzeFootprintSnapshot(snapshot,candle,0.1);
    expect(result.absorption).toBe("NONE");
    expect(result.absorptionStrength).toBe(0);
  });

  it("does not count separated imbalance levels as a stacked run",()=>{
    const snapshot:any={
      candleTime:60_000,intervalMs:60_000,confirmed:true,
      levels:[
        {price:98,buyVolume:0,sellVolume:1,delta:-1,totalVolume:1,buyTrades:0,sellTrades:1},
        {price:99,buyVolume:4,sellVolume:0,delta:4,totalVolume:4,buyTrades:1,sellTrades:0},
        {price:100,buyVolume:0,sellVolume:10,delta:-10,totalVolume:10,buyTrades:0,sellTrades:1},
        {price:101,buyVolume:30,sellVolume:0,delta:30,totalVolume:30,buyTrades:1,sellTrades:0}
      ],
      buyVolume:34,sellVolume:11,delta:23,deltaRatio:23/45,poc:101
    };
    const result=analyzeFootprintSnapshot(snapshot,undefined,1);
    expect(result.stackedBuyImbalances).toBe(1);
  });
});
