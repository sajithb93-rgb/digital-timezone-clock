import { describe, expect, it } from "vitest";
import { generateSMCSignal, isConfirmedSMCSignal } from "./smcSignalEngine";
import {
  analyzeSMC,
  findLatestSMCCausalSequence,
  isEntryZoneCausal,
  isSetupActive,
  isZoneRetestAfterFormation,
  isValidTradeGeometry,
  type Candle,
  type StructureEvent,
  type Sweep,
} from "./engine";

function candles(rows: Array<[number, number, number, number]>): Candle[] {
  return rows.map(([open, high, low, close], time) => ({
    time,
    open,
    high,
    low,
    close,
    volume: 100,
    closed: true,
  }));
}

describe("SMC signal engine", () => {
  it("does not use an open candle as the analysis endpoint", () => {
    const c = candles(
      Array.from({ length: 80 }, (_, i) => [
        100 + i * 0.1,
        101 + i * 0.1,
        99 + i * 0.1,
        100 + i * 0.1,
      ]),
    );
    c[c.length - 1].closed = false;
    const s = generateSMCSignal(c);
    expect(s === null || s.asOf < c.length - 1).toBe(true);
  });

  it("rejects invalid BUY geometry", () => {
    const invalid = {
      status: "ACTIVE" as const,
      direction: "BUY" as const,
      entry: 100,
      stop: 101,
      targets: [110, 120],
      rr: 1.5,
      confidence: 90,
      asOf: 50,
      confirmations: [],
      sweepIndex: 1,
      structureIndex: 2,
      zoneIndex: 3,
      zoneType: "FVG" as const,
      entryZone: { low: 99, high: 101 },
      premiumDiscount: "Discount" as const,
    };
    expect(isConfirmedSMCSignal(invalid)).toBe(false);
  });

  it("rejects malformed confirmed-signal metadata", () => {
    const invalid = {
      status: "ACTIVE" as const,
      direction: "BUY" as const,
      entry: 100,
      stop: 95,
      targets: [110, 120],
      rr: 2,
      confidence: 90,
      asOf: 50,
      confirmations: ["confirmed"],
      sweepIndex: -1,
      structureIndex: 10,
      zoneIndex: 20,
      zoneType: "FVG" as const,
      entryZone: { low: 99, high: 101 },
      premiumDiscount: "Discount" as const,
    };
    expect(isConfirmedSMCSignal(invalid)).toBe(false);
  });

  it("keeps causal indices stable when the latest open candle is excluded", () => {
    const c = candles(
      Array.from({ length: 100 }, (_, i) => [
        100 + Math.sin(i / 5),
        101 + Math.sin(i / 5),
        99 + Math.sin(i / 5),
        100 + Math.sin(i / 5),
      ]),
    );
    c[c.length - 1].closed = false;

    const prefix = c.slice(0, -1);
    const result = analyzeSMC(prefix);
    expect(result.asOf).toBe(prefix.length - 1);

    const direct = generateSMCSignal(c, c.length - 2, "5m");
    expect(direct === null || direct.asOf <= c.length - 2).toBe(true);
    if (direct) {
      expect(direct.sweepIndex).toBeLessThanOrEqual(direct.asOf);
      expect(direct.structureIndex).toBeLessThanOrEqual(direct.asOf);
      expect(direct.zoneIndex).toBeLessThanOrEqual(direct.asOf);
    }
  });

  it("never accepts an earlier open candle as confirmed history", () => {
    const c = candles(
      Array.from({ length: 80 }, (_, i) => [
        100 + i * 0.1,
        101 + i * 0.1,
        99 + i * 0.1,
        100 + i * 0.1,
      ]),
    );
    c[60].closed = false;
    const result = analyzeSMC(c);
    expect(result.asOf).toBeLessThan(60);
  });

  it("rejects targets that do not meet minimum RR", () => {
    const invalid = {
      status: "ACTIVE" as const,
      direction: "SELL" as const,
      entry: 100,
      stop: 101,
      targets: [99, 98],
      rr: 1,
      confidence: 90,
      asOf: 50,
      confirmations: [],
      sweepIndex: 1,
      structureIndex: 2,
      zoneIndex: 3,
      zoneType: "OB" as const,
      entryZone: { low: 99, high: 101 },
      premiumDiscount: "Premium" as const,
    };
    expect(isConfirmedSMCSignal(invalid)).toBe(false);
  });

  it("rejects reversed or duplicate target ordering", () => {
    expect(isValidTradeGeometry("BUY", 100, 95, [110, 108], 1.5)).toBe(false);
    expect(isValidTradeGeometry("SELL", 100, 105, [90, 90], 1.5)).toBe(false);
  });

  it("selects the freshest compatible sweep for the latest swing event", () => {
    const sweeps: Sweep[] = [
      { index: 5, price: 99, type: "low", confirmed: true, displacement: true },
      { index: 20, price: 98, type: "low", confirmed: true, displacement: true },
    ];
    const events: StructureEvent[] = [
      { index: 17, price: 103, type: "BOS", direction: "bullish", strength: "displacement" },
      { index: 22, price: 104, type: "BOS", direction: "bullish", strength: "displacement" },
    ];
    const internalEvents: StructureEvent[] = [
      { index: 25, price: 105, type: "BOS", direction: "bullish", strength: "normal" },
    ];

    const chain = findLatestSMCCausalSequence(sweeps, events, internalEvents, 40, 12);
    expect(chain).not.toBeNull();
    expect(chain?.structure.index).toBe(22);
    expect(chain?.internal.index).toBe(25);
    expect(chain?.sweep.index).toBe(20);
  });

  it("rejects an older bullish chain after a newer opposite swing event", () => {
    const sweeps: Sweep[] = [
      { index: 5, price: 99, type: "low", confirmed: true, displacement: true },
    ];
    const events: StructureEvent[] = [
      { index: 15, price: 103, type: "BOS", direction: "bullish", strength: "displacement" },
      { index: 25, price: 96, type: "CHOCH", direction: "bearish", strength: "normal" },
    ];
    const internalEvents: StructureEvent[] = [
      { index: 17, price: 102.5, type: "BOS", direction: "bullish", strength: "normal" },
    ];

    expect(findLatestSMCCausalSequence(sweeps, events, internalEvents, 30, 12)).toBeNull();
  });

  it("requires sweep displacement to occur no later than the swing structure break", () => {
    const sweepsBeforeStructure: Sweep[] = [
      { index: 10, price: 99, type: "low", confirmed: true, displacement: true, displacementIndex: 11 },
    ];
    const sweepsAfterStructure: Sweep[] = [
      { index: 10, price: 99, type: "low", confirmed: true, displacement: true, displacementIndex: 16 },
    ];
    const events: StructureEvent[] = [
      { index: 15, price: 103, type: "BOS", direction: "bullish", strength: "displacement" },
    ];
    const internalEvents: StructureEvent[] = [
      { index: 17, price: 104, type: "BOS", direction: "bullish", strength: "normal" },
    ];

    expect(findLatestSMCCausalSequence(sweepsBeforeStructure, events, internalEvents, 20, 12)).not.toBeNull();
    expect(findLatestSMCCausalSequence(sweepsAfterStructure, events, internalEvents, 20, 12)).toBeNull();
  });

  it("does not accept same-candle swing and internal confirmation as a causal chain", () => {
    const sweeps: Sweep[] = [
      { index: 5, price: 99, type: "low", confirmed: true, displacement: true },
    ];
    const events: StructureEvent[] = [
      { index: 10, price: 103, type: "BOS", direction: "bullish", strength: "displacement" },
    ];
    const internalEvents: StructureEvent[] = [
      { index: 10, price: 103, type: "BOS", direction: "bullish", strength: "normal" },
    ];

    expect(findLatestSMCCausalSequence(sweeps, events, internalEvents, 20, 12)).toBeNull();
  });

  it("does not attach distant post-structure FVG or breaker zones", () => {
    expect(isEntryZoneCausal(15, 10, 15, "FVG", 12)).toBe(true);
    expect(isEntryZoneCausal(18, 10, 15, "FVG", 12)).toBe(true);
    expect(isEntryZoneCausal(19, 10, 15, "FVG", 12)).toBe(false);
    expect(isEntryZoneCausal(15, 10, 15, "BREAKER", 12)).toBe(true);
    expect(isEntryZoneCausal(18, 10, 15, "BREAKER", 12)).toBe(true);
    expect(isEntryZoneCausal(19, 10, 15, "BREAKER", 12)).toBe(false);
  });

  it("requires a completed zone before allowing a retest", () => {
    expect(isZoneRetestAfterFormation(10, 9)).toBe(true);
    expect(isZoneRetestAfterFormation(10, 10)).toBe(false);
    expect(isZoneRetestAfterFormation(9, 10)).toBe(false);
    expect(isZoneRetestAfterFormation(10, -1)).toBe(false);
  });

  it("does not use the current retest candle as internal confirmation", () => {
    const sweeps: Sweep[] = [
      { index: 5, price: 99, type: "low", confirmed: true, displacement: true, displacementIndex: 6 },
    ];
    const events: StructureEvent[] = [
      { index: 10, price: 103, type: "BOS", direction: "bullish", strength: "displacement" },
    ];
    const internalEvents: StructureEvent[] = [
      { index: 20, price: 104, type: "BOS", direction: "bullish", strength: "normal" },
    ];

    expect(findLatestSMCCausalSequence(sweeps, events, internalEvents, 20, 12)).toBeNull();
    expect(findLatestSMCCausalSequence(sweeps, events, internalEvents, 21, 12)).not.toBeNull();
  });

  it("requires an executable zone to be valid and touched by a closed candle", () => {
    const zone = { low: 99, high: 101, type: "entry" as const };
    expect(
      isSetupActive(zone, {
        time: 1,
        open: 100,
        high: 100.5,
        low: 99.5,
        close: 100,
        volume: 1,
        closed: true,
      }),
    ).toBe(true);
    expect(
      isSetupActive(zone, {
        time: 2,
        open: 102,
        high: 103,
        low: 102,
        close: 102.5,
        volume: 1,
        closed: true,
      }),
    ).toBe(false);
    expect(
      isSetupActive(zone, {
        time: 3,
        open: 100,
        high: 100.5,
        low: 99.5,
        close: 100,
        volume: 1,
        closed: false,
      }),
    ).toBe(false);
    expect(
      isSetupActive(
        { low: 101, high: 99, type: "entry" },
        {
          time: 4,
          open: 100,
          high: 102,
          low: 98,
          close: 100,
          volume: 1,
          closed: true,
        },
      ),
    ).toBe(false);
  });
});
