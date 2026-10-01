import { describe, expect, it } from "vitest";
import { classifySMCEntry, classifyElliottEntry } from "./entryScanner";

const baseSMC:any={trend:"Bullish",setup:{direction:"BUY",status:"ACTIVE",entry:100,stop:98,targets:[104],rr:2,confidence:85,confirmations:["Swing structure aligned"]},events:[{direction:"bullish"}],entryZone:{low:99,high:101},sweeps:[{type:"low"}],premiumDiscount:"Discount",targets:[104]};

const baseEW:any={primary:{direction:"bullish",entry:100,invalidation:98,targets:[104],strict:true,quality:80,kind:"Impulse"},confidence:85,setupState:"HISTORICAL"};

describe("entry scanners",()=>{
 it("confirms an active SMC setup",()=>{const r=classifySMCEntry("BTCUSDT","5m",baseSMC);expect(r.state).toBe("CONFIRMED");expect(r.direction).toBe("BUY");expect(r.entry).toBe(100)});
 it("does not confirm SMC when active entry is missing",()=>{const r=classifySMCEntry("BTCUSDT","5m",{...baseSMC,setup:{...baseSMC.setup,status:"WAIT",entry:null,stop:null,targets:[],rr:null}});expect(r.state).not.toBe("CONFIRMED")});
 it("requires live price proximity for Elliott confirmation",()=>{expect(classifyElliottEntry("BTCUSDT","5m",baseEW,100).state).toBe("CONFIRMED");expect(classifyElliottEntry("BTCUSDT","5m",baseEW,110).state).not.toBe("CONFIRMED")});
});