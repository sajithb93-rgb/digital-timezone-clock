import { describe, expect, it } from "vitest";
import { analyzeSMC, chooseAnalyticalEntryZone, classifyProtectedStructureBreak, detectStructureEvents, equalLevels, pivots, setupWindowProfileForInterval, type Candle, type Pivot } from "./engine";

describe("protected SMC structure breaks", () => {
  it("does not classify a newer unprotected low as CHOCH", () => {
    expect(
      classifyProtectedStructureBreak("bullish", "low", "low", 10, 14),
    ).toBeNull();
  });

  it("classifies the actual protected low break as CHOCH", () => {
    expect(
      classifyProtectedStructureBreak("bullish", "low", "low", 10, 10),
    ).toBe("CHOCH");
  });

  it("keeps continuation breaks as BOS", () => {
    expect(
      classifyProtectedStructureBreak("bullish", "high", "low", 10, 12),
    ).toBe("BOS");
    expect(
      classifyProtectedStructureBreak("bearish", "low", "high", 10, 12),
    ).toBe("BOS");
  });
  it("preserves an equal-high plateau as a swing candidate for liquidity clustering", () => {
    const candles: Candle[] = [
      {time:0,open:98,high:99,low:97,close:98,volume:100,closed:true},
      {time:1,open:98,high:102,low:97,close:101,volume:100,closed:true},
      {time:2,open:101,high:105,low:100,close:104,volume:100,closed:true},
      {time:3,open:104,high:107,low:103,close:106,volume:100,closed:true},
      {time:4,open:106,high:108,low:104,close:107,volume:100,closed:true},
      {time:5,open:107,high:108,low:105,close:106,volume:100,closed:true},
      {time:6,open:106,high:107,low:104,close:105,volume:100,closed:true},
      {time:7,open:105,high:106,low:103,close:104,volume:100,closed:true},
    ];
    const ps=pivots(candles,1);
    expect(ps.some(p=>p.type==="H"&&p.price===108)).toBe(true);
  });

  it("detects CHOCH from the protected low even when a newer unprotected low exists", () => {
    const candles: Candle[] = [
      {time:0,open:99,high:100,low:95,close:99,volume:100,closed:true},
      {time:1,open:99,high:103,low:98,close:101,volume:100,closed:true},
      {time:2,open:101,high:107,low:100,close:106,volume:100,closed:true},
      {time:3,open:99,high:100,low:98,close:99,volume:100,closed:true},
      {time:4,open:99,high:100,low:93,close:94,volume:100,closed:true},
    ];
    const pivots: Pivot[] = [
      {index:0,price:102,type:"H",confirmedAt:0},
      {index:0,price:95,type:"L",confirmedAt:0},
      {index:3,price:98,type:"L",confirmedAt:3},
    ];
    const events=detectStructureEvents(candles,pivots);
    expect(events.map(e=>e.type)).toEqual(["BOS","CHOCH"]);
    expect(events[1].direction).toBe("bearish");
  });

  it("keeps a transitive equal-level price chain in one liquidity cluster", () => {
    const pivots: Pivot[] = [
      { index: 3, price: 100, type: "H", confirmedAt: 3 },
      { index: 8, price: 100.4, type: "H", confirmedAt: 8 },
      { index: 13, price: 100.8, type: "H", confirmedAt: 13 },
    ];
    const levels = equalLevels(pivots, 0.45);
    expect(levels).toHaveLength(1);
    expect(levels[0].index).toBe(13);
  });
});


describe("Setup Levels analytical display path", () => {
  it("selects a fresh unmitigated analytical order block without requiring ACTIVE confirmation", () => {
    const zone = chooseAnalyticalEntryZone(
      "bullish",
      [{index:20,low:100,high:102,type:"bullish",mitigated:false,strength:1}] as any,
      [],
      [],
      {time:30,open:101,high:103,low:100.5,close:102,volume:100,closed:true},
      1,
      30,
      {intervalMs:300000,sweepLookbackBars:20,structureGapBars:12,obAgeBars:50,zoneAgeBars:40}
    );
    expect(zone).not.toBeNull();
    expect(zone?.kind).toBe("OB");
    expect(zone?.linked).toBe(false);
    expect(zone!.high).toBeGreaterThan(zone!.low);
  });
});


describe("timeframe-consistent SMC setup windows", () => {
  it("keeps setup windows tied to elapsed market time", () => {
    const oneMinute = setupWindowProfileForInterval("1m");
    const fiveMinute = setupWindowProfileForInterval("5m");
    const fifteenMinute = setupWindowProfileForInterval("15m");
    expect(oneMinute.sweepLookbackBars).toBe(100);
    expect(fiveMinute.sweepLookbackBars).toBe(20);
    expect(fifteenMinute.sweepLookbackBars).toBe(7);
    expect(oneMinute.structureGapBars).toBe(60);
    expect(fiveMinute.structureGapBars).toBe(12);
    expect(oneMinute.obAgeBars).toBe(250);
    expect(fiveMinute.obAgeBars).toBe(50);
    expect(oneMinute.zoneAgeBars).toBe(200);
    expect(fiveMinute.zoneAgeBars).toBe(40);
  });
});
