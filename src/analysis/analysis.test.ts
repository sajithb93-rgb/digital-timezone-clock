import { describe, expect, it } from "vitest";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle } from "./engine";
import { flowSnapshot, riskPlan, runSMCBacktest } from "./advanced";

function candles(count:number, start=100):Candle[]{
  return Array.from({length:count},(_,i)=>{
    const close=start+i*0.1;
    return {
      time:i,
      open:close-0.05,
      high:close+0.1,
      low:close-0.1,
      close,
      volume:100,
      takerBuyVolume:50,
      closed:true
    };
  });
}

describe("analysis regression",()=>{
  it("uses kline taker-buy volume for flow",()=>{
    const c=[
      {...candles(1)[0],volume:100,takerBuyVolume:80},
      {...candles(1)[0],time:1,volume:50,takerBuyVolume:20}
    ];
    const f=flowSnapshot(c);
    expect(f.buyVolume).toBeCloseTo(100);
    expect(f.sellVolume).toBeCloseTo(50);
    expect(f.delta).toBeCloseTo(50);
  });

  it("rejects risk when stop is on the wrong side",()=>{
    expect(riskPlan(1000,1,100,105,{}, "BUY").valid).toBe(false);
    expect(riskPlan(1000,1,100,95,{}, "SELL").valid).toBe(false);
    expect(riskPlan(1000,1,100,95,{}, "BUY").valid).toBe(true);
  });

  it("does not emit a trade setup without a valid entry zone",()=>{
    const s=analyzeSMC(candles(100));
    if(!s.entryZone) expect(s.setup.direction).toBe("WAIT");
  });

  it("marks missing MTF frames as unavailable without treating them as neutral evidence",()=>{
    const m=analyzeMTF([
      {interval:"4h",candles:candles(100)},
      {interval:"1h",candles:[]}
    ]);
    expect(m.frames.find(x=>x.interval==="1h")?.available).toBe(false);
    expect(m.frames.find(x=>x.interval==="1h")?.structure).toBe("UNAVAILABLE");
  });

  it("never promotes a low-quality Elliott fallback to primary",()=>{
    const e=analyzeElliott(candles(100));
    if(e.primary) expect(e.primary.quality).toBeGreaterThanOrEqual(60);
  });

  it("rejects invalid backtest configuration safely",()=>{
    const result=runSMCBacktest(candles(100),0,30,0,0);
    expect(result.trades).toBe(0);
    expect(result.openAtEnd).toBe(0);
  });
});
