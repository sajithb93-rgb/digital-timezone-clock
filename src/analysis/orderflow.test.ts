import { describe, expect, it } from "vitest";
import { analyzeOrderFlow } from "./orderflow";
import type { Candle } from "./engine";

function candle(i:number, open:number, high:number, low:number, close:number, volume:number, buy:number):Candle{
  return {time:i,open,high,low,close,volume,takerBuyVolume:buy,closed:true};
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

  it("waits when long and short confluence is incomplete",()=>{
    const r=analyzeOrderFlow([
      candle(0,100,101,99,100.2,100,51),
      candle(1,100.2,101,99.2,100.3,100,52),
      candle(2,100.3,101.2,99.4,100.4,100,53)
    ]);
    expect(r.direction).toBe("WAIT");
    expect(r.confidence).toBeLessThanOrEqual(60);
  });
});
