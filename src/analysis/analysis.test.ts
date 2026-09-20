import { describe, expect, it } from "vitest";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle, isSetupActive, validateImpulseWave } from "./engine";
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

  it("marks an entry zone active only when the latest closed candle overlaps the zone",()=>{
    const zone={low:100,high:105,type:"entry" as const};
    expect(isSetupActive(zone,{time:1,open:106,high:108,low:106,close:107,volume:100,closed:true})).toBe(false);
    expect(isSetupActive(zone,{time:2,open:106,high:107,low:103,close:104,volume:100,closed:true})).toBe(true);
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

  it("enforces the three strict standard-impulse rules",()=>{
    expect(validateImpulseWave([100,120,110,150,135,165],true).valid).toBe(true);
    expect(validateImpulseWave([100,120,99,150,135,165],true).valid).toBe(false);
    expect(validateImpulseWave([100,120,110,125,115,150],true).valid).toBe(false);
    expect(validateImpulseWave([100,120,110,150,115,160],true).valid).toBe(false);
  });

  it("classifies a directional Wave 5 that fails to exceed Wave 3 as a truncation",()=>{
    const v=validateImpulseWave([100,120,110,150,135,145],true);
    expect(v.valid).toBe(true);
    expect(v.w5BeyondW3).toBe(false);
    expect(v.truncated).toBe(true);
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
