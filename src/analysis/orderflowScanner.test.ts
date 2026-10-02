import { describe, expect, it } from "vitest";
import { classifyOrderFlowSetup } from "./orderflowScanner";
import type { OrderFlowResult } from "./orderflow";

const base: OrderFlowResult = {
  source: "BINANCE_FOOTPRINT", buyVolume: 120, sellVolume: 80, delta: 40, deltaRatio: 0.2,
  cumulativeDelta: 40, buyerPressure: 60, sellerPressure: 40, pressure: "BUYERS",
  pressureTrend: "BUYING PRESSURE INCREASING", imbalance: "BUY", imbalanceRatio: 3.5,
  absorption: "BUYER", absorptionStrength: 80, liquiditySweep: "LOW", liquiditySweepPrice: 100,
  microStructure: "BULLISH", direction: "WAIT", signal: "WAIT", confidence: 0, confirmations: [],
  entry: 110, stop: 105, targets: [117.5,120,125], recentBars: [],
  rejectionReason: "test fixture",
  footprint: {
    candleTime: 1, intervalMs: 300000, confirmed: true, levels: [], buyVolume: 70, sellVolume: 30,
    delta: 40, deltaRatio: 0.4, poc: 110, stackedBuyImbalances: 2, stackedSellImbalances: 0,
    maxBuyImbalanceRatio: 3.5, maxSellImbalanceRatio: 0, maxPositiveDelta: 40, maxNegativeDelta: 0,
    absorption: "BUYER", absorptionStrength: 80
  }, footprintHistoryCount: 12,
  diagnostics: [
    {key:"closed",label:"Closed candle",passed:true,detail:"Closed"},
    {key:"history",label:"12+ closed candles",passed:true,detail:"12/12"},
    {key:"exact",label:"Real Binance taker/footprint flow",passed:true,detail:"Footprint"},
    {key:"footprint_history",label:"12 confirmed footprint bars",passed:true,detail:"12/12"},
    {key:"footprint_unique",label:"Unique footprint candle times",passed:true,detail:"No duplicates"},
    {key:"footprint_coverage",label:"Footprint volume coverage 95–105%",passed:true,detail:"100%"},
    {key:"latest_fp_coverage",label:"Latest footprint coverage 99–105%",passed:true,detail:"100%"},
    {key:"latest_fp",label:"Latest closed footprint",passed:true,detail:"Available"},
    {key:"sweep_recent_buy",label:"Recent sell-side sweep",passed:true,detail:"1 bar ago"},
    {key:"sweep_integrity_buy",label:"Sell-side sweep still valid",passed:true,detail:"Valid"},
    {key:"target_quality",label:"Target quality / spacing",passed:true,detail:"3 valid targets"},
    {key:"trade_geometry",label:"Entry / SL / TP geometry",passed:true,detail:"Valid"}
  ]
};

