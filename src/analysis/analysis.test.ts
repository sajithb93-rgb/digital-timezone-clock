import { describe, expect, it } from "vitest";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle, buildImpulseFibLevels, impulseMetrics, classifyStructureBreak, isOrderBlockCausal, isPostSweepZoneCausal, isSetupActive, isSMCCausalSequence, isValidLiquiditySweep, validateDiagonalWave, validateImpulseWave, classifyProtectedStructureBreak } from "./engine";
import { flowSnapshot, riskPlan, runSMCBacktest } from "./advanced";
import { analyzeElliottAdvanced, buildLiveContinuationSetup, validateDoubleZigzag, validateFlat, validateNestedImpulse, validateTriangle, validateZigzag } from "./elliott";

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

  it("ignores an unfinished tail candle for SMC signal state",()=>{
    const c=[...candles(40),{...candles(1)[0],time:40,closed:false}];
    const m=analyzeSMC(c);
    expect(m.asOf).toBe(39);
    expect(isSetupActive({low:99,high:101,type:"entry"},c.at(-1))).toBe(false);
  });

  it("invalidates a liquidity sweep after a later close through the swept level",()=>{
    const highSweep=[
      {...candles(1)[0],time:0,open:100,high:101,low:99,close:100,closed:true},
      {...candles(1)[0],time:1,open:100,high:105,low:99.5,close:103,closed:true},
      {...candles(1)[0],time:2,open:103,high:104,low:101,close:106,closed:true}
    ];
    expect(isValidLiquiditySweep(highSweep,1,104,"high",2)).toBe(false);
    expect(isValidLiquiditySweep(highSweep,1,104,"high",1)).toBe(true);

    const lowSweep=[
      {...candles(1)[0],time:0,open:100,high:101,low:99,close:100,closed:true},
      {...candles(1)[0],time:1,open:100,high:100.5,low:95,close:97,closed:true},
      {...candles(1)[0],time:2,open:97,high:99,low:96,close:94,closed:true}
    ];
    expect(isValidLiquiditySweep(lowSweep,1,96,"low",2)).toBe(false);
    expect(isValidLiquiditySweep(lowSweep,1,96,"low",1)).toBe(true);
  });

  it("requires an entry zone to belong to the same post-sweep structure leg",()=>{
    expect(isPostSweepZoneCausal(20,25,30)).toBe(false);
    expect(isPostSweepZoneCausal(26,25,30)).toBe(true);
    expect(isPostSweepZoneCausal(20,19,30)).toBe(true);
    expect(isPostSweepZoneCausal(10,1,30,12)).toBe(false);
  });

  it("requires an order block to link to a structure break at or after displacement",()=>{
    expect(isOrderBlockCausal(10,12,12)).toBe(true);
    expect(isOrderBlockCausal(10,12,11)).toBe(false);
    expect(isOrderBlockCausal(10,12,25)).toBe(false);
    expect(isOrderBlockCausal(10,12,22,12)).toBe(true);
  });

  it("requires internal structure confirmation to follow the swing break",()=>{
    expect(isSMCCausalSequence(10,15,18)).toBe(true);
    expect(isSMCCausalSequence(10,15,14)).toBe(false);
    expect(isSMCCausalSequence(10,15,28)).toBe(false);
    expect(isSMCCausalSequence(10,22,null)).toBe(false);
  });

  it("requires the protected swing for an SMC CHOCH",()=>{\n    expect(classifyProtectedStructureBreak("bullish","high","low")).toBe("BOS");\n    expect(classifyProtectedStructureBreak("bullish","low","low")).toBe("CHOCH");\n    expect(classifyProtectedStructureBreak("bearish","low","high")).toBe("BOS");\n    expect(classifyProtectedStructureBreak("bearish","high","high")).toBe("CHOCH");\n    expect(classifyProtectedStructureBreak("bullish","low",null)).toBeNull();\n    expect(classifyProtectedStructureBreak("bearish","high",null)).toBeNull();\n  });\n\n  it("classifies BOS and CHOCH only from the prior structure direction",()=>{
    expect(classifyStructureBreak(null,"bullish")).toBe("BOS");
    expect(classifyStructureBreak("bullish","bullish")).toBe("BOS");
    expect(classifyStructureBreak("bearish","bullish")).toBe("CHOCH");
    expect(classifyStructureBreak("bearish","bearish")).toBe("BOS");
    expect(classifyStructureBreak("bullish","bearish")).toBe("CHOCH");
  });

  it("never emits two opposing structure events on the same candle",()=>{
    const c=candles(120);
    const m=analyzeSMC(c);
    const byIndex=new Map<number,Set<string>>();
    for(const e of m.events){
      if(!byIndex.has(e.index))byIndex.set(e.index,new Set());
      byIndex.get(e.index)!.add(e.direction);
    }
    for(const dirs of byIndex.values())expect(dirs.size).toBeLessThanOrEqual(1);
  });

  it("keeps zone state bounded to the supplied analysis window",()=>{
    const base=[
      {time:0,open:100,high:101,low:99,close:100,volume:100,closed:true},
      {time:1,open:100,high:100.5,low:99.5,close:100,volume:100,closed:true},
      {time:2,open:100,high:105,low:100.2,close:104,volume:100,closed:true}
    ];
    const future={time:3,open:101,high:102,low:99,close:100,volume:100,closed:true};
    const earlier=analyzeSMC([...candles(30),...base]);
    const later=analyzeSMC([...candles(30),...base,future]);
    expect(earlier.asOf).toBe(32);
    expect(later.asOf).toBe(33);
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
    expect(m.frames.find(x=>x.interval==="1h")?.available).toBe(false);    expect(m.frames.find(x=>x.interval==="1h")?.structure).toBe("UNAVAILABLE");
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

  it("does not treat an unfinished tail candle as backtestable data",()=>{
    const c=[...candles(80),{...candles(1)[0],time:80,closed:false}];
    const result=runSMCBacktest(c,1,30,0,0);
    expect(result.trades).toBe(0);
    expect(result.openAtEnd).toBe(0);
  });

  it("rejects invalid backtest configuration safely",()=>{
    const result=runSMCBacktest(candles(100),0,30,0,0);
    expect(result.trades).toBe(0);
    expect(result.openAtEnd).toBe(0);
  });

  it("accepts a structurally valid impulse in the advanced Elliott engine",()=>{
    const e=analyzeElliottAdvanced(
      [100,102,90,96,100,120,112,110,130,150,140,135,155,165,160,158,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175]
      .map((p,i)=>({time:i,open:p,high:p+0.05,low:p-0.05,close:p,volume:100,closed:true}))
    );
    expect(e.engine).toBe("ADVANCED_ELLIOTT_V2");
    expect(e.primary?.kind).toBe("Impulse");
    expect(e.primary?.strict).toBe(true);
  });

  it("requires a real five-wave nested impulse instead of a raw pivot count",()=>{
    expect(validateNestedImpulse([100,120,110,150,135,165],true).valid).toBe(true);
    expect(validateNestedImpulse([100,120,110,125,115,150],true).valid).toBe(false);
    expect(validateNestedImpulse([200,180,190,150,165,130],false).valid).toBe(true);
  });

  it("distinguishes regular, expanded and running flats",()=>{
    const regular=validateFlat([100,80,99,85],false);
    expect(regular.valid).toBe(true);
    expect(regular.subtype).toBe("Regular Flat");

    const expanded=validateFlat([100,80,105,70],false);
    expect(expanded.valid).toBe(true);
    expect(expanded.subtype).toBe("Expanded Flat");

    const running=validateFlat([100,80,105,88],false);
    expect(running.valid).toBe(true);
    expect(running.subtype).toBe("Running Flat");
  });

  it("rejects malformed double zigzags and accepts a valid W-X-Y structure",()=>{
    expect(validateDoubleZigzag([100,80,92,70,75,65,72,58],false).valid).toBe(true);
    expect(validateDoubleZigzag([100,80,92,70,95,65,72,58],false).valid).toBe(false);
  });

  it("validates live Elliott continuation with the required X-A-B-C geometry",()=>{
    expect(validateZigzag([165,150,158,145],false).valid).toBe(true);
    expect(validateFlat([165,150,164,146],false).valid).toBe(true);
    expect(validateZigzag([100,115,107,121],true).valid).toBe(true);
  });

  it("anchors live Elliott correction X to the completed Wave 5 endpoint",()=>{
    const primary={
      points:[0,2,4,6,8,10].map((index,i)=>({index,price:[100,120,110,150,135,165][i],label:String(i)})),
      kind:"Impulse" as const,direction:"bullish" as const,invalidation:100,entry:110,targets:[150,165],quality:80,rules:[],strict:true
    };
    const values=[160,155,152,151,150,152,154,156,157,158,156,153,149,146,145,146,147,148,149];
    const pre=[100,105,110,120,130,140,150,155,160,164,165];
    const c=[...pre,...values].map((p,i)=>({time:i,open:p,high:p+0.05,low:p-0.05,close:p,volume:100,closed:true}));
    const live=buildLiveContinuationSetup(c,primary);
    expect(live?.points[0].index).toBe(10);
    expect(live?.points[0].price).toBe(165);
    expect(live?.points.map(p=>p.label)).toEqual(["X","A","B","C"]);

    const invalidValues=[160,155,152,151,150,152,154,156,157,158,156,153,149,146,95,96,97,98,99];
    const invalidC=[...pre,...invalidValues].map((p,i)=>({time:i,open:p,high:p+0.05,low:p-0.05,close:p,volume:100,closed:true}));
    expect(buildLiveContinuationSetup(invalidC,primary)).toBeNull();
  });
  it("keeps corrective structures separate from the primary impulse count",()=>{
    expect(validateZigzag([200,150,170,130],false).valid).toBe(true);
    expect(validateFlat([200,150,195,145],false).valid).toBe(true);
    expect(analyzeElliottAdvanced(candles(100)).primary).toBeNull();
  });

  it("requires real contraction or expansion for a triangle candidate",()=>{
    expect(validateTriangle([100,110,104,108,106],true).contracting).toBe(true);
    expect(validateTriangle([100,110,95,125,80],true).expanding).toBe(true);
  });

  it("never promotes the fallback monotonic candle series to an Elliott count",()=>{
    const e=analyzeElliottAdvanced(candles(120));
    expect(e.primary).toBeNull();
    expect(e.setupState).toBe("NONE");
    expect(e.engine).toBe("ADVANCED_ELLIOTT_V2");
  });

  it("rejects a malformed flat whose C wave fails to reverse B",()=>{
    expect(validateFlat([100,80,101,102],false).valid).toBe(false);
  });

});