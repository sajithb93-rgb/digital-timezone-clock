import { describe, expect, it } from "vitest";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle, buildImpulseFibLevels, impulseMetrics, isSetupActive, validateDiagonalWave, validateImpulseWave } from "./engine";
import { flowSnapshot, riskPlan, runSMCBacktest } from "./advanced";
import { analyzeElliottAdvanced, validateFlat, validateTriangle, validateZigzag } from "./elliott";

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

  it("exposes Elliott evidence separately for available MTF frames",()=>{
    const m=analyzeMTF([{interval:"4h",candles:candles(100)}]);
    expect(m.frames[0].available).toBe(true);
    expect(m.frames[0].elliottTrend).toBeDefined();
    expect(m.frames[0].elliottScore).toBeDefined();
    expect(m.elliottTrend).toBeDefined();
  });

  it("marks missing MTF frames as unavailable without treating them as neutral evidence",()=>{
    const m=analyzeMTF([
      {interval:"4h",candles:candles(100)},
      {interval:"1h",candles:[]}
    ]);
    expect(m.frames.find(x=>x.interval==="1h")?.available).toBe(false);
    expect(m.frames.find(x=>x.interval==="1h")?.structure).toBe("UNAVAILABLE");
  });

  it("calculates Wave 5 from Wave 4 end to Wave 5 end",()=>{
    const m=impulseMetrics([100,120,110,150,135,165]);
    expect(m?.w5).toBe(30);
    expect(m?.r5).toBeCloseTo(1.5);
  });

  it("anchors Elliott Fibonacci levels to the completed Wave 5 end and Wave 1 origin",()=>{
    const levels=buildImpulseFibLevels([100,120,110,150,135,165],true);
    expect(levels.find(x=>x.label==="0%")?.price).toBe(165);
    expect(levels.find(x=>x.label==="100%")?.price).toBe(100);
  });

  it("enforces the three strict standard-impulse rules",()=>{
    expect(validateImpulseWave([100,120,110,150,135,165],true).valid).toBe(true);
    expect(validateImpulseWave([100,120,99,150,135,165],true).valid).toBe(false);
    expect(validateImpulseWave([100,120,110,125,115,150],true).valid).toBe(false);
    expect(validateImpulseWave([100,120,110,150,115,160],true).valid).toBe(false);
  });

  it("recognizes diagonal overlap without weakening the Wave 3 rule",()=>{
    const v=validateDiagonalWave([100,120,110,150,118,155],true);
    expect(v.w4OverlapsW1).toBe(true);
    expect(v.valid).toBe(true);
    expect(validateDiagonalWave([100,120,110,125,118,150],true).valid).toBe(false);
  });

  it("applies the same strict impulse rules to bearish counts",()=>{
    expect(validateImpulseWave([200,180,190,150,165,130],false).valid).toBe(true);
    expect(validateImpulseWave([200,180,205,150,165,130],false).valid).toBe(false);
    expect(validateImpulseWave([200,180,190,175,185,130],false).valid).toBe(false);
    expect(validateImpulseWave([200,180,190,150,185,130],false).valid).toBe(false);
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

  it("accepts a structurally valid impulse in the advanced Elliott engine",()=>{
    const e=analyzeElliottAdvanced(
      [100,120,110,150,135,165,170,166,172,169,175,171,180,176,182,178,185,181,188,184,190,186,192,188,194,190,196,192,198,194]
      .map((p,i)=>({time:i,open:p,high:p+0.05,low:p-0.05,close:p,volume:100,closed:true}))
    );
    expect(e.engine).toBe("ADVANCED_ELLIOTT_V2");
    expect(e.primary?.kind).toBe("Impulse");
    expect(e.primary?.strict).toBe(true);
  });

  it("keeps corrective structures separate from the primary impulse count",()=>{
    expect(validateZigzag([150,125,140],false).valid).toBe(true);
    expect(validateFlat([150,145,151],false).valid).toBe(true);
    expect(analyzeElliottAdvanced(candles(100)).primary).toBeNull();
  });

  it("requires real contraction or expansion for a triangle candidate",()=>{
    expect(validateTriangle([100,90,96,92,94],true).contracting).toBe(true);
    expect(validateTriangle([100,110,105,116,109],true).expanding).toBe(true);
  });

  it("never promotes the fallback monotonic candle series to an Elliott count",()=>{
    const e=analyzeElliottAdvanced(candles(120));
    expect(e.primary).toBeNull();
    expect(e.setupState).toBe("NONE");
    expect(e.engine).toBe("ADVANCED_ELLIOTT_V2");
  });

});
