import { describe, expect, it } from "vitest";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle, buildImpulseFibLevels, impulseMetrics, classifyStructureBreak, isOrderBlockCausal, isPostSweepZoneCausal, isSetupActive, isSMCCausalSequence, isValidLiquiditySweep, findFvgs, makeBreakers, isEntryZoneCausal, isValidTradeGeometry, classifyPremiumDiscount, findLatestValidLiquiditySweep, mtfFrameWeight, validateDiagonalWave, validateImpulseWave, classifyProtectedStructureBreak } from "./engine";
import { flowSnapshot, riskPlan, runSMCBacktest } from "./advanced";
import { analyzeElliottAdvanced, buildLiveContinuationSetup, validateDoubleZigzag, validateFlat, validateNestedImpulse, validateTriangle, validateZigzag, isCompletedWaveCountInvalidated } from "./elliott";

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
  it("validates double zigzag W-X-Y with an explicit countertrend X connector",()=>{
    const bullish=[100,110,105,115,106,116,111,123];
    const bearish=[123,113,118,108,117,107,112,100];
    expect(validateDoubleZigzag(bullish,true).valid).toBe(true);
    expect(validateDoubleZigzag(bearish,false).valid).toBe(true);
    expect(validateDoubleZigzag([100,110,105,115,120,126,121,130],true).valid).toBe(false);
  });

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

  it("rejects risk sizing when direction is WAIT",()=>{
    expect(riskPlan(1000,1,100,95,{}, "WAIT").valid).toBe(false);
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

  it("selects the newest currently valid liquidity sweep at one level",()=>{
    const data=[
      {...candles(1)[0],time:0,open:100,high:101,low:99,close:100,closed:true},
      {...candles(1)[0],time:1,open:100,high:105,low:99,close:103,closed:true},
      {...candles(1)[0],time:2,open:103,high:104,low:101,close:106,closed:true},
      {...candles(1)[0],time:3,open:106,high:107,low:102,close:106.5,closed:true},
      {...candles(1)[0],time:4,open:106.5,high:105.5,low:102,close:104,closed:true},
      {...candles(1)[0],time:5,open:104,high:106,low:102.5,close:104.5,closed:true}
    ];
    const latest=findLatestValidLiquiditySweep(data,105,"high",1,5);
    expect(latest?.index).toBe(5);
    expect(latest?.type).toBe("high");
  });

  it("does not let an unfinished candle invalidate a liquidity sweep",()=>{
    const data=[
      {...candles(1)[0],time:0,open:100,high:101,low:99,close:100,closed:true},
      {...candles(1)[0],time:1,open:100,high:105,low:99,close:104,closed:true},
      {...candles(1)[0],time:2,open:104,high:106,low:103,close:104.5,closed:false}
    ];
    expect(isValidLiquiditySweep(data,1,104.5,"high",2)).toBe(true);
    expect(findLatestValidLiquiditySweep(data,104.5,"high",1,2)?.index).toBe(1);
  });

  it("requires an entry zone to belong to the same post-sweep structure leg",()=>{
    expect(isPostSweepZoneCausal(20,25,30)).toBe(false);
    expect(isPostSweepZoneCausal(26,25,30)).toBe(true);
    expect(isPostSweepZoneCausal(20,19,30)).toBe(true);
    expect(isPostSweepZoneCausal(10,1,30,12)).toBe(false);
  });

  it("tracks bullish FVG lifecycle from creation through full fill",()=>{
    const base=[
      {time:0,open:99,high:100,low:98,close:99.5,volume:100,closed:true},
      {time:1,open:100.2,high:102,low:100.1,close:101.5,volume:100,closed:true},
      {time:2,open:101.6,high:103,low:101,close:102.5,volume:100,closed:true}
    ];
    const partial=findFvgs([...base,{time:3,open:102,high:103,low:100.5,close:101,volume:100,closed:true}],1,3);
    const partialGap=partial.find(x=>x.from===0&&x.to===2&&x.type==="bullish");
    expect(partialGap?.low).toBe(100);
    expect(partialGap?.high).toBe(101);
    expect(partialGap?.filled).toBe(false);
    expect(partialGap?.partial).toBe(true);
    expect(partialGap?.partialFillIndex).toBe(3);

    const full=findFvgs([...base,
      {time:3,open:102,high:103,low:100.5,close:101,volume:100,closed:true},
      {time:4,open:101,high:102,low:99.9,close:100,volume:100,closed:true}
    ],1,4);
    const fullGap=full.find(x=>x.from===0&&x.to===2&&x.type==="bullish");
    expect(fullGap?.filled).toBe(true);
    expect(fullGap?.fillIndex).toBe(4);
  });

  it("tracks bearish FVG lifecycle symmetrically",()=>{
    const base=[
      {time:0,open:101,high:102,low:100,close:101.5,volume:100,closed:true},
      {time:1,open:100.8,high:101,low:98,close:99,volume:100,closed:true},
      {time:2,open:98.5,high:99,low:97,close:97.5,volume:100,closed:true}
    ];
    const partial=findFvgs([...base,{time:3,open:98,high:99.5,low:97,close:99,volume:100,closed:true}],1,3);
    const partialGap=partial.find(x=>x.from===0&&x.to===2&&x.type==="bearish");
    expect(partialGap?.low).toBe(99);
    expect(partialGap?.high).toBe(100);
    expect(partialGap?.filled).toBe(false);
    expect(partialGap?.partial).toBe(true);
    expect(partialGap?.partialFillIndex).toBe(3);

    const full=findFvgs([...base,
      {time:3,open:98,high:99.5,low:97,close:99,volume:100,closed:true},
      {time:4,open:99,high:100.1,low:98,close:100,volume:100,closed:true}
    ],1,4);
    const fullGap=full.find(x=>x.from===0&&x.to===2&&x.type==="bearish");
    expect(fullGap?.filled).toBe(true);
    expect(fullGap?.fillIndex).toBe(4);
  });

  it("never lets an unfinished candle create or fill an FVG",()=>{
    const c=[
      {time:0,open:99,high:100,low:98,close:99.5,volume:100,closed:true},
      {time:1,open:100.2,high:102,low:100.1,close:101.5,volume:100,closed:true},
      {time:2,open:101.6,high:103,low:101,close:102.5,volume:100,closed:true},
      {time:3,open:102,high:103,low:99.9,close:100,volume:100,closed:false}
    ];
    const gaps=findFvgs(c,1,3);
    const gap=gaps.find(x=>x.from===0&&x.to===2&&x.type==="bullish");
    expect(gap?.filled).toBe(false);
    expect(gap?.partial).toBe(false);
    expect(gap?.fillIndex).toBeUndefined();
  });

  it("creates a breaker only after a mitigated order block is broken",()=>{
    const ob={index:1,low:99,high:105,type:"bullish" as const,mitigated:true,mitigationIndex:3,strength:1};
    const breakerCandles=[
      {...candles(1)[0],time:0,closed:true},
      {...candles(1)[0],time:1,open:105,high:106,low:99,close:100,closed:true},
      {...candles(1)[0],time:2,open:100,high:106,low:100,close:104,closed:true},
      {...candles(1)[0],time:3,open:104,high:106,low:103,close:104.5,closed:true},
      {...candles(1)[0],time:4,open:104,high:104.5,low:98,close:98.5,closed:true},
      {...candles(1)[0],time:5,open:98.5,high:101,low:97.5,close:100,closed:true}
    ];
    const breakers=makeBreakers([ob],breakerCandles,5);
    expect(breakers).toHaveLength(1);
    expect(breakers[0]).toMatchObject({index:4,type:"bearish",low:99,high:105,active:true});
  });

  it("does not call simple mitigation a breaker",()=>{
    const ob={index:1,low:99,high:105,type:"bullish" as const,mitigated:true,mitigationIndex:3,strength:1};
    const data=[
      {...candles(1)[0],time:0,closed:true},
      {...candles(1)[0],time:1,open:105,high:106,low:99,close:100,closed:true},
      {...candles(1)[0],time:2,open:100,high:106,low:100,close:104,closed:true},
      {...candles(1)[0],time:3,open:104,high:106,low:103,close:104.5,closed:true}
    ];
    expect(makeBreakers([ob],data,3)).toEqual([]);
  });

  it("does not create a breaker from an unfinished post-mitigation candle",()=>{
    const ob={index:1,low:99,high:105,type:"bullish" as const,mitigated:true,mitigationIndex:3,strength:1};
    const data=[
      {...candles(1)[0],time:0,closed:true},
      {...candles(1)[0],time:1,open:105,high:106,low:99,close:100,closed:true},
      {...candles(1)[0],time:2,open:100,high:106,low:100,close:104,closed:true},
      {...candles(1)[0],time:3,open:104,high:106,low:103,close:104.5,closed:true},
      {...candles(1)[0],time:4,open:104,high:104.5,low:98,close:98.5,closed:false}
    ];
    expect(makeBreakers([ob],data,4)).toEqual([]);
  });

  it("invalidates a breaker when price closes back through the flipped zone",()=>{
    const ob={index:1,low:99,high:105,type:"bullish" as const,mitigated:true,mitigationIndex:3,strength:1};
    const data=[
      {...candles(1)[0],time:0,closed:true},
      {...candles(1)[0],time:1,open:105,high:106,low:99,close:100,closed:true},
      {...candles(1)[0],time:2,open:100,high:106,low:100,close:104,closed:true},
      {...candles(1)[0],time:3,open:104,high:106,low:103,close:104.5,closed:true},
      {...candles(1)[0],time:4,open:104,high:104.5,low:98,close:98.5,closed:true},
      {...candles(1)[0],time:5,open:98.5,high:106,low:98,close:105.5,closed:true}
    ];
    expect(makeBreakers([ob],data,5)).toEqual([]);
  });

  it("keeps breaker causality distinct from pre-break zone causality",()=>{
    expect(isEntryZoneCausal(26,25,30,"OB")).toBe(true);
    expect(isEntryZoneCausal(26,25,30,"FVG")).toBe(true);
    expect(isEntryZoneCausal(31,25,30,"OB")).toBe(false);
    expect(isEntryZoneCausal(34,25,30,"BREAKER")).toBe(true);
    expect(isEntryZoneCausal(44,25,30,"BREAKER")).toBe(false);
    expect(isEntryZoneCausal(28,25,30,"BREAKER")).toBe(false);
  });

  it("classifies premium and discount only from a valid dealing range",()=>{
    expect(classifyPremiumDiscount(110,120,100)).toBe("Equilibrium");
    expect(classifyPremiumDiscount(115,120,100)).toBe("Premium");
    expect(classifyPremiumDiscount(105,120,100)).toBe("Discount");
    expect(classifyPremiumDiscount(100,100,100)).toBe("Equilibrium");
  });

  it("does not let an unfinished candle alter the SMC dealing range",()=>{
    const base=candles(80);
    const live={time:80,open:1,high:10000,low:1,close:9999,volume:100,closed:false};
    const a=analyzeSMC(base);
    const b=analyzeSMC([...base,live]);
    expect(b.asOf).toBe(a.asOf);
    expect(b.premiumDiscountRange).toEqual(a.premiumDiscountRange);
    expect(b.premiumDiscount).toBe(a.premiumDiscount);
  });

  it("rejects SMC trade geometry when the stop is on the wrong side",()=>{
    expect(isValidTradeGeometry("BUY",100,100.5,[103],1.5)).toBe(false);
    expect(isValidTradeGeometry("SELL",100,99.5,[97],1.5)).toBe(false);
    expect(isValidTradeGeometry("BUY",100,98,[103],1.5)).toBe(true);
    expect(isValidTradeGeometry("SELL",100,102,[97],1.5)).toBe(true);
  });

  it("rejects targets that are on the wrong side or below the minimum RR",()=>{
    expect(isValidTradeGeometry("BUY",100,98,[101],1.5)).toBe(false);
    expect(isValidTradeGeometry("SELL",100,102,[99],1.5)).toBe(false);
    expect(isValidTradeGeometry("BUY",100,98,[103],1.5)).toBe(true);
    expect(isValidTradeGeometry("SELL",100,102,[97],1.5)).toBe(true);
  });

  it("rejects malformed target arrays instead of silently filtering invalid values",()=>{
    expect(isValidTradeGeometry("BUY",100,98,[103,Number.NaN],1.5)).toBe(false);
    expect(isValidTradeGeometry("BUY",100,98,[103,-105],1.5)).toBe(false);
  });

  it("makes SMC analysis independent of feed ordering and duplicate timestamps",()=>{
    const base=candles(80);
    const duplicate={...base[40],close:base[40].close+0.25};
    const ordered=analyzeSMC(base);
    const reversed=analyzeSMC([...base,duplicate].reverse());
    expect(reversed.asOf).toBe(ordered.asOf);
    expect(reversed.premiumDiscountRange).toEqual(ordered.premiumDiscountRange);
    expect(reversed.premiumDiscount).toBe(ordered.premiumDiscount);
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

  it("requires the protected swing for an SMC CHOCH",()=>{
    expect(classifyProtectedStructureBreak("bullish","high","low")).toBe("BOS");
    expect(classifyProtectedStructureBreak("bullish","low","low")).toBe("CHOCH");
    expect(classifyProtectedStructureBreak("bearish","low","high")).toBe("BOS");
    expect(classifyProtectedStructureBreak("bearish","high","high")).toBe("CHOCH");
    expect(classifyProtectedStructureBreak("bullish","low",null)).toBeNull();
    expect(classifyProtectedStructureBreak("bearish","high",null)).toBeNull();
  });

  it("classifies BOS and CHOCH only from the prior structure direction",()=>{
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

  it("weights higher MTF frames more than lower frames",()=>{
    expect(mtfFrameWeight("1d")).toBeGreaterThan(mtfFrameWeight("4h"));
    expect(mtfFrameWeight("4h")).toBeGreaterThan(mtfFrameWeight("1h"));
    expect(mtfFrameWeight("1h")).toBeGreaterThan(mtfFrameWeight("15m"));
    expect(mtfFrameWeight("15m")).toBeGreaterThan(mtfFrameWeight("5m"));
    expect(mtfFrameWeight("5m")).toBeGreaterThan(mtfFrameWeight("1m"));
  });

  it("does not count an invalidated Elliott primary as current MTF directional evidence",()=>{
    const base=[100,120,110,150,135,165,160,155,150,145,140,135,130,125,120,115,110,105,100,95,90,85,80,75,70,65,60,55,50,45]
      .map((p,i)=>({time:i,open:p,high:p+0.05,low:p-0.05,close:p,volume:100,closed:true}));
    const extended=[
      ...base,
      {time:30,open:45,high:46,low:44,close:40,volume:100,closed:true},
      {time:31,open:40,high:41,low:39,close:39,volume:100,closed:true}
    ];
    const m=analyzeMTF([{interval:"4h",candles:extended}]);
    const ew=analyzeElliottAdvanced(extended);
    if(ew.setupState==="INVALIDATED"){
      expect(m.frames[0].elliottTrend).toBe("Neutral");
      expect(m.frames[0].elliottScore).toBe(0);
    }
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
    expect(validateDiagonalWave([100,140,120,150,130,160],true).valid).toBe(false);
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

  it("permanently invalidates a completed Elliott count after an origin close",()=>{
    const primary={
      points:[0,2,4,6,8,10].map((index,i)=>({index,price:[100,120,110,150,135,165][i],label:String(i)})),
      kind:"Impulse" as const,
      direction:"bullish" as const,
      invalidation:100,
      entry:110,
      targets:[150,165],
      quality:80,
      rules:[],
      strict:true
    };
    const data=[
      ...Array.from({length:11},(_,i)=>({time:i,open:160,high:161,low:159,close:160,volume:100,closed:true})),
      {time:11,open:120,high:121,low:95,close:99,volume:100,closed:true},
      {time:12,open:99,high:121,low:98,close:120,volume:100,closed:true}
    ];
    expect(isCompletedWaveCountInvalidated(data,primary)).toBe(true);
  });

  it("stops Elliott invalidation scanning at an unclosed candle gap",()=>{
    const primary={
      points:[0,2,4,6,8,10].map((index,i)=>({index,price:[100,120,110,150,135,165][i],label:String(i)})),
      kind:"Impulse" as const,
      direction:"bullish" as const,
      invalidation:100,
      entry:110,
      targets:[150,165],
      quality:80,
      rules:[],
      strict:true
    };
    const data=[
      ...Array.from({length:11},(_,i)=>({time:i,open:160,high:161,low:159,close:160,volume:100,closed:true})),
      {time:11,open:160,high:161,low:159,close:160,volume:100,closed:false},
      {time:12,open:90,high:91,low:89,close:90,volume:100,closed:true}
    ];
    expect(isCompletedWaveCountInvalidated(data,primary)).toBe(false);
  });

  it("does not let closed candles after an unclosed gap leak into Elliott counts",()=>{
    const base=[
      100,102,90,96,100,120,112,110,130,150,140,135,155,165,160,158,
      161,162,163,164,165,166,167,168,169,170,171,172,173,174,175
    ].map((p,i)=>({time:i,open:p,high:p+0.05,low:p-0.05,close:p,volume:100,closed:true}));
    const prefix=analyzeElliottAdvanced(base.slice(0,30));
    const gap=[
      ...base.slice(0,30),
      {...base[30],closed:false},
      {...base[30],time:31,closed:true}
    ];
    const withGap=analyzeElliottAdvanced(gap);
    expect(withGap.candidateCount).toBe(prefix.candidateCount);
    expect(withGap.primary?.points.map(p=>p.index)).toEqual(prefix.primary?.points.map(p=>p.index));
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
  it("invalidates an Elliott live continuation after price reaches its target",()=>{
    const primary={
      points:[0,2,4,6,8,10].map((index,i)=>({index,price:[100,120,110,150,135,165][i],label:String(i)})),
      kind:"Impulse" as const,
      direction:"bullish" as const,
      invalidation:100,
      entry:110,
      targets:[150,165],
      quality:80,
      rules:[],
      strict:true
    };
    const values=[160,155,152,151,150,152,154,156,157,158,156,153,149,146,145,146,147,148,200];
    const pre=[100,105,110,120,130,140,150,155,160,164,165];
    const c=[...pre,...values].map((p,i)=>({time:i,open:p,high:p+0.05,low:p-0.05,close:p,volume:100,closed:true}));
    expect(buildLiveContinuationSetup(c,primary)).toBeNull();
  });

  it("keeps corrective structures separate from the primary impulse count",()=>{
    expect(validateZigzag([200,150,170,130],false).valid).toBe(true);
    expect(validateFlat([200,150,195,145],false).valid).toBe(true);
    expect(analyzeElliottAdvanced(candles(100)).primary).toBeNull();
  });

  it("requires real contraction or expansion for a triangle candidate",()=>{
    expect(validateTriangle([100,110,104,108,106,107],true).contracting).toBe(true);
    expect(validateTriangle([100,110,104,110.3,106,109.8],true).barrier).toBe(true);
    expect(validateTriangle([100,110,95,125,80,130],true).expanding).toBe(true);
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