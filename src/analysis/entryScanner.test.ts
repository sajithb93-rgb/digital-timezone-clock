import { describe, expect, it } from "vitest";
import { classifySMCEntry, classifyElliottEntry } from "./entryScanner";

const baseSMC:any={
  trend:"Bullish",
  asOf:12,
  setup:{
    direction:"BUY",
    status:"ACTIVE",
    entry:100,
    stop:98,
    targets:[104],
    rr:2,
    confidence:85,
    confirmations:[
      "Liquidity sweep → structure break sequence aligned",
      "Swing structure aligned",
      "Internal structure aligned",
    ],
  },
  events:[{index:10,direction:"bullish",type:"BOS"}],
  entryZone:{low:99,high:101,type:"entry",sourceKind:"OB",originIndex:9},
  sweeps:[{index:8,type:"low",confirmed:true,displacement:true,displacementIndex:9}],
  premiumDiscount:"Discount",
  targets:[104],
};

const baseEW:any={
  primary:{direction:"bullish",entry:100,invalidation:98,targets:[104],strict:true,quality:80,kind:"Impulse"},
  liveSetup:{direction:"bullish",entry:100,invalidation:98,targets:[104],strict:true,quality:80,kind:"Correction"},
  confidence:85,setupState:"HISTORICAL"
};

describe("entry scanners",()=>{
  it("confirms a canonical active SMC setup",()=>{
    const r=classifySMCEntry("BTCUSDT","5m",baseSMC);
    expect(r.state).toBe("CONFIRMED");
    expect(r.direction).toBe("BUY");
    expect(r.entry).toBe(100);
  });

  it("does not rebuild SMC causality from unrelated latest event/sweep data",()=>{
    const r=classifySMCEntry("BTCUSDT","5m",{
      ...baseSMC,
      events:[{index:12,direction:"bearish",type:"CHOCH"}],
      sweeps:[{index:11,type:"high",confirmed:true,displacement:true,displacementIndex:12}],
    });
    expect(r.state).toBe("CONFIRMED");
    expect(r.direction).toBe("BUY");
  });

  it("does not confirm SMC when the engine is not ACTIVE",()=>{
    const r=classifySMCEntry("BTCUSDT","5m",{
      ...baseSMC,
      setup:{...baseSMC.setup,status:"WAIT"},
    });
    expect(r.state).not.toBe("CONFIRMED");
  });

  it("does not confirm SMC when direction is WAIT",()=>{
    const r=classifySMCEntry("BTCUSDT","5m",{
      ...baseSMC,
      setup:{...baseSMC.setup,direction:"WAIT",status:"WAIT"},
    });
    expect(r.state).not.toBe("CONFIRMED");
    expect(r.direction).toBe("BUY");
  });

  it("does not confirm SMC when entry geometry is invalid",()=>{
    const r=classifySMCEntry("BTCUSDT","5m",{
      ...baseSMC,
      setup:{...baseSMC.setup,stop:101},
    });
    expect(r.state).not.toBe("CONFIRMED");
  });

  it("rejects Elliott setup with invalid target geometry",()=>{
    const r=classifyElliottEntry("BTCUSDT","5m",{...baseEW,liveSetup:{...baseEW.liveSetup,targets:[99]}},102);
    expect(r.state).toBe("WAIT");
  });

  it("requires live price to remain between entry and target",()=>{
    expect(classifyElliottEntry("BTCUSDT","5m",baseEW,102).state).toBe("CONFIRMED");
    expect(classifyElliottEntry("BTCUSDT","5m",baseEW,110).state).not.toBe("CONFIRMED");
    expect(classifyElliottEntry("BTCUSDT","5m",baseEW,97).state).not.toBe("CONFIRMED");
  });
});
