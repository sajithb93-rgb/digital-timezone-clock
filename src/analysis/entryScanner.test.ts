import { describe, expect, it } from "vitest";
import { classifySMCEntry, classifyElliottEntry } from "./entryScanner";

const baseSMC:any={trend:"Bullish",asOf:12,setup:{direction:"BUY",status:"ACTIVE",entry:100,stop:98,targets:[104],rr:2,confidence:85,confirmations:["Liquidity sweep → structure break sequence aligned","Swing structure aligned","Internal structure aligned"]},events:[{index:10,direction:"bullish",type:"BOS"}],entryZone:{low:99,high:101},sweeps:[{index:8,type:"low"}],premiumDiscount:"Discount",targets:[104]};

const baseEW:any={
  primary:{direction:"bullish",entry:100,invalidation:98,targets:[104],strict:true,quality:80,kind:"Impulse"},
  liveSetup:{direction:"bullish",entry:100,invalidation:98,targets:[104],strict:true,quality:80,kind:"Correction"},
  confidence:85,setupState:"HISTORICAL"
};

describe("entry scanners",()=>{
 it("confirms an active SMC setup",()=>{const r=classifySMCEntry("BTCUSDT","5m",baseSMC);expect(r.state).toBe("CONFIRMED");expect(r.direction).toBe("BUY");expect(r.entry).toBe(100)});
 it("does not infer an SMC entry direction from trend when setup direction is WAIT",()=>{const r=classifySMCEntry("BTCUSDT","5m",{...baseSMC,setup:{...baseSMC.setup,direction:"WAIT",status:"WAIT"}});expect(r.direction).toBe("NONE");expect(r.state).toBe("WAIT")});
 it("does not depend on confirmation-string wording for an ACTIVE SMC setup",()=>{
   const r=classifySMCEntry("BTCUSDT","5m",{...baseSMC,setup:{...baseSMC.setup,confirmations:["Custom structured evidence"]}});
   expect(r.state).toBe("CONFIRMED");
 });
 it("does not confirm an ACTIVE SMC setup on CHOCH alone",()=>{
   const r=classifySMCEntry("BTCUSDT","5m",{...baseSMC,events:[{index:10,direction:"bullish",type:"CHOCH"}]});
   expect(r.state).not.toBe("CONFIRMED");
 });
 it("rejects an ACTIVE SMC setup when sweep occurs after the structure break",()=>{
   const r=classifySMCEntry("BTCUSDT","5m",{...baseSMC,events:[{index:8,direction:"bullish",type:"BOS"}],sweeps:[{index:10,type:"low"}]});
   expect(r.state).not.toBe("CONFIRMED");
 });
 it("does not confirm SMC when the sweep-to-structure gap is stale",()=>{
   const r=classifySMCEntry("BTCUSDT","5m",{...baseSMC,asOf:30,events:[{index:24,direction:"bullish",type:"BOS"}],sweeps:[{index:8,type:"low"}]});
   expect(r.state).not.toBe("CONFIRMED");
 });
 it("does not confirm SMC when internal structure confirmation is missing",()=>{
   const r=classifySMCEntry("BTCUSDT","5m",{...baseSMC,setup:{...baseSMC.setup,confirmations:["Liquidity sweep → structure break sequence aligned","Swing structure aligned"]}});
   expect(r.state).not.toBe("CONFIRMED");
 });
 it("does not confirm SMC when active entry is missing",()=>{const r=classifySMCEntry("BTCUSDT","5m",{...baseSMC,setup:{...baseSMC.setup,status:"WAIT",entry:null,stop:null,targets:[],rr:null}});expect(r.state).not.toBe("CONFIRMED")});
 it("rejects Elliott setup with invalid target geometry",()=>{const r=classifyElliottEntry("BTCUSDT","5m",{...baseEW,liveSetup:{...baseEW.liveSetup,targets:[99]}},102);expect(r.state).toBe("WAIT")});
 it("requires live price to remain between entry and target",()=>{
  expect(classifyElliottEntry("BTCUSDT","5m",baseEW,102).state).toBe("CONFIRMED");
  expect(classifyElliottEntry("BTCUSDT","5m",baseEW,110).state).not.toBe("CONFIRMED");
  expect(classifyElliottEntry("BTCUSDT","5m",baseEW,97).state).not.toBe("CONFIRMED");
 });
});