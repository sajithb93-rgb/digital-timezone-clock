import { describe, expect, it } from "vitest";
import { analyzeSMC, classifyProtectedStructureBreak, detectStructureEvents, equalLevels, pivots, type Candle, type Pivot } from "./engine";

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
  it("exposes a valid analytical entry zone even when no confirmed causal setup exists", () => {
    const candles: Candle[] = Array.from({ length: 36 }, (_, i) => {
      const base = 100 + i;
      return {
        time: i,
        open: base,
        high: base + 1,
        low: base - 1,
        close: base + 0.5,
        volume: 100,
        closed: true,
      };
    });
    const result = analyzeSMC(candles);
    expect(result.trend).toBe("Bullish");
    expect(result.entryZone).not.toBeNull();
    expect(result.entryZone!.high).toBeGreaterThan(result.entryZone!.low);
  });
});
