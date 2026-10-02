import { describe, expect, it } from "vitest";
import { getNewsRisk, normalizeNews } from "./news";

describe("news filter",()=>{
  it("prefers an upcoming high-impact event over an older post-news event",()=>{
    const now=1_000_000;
    const events=[
      {title:"Older CPI",country:"USD",impact:"high" as const,date:now-20*60_000},
      {title:"Upcoming FOMC",country:"USD",impact:"high" as const,date:now+10*60_000},
    ];
    const r=getNewsRisk(events,now,30);
    expect(r.level).toBe("HIGH");
    expect(r.nextEvent?.title).toBe("Upcoming FOMC");
    expect(r.minutesToEvent).toBe(10);
  });

  it("prefers an upcoming medium-impact event over a nearer completed one",()=>{
    const now=1_000_000;
    const events=[
      {title:"Recent PPI",country:"USD",impact:"medium" as const,date:now-5*60_000},
      {title:"Upcoming PMI",country:"USD",impact:"medium" as const,date:now+8*60_000},
    ];
    const r=getNewsRisk(events,now,30);
    expect(r.level).toBe("MEDIUM");
    expect(r.nextEvent?.title).toBe("Upcoming PMI");
    expect(r.minutesToEvent).toBe(8);
    expect(r.minutesSinceEvent).toBeUndefined();
  });

  it("falls back safely for invalid news buffer values",()=>{
    const now=1_000_000;
    const event={title:"Upcoming CPI",country:"USD",impact:"high" as const,date:now+5*60_000};
    expect(getNewsRisk([event],now,-30).blocked).toBe(false);
    expect(getNewsRisk([event],now,Number.NaN).blocked).toBe(true);
  });

  it("parses numeric-string epoch timestamps",()=>{
    const rows=normalizeNews([{title:"Epoch CPI",country:"USD",impact:"high",date:"1790938800000"}]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe(1790938800000);
  });

  it("does not misclassify arbitrary numeric strings containing 3 as high impact",()=>{
    const rows=normalizeNews([
      {title:"Routine release",country:"USD",impact:"13",date:"2026-10-02T10:00:00Z"},
      {title:"Actual high",country:"USD",impact:"3",date:"2026-10-02T11:00:00Z"},
    ]);
    expect(rows[0]?.impact).toBe("low");
    expect(rows[1]?.impact).toBe("high");
  });
});