describe("Order Flow pair scanner", () => {
  it("detects a confirmed pair", () => {
    const row = classifyOrderFlowSetup("BTCUSDT", "5m", {...base, direction:"BUY", signal:"BUY CONFIRMED — CLOSED CANDLE"});
    expect(row.state).toBe("CONFIRMED");
    expect(row.direction).toBe("BUY");
  });
  it("does not confirm when classifier direction disagrees with engine direction",()=>{
    const row = classifyOrderFlowSetup("BTCUSDT","5m",{...base,direction:"SELL",signal:"SELL CONFIRMED — CLOSED CANDLE"});
    expect(row.state).toBe("WAIT");
  });

  it("detects a forming setup without calling it confirmed", () => {
    const row = classifyOrderFlowSetup("ETHUSDT", "5m", {
      ...base,
      direction:"BUY",
      microStructure:"NEUTRAL",
      footprint:{
        ...base.footprint!,
        stackedBuyImbalances:1,
      },
      diagnostics:base.diagnostics
    });
    expect(row.state).toBe("SETUP");
    expect(row.direction).toBe("BUY");
  });
  it("never scans fallback candle estimates as a real footprint setup", () => {
    const row = classifyOrderFlowSetup("SOLUSDT", "5m", {...base, source:"CANDLE_ESTIMATE_FALLBACK", footprint:null, footprintHistoryCount:0});
    expect(row.state).toBe("WAIT");
    expect(row.direction).toBe("NONE");
  });

  it("blocks confirmation when latest footprint coverage is incomplete", () => {
    const row = classifyOrderFlowSetup(
      "BTCUSDT",
      "5m",
      {
        ...base,
        direction: "BUY",
        diagnostics: [
          {key:"latest_fp_coverage",label:"Latest footprint coverage 99–105%",passed:false,detail:"98%"},
          {key:"target_quality",label:"Target quality / spacing",passed:true,detail:"3 valid targets"},
          {key:"trade_geometry",label:"Entry / SL / TP geometry",passed:true,detail:"Valid"},
          {key:"sweep_recent_buy",label:"Recent sell-side sweep",passed:true,detail:"1 bar ago"},
          {key:"sweep_integrity_buy",label:"Sell-side sweep still valid",passed:true,detail:"Valid"},
          {key:"closed",label:"Closed candle",passed:true,detail:"Closed"},
          {key:"history",label:"12+ closed candles",passed:true,detail:"12/12"},
          {key:"exact",label:"Real Binance taker/footprint flow",passed:true,detail:"Footprint"},
          {key:"footprint_history",label:"12 confirmed footprint bars",passed:true,detail:"12/12"},
          {key:"footprint_coverage",label:"Footprint volume coverage 95–105%",passed:true,detail:"98%"} ,
          {key:"latest_fp",label:"Latest closed footprint",passed:true,detail:"Available"}
        ]
      }
    );
    expect(row.state).toBe("WAIT");
    expect(row.reason).toContain("incomplete confirmed footprint data");
  });

  it("blocks a confirmed direction when the sweep-freshness diagnostic fails", () => {
    const row = classifyOrderFlowSetup(
      "BTCUSDT",
      "5m",
      {
        ...base,
        direction: "BUY",
        diagnostics: [
          {key:"sweep_recent_buy",label:"Recent sell-side sweep",passed:false,detail:"6 bars ago"},
          {key:"sweep_integrity_buy",label:"Sell-side sweep still valid",passed:true,detail:"Valid"},
          {key:"abs_buy",label:"Buyer absorption after sweep",passed:true,detail:"Valid"},
          {key:"recent_flow_buy",label:"3-bar buyer flow alignment",passed:true,detail:"Aligned"},
          {key:"entry_chase_buy",label:"BUY entry not overextended",passed:true,detail:"Valid"},
          {key:"pressure_buy",label:"12-bar buyer pressure",passed:true,detail:"Valid"},
          {key:"delta_buy",label:"Positive delta ≥ 0.08",passed:true,detail:"Valid"},
          {key:"imb_buy",label:"2+ stacked buy / 3× imbalance",passed:true,detail:"Valid"},
          {key:"structure_buy",label:"Bullish structure break",passed:true,detail:"Valid"},
          {key:"closed",label:"Closed candle",passed:true,detail:"Closed"},
          {key:"history",label:"12+ closed candles",passed:true,detail:"12/12"},
          {key:"exact",label:"Real Binance taker/footprint flow",passed:true,detail:"Footprint"},
          {key:"footprint_history",label:"12 confirmed footprint bars",passed:true,detail:"12/12"},
          {key:"footprint_coverage",label:"Footprint volume coverage 95–105%",passed:true,detail:"100%"},
          {key:"latest_fp_coverage",label:"Latest footprint coverage 99–105%",passed:true,detail:"100%"},
          {key:"latest_fp",label:"Latest closed footprint",passed:true,detail:"Available"},
          {key:"target_quality",label:"Target quality / spacing",passed:true,detail:"3 valid targets"},
          {key:"trade_geometry",label:"Entry / SL / TP geometry",passed:true,detail:"Valid"}
        ]
      }
    );
    expect(row.state).toBe("WAIT");
    expect(row.reason).toContain("stale/invalid liquidity sweep");
  });

  it("blocks a confirmed direction when target quality fails", () => {
    const row = classifyOrderFlowSetup(
      "BTCUSDT",
      "5m",
      {
        ...base,
        direction: "BUY",
        diagnostics: [
          {key:"sweep_recent_buy",label:"Recent sell-side sweep",passed:true,detail:"1 bar ago"},
          {key:"target_quality",label:"Target quality / spacing",passed:false,detail:"Only 2 valid targets"},
          {key:"trade_geometry",label:"Entry / SL / TP geometry",passed:true,detail:"Valid"},
          {key:"closed",label:"Closed candle",passed:true,detail:"Closed"},
          {key:"history",label:"12+ closed candles",passed:true,detail:"12/12"},
          {key:"exact",label:"Real Binance taker/footprint flow",passed:true,detail:"Footprint"},
          {key:"footprint_history",label:"12 confirmed footprint bars",passed:true,detail:"12/12"},
          {key:"footprint_coverage",label:"Footprint volume coverage 95–105%",passed:true,detail:"100%"},
          {key:"latest_fp",label:"Latest closed footprint",passed:true,detail:"Available"}
        ]
      }
    );
    expect(row.state).toBe("WAIT");
    expect(row.reason).toContain("target quality");
  });

  it("blocks a confluence-complete setup when trade geometry is invalid", () => {
    const row = classifyOrderFlowSetup(
      "BTCUSDT",
      "5m",
      {
        ...base,
        direction:"WAIT",
        diagnostics:[{
          key:"trade_geometry",
          label:"Entry / SL / TP geometry",
          passed:false,
          detail:"Invalid stop side or target direction"
        }],
        rejectionReason:"Confirmed order-flow candidate · blocked by invalid entry/SL/TP geometry"
      }
    );
    expect(row.state).toBe("WAIT");
    expect(row.direction).toBe("BUY");
    expect(row.reason).toContain("invalid entry/SL/TP geometry");
  });
});
