import { isValidTradeGeometry, type Candle } from "./engine";
import type { FootprintSnapshot } from "./footprint";

export type OrderFlowPressure = "BUYERS" | "SELLERS" | "BALANCED";
export type OrderFlowDirection = "BUY" | "SELL" | "WAIT";
export type OrderFlowAbsorption = "BUYER" | "SELLER" | "NONE";
export type LiquiditySweep = "HIGH" | "LOW" | "NONE";
export type MicroStructure = "BULLISH" | "BEARISH" | "NEUTRAL";
export type OrderFlowDataSource = "BINANCE_FOOTPRINT" | "BINANCE_TAKER_FLOW" | "CANDLE_ESTIMATE_FALLBACK";

export type OrderFlowBar = {
  index:number; time:number; buyVolume:number; sellVolume:number; delta:number; deltaRatio:number;
  buyerPressure:number; sellerPressure:number; imbalanceRatio:number;
  imbalance:"BUY"|"SELL"|"NONE"; absorption:OrderFlowAbsorption; absorptionStrength:number;
  liquiditySweep:LiquiditySweep; sweepPrice:number|null; microStructure:MicroStructure;
};

export type OrderFlowDiagnostic = {
  key:string;
  label:string;
  passed:boolean;
  detail:string;
};

export type OrderFlowResult = {
  source:OrderFlowDataSource; buyVolume:number; sellVolume:number; delta:number; deltaRatio:number;
  cumulativeDelta:number; buyerPressure:number; sellerPressure:number; pressure:OrderFlowPressure;
  pressureTrend:string; imbalance:"BUY"|"SELL"|"NONE"; imbalanceRatio:number;
  absorption:OrderFlowAbsorption; absorptionStrength:number; liquiditySweep:LiquiditySweep;
  liquiditySweepPrice:number|null; microStructure:MicroStructure; direction:OrderFlowDirection;
  signal:string; confidence:number; confirmations:string[]; entry:number|null; stop:number|null;
  targets:number[]; recentBars:OrderFlowBar[]; diagnostics:OrderFlowDiagnostic[]; rejectionReason:string;
  footprint: FootprintSnapshot|null; footprintHistoryCount:number;
};

function clamp(n:number,lo=0,hi=100){return Math.max(lo,Math.min(hi,Math.round(n)))}
function safe(n:number){return Number.isFinite(n)?n:0}
function barRange(c:Candle){return Math.max(c.high-c.low,1e-12)}
function sweepRemainsValid(candles:Candle[],sweep:OrderFlowBar|undefined,lastIndex:number,direction:"BUY"|"SELL"):boolean{
  if(!sweep||sweep.sweepPrice==null)return false;
  for(let i=sweep.index+1;i<=lastIndex;i++){
    if(direction==="BUY" && candles[i].close<sweep.sweepPrice)return false;
    if(direction==="SELL" && candles[i].close>sweep.sweepPrice)return false;
  }
  return true;
}
function avg(v:number[]){return v.length?v.reduce((a,b)=>a+b,0)/v.length:0}

function buildOrderFlowTargets(direction:"BUY"|"SELL",entry:number,risk:number,candles:Candle[]){
  if(!Number.isFinite(entry)||!Number.isFinite(risk)||risk<=0)return {targets:[] as number[],structuralTargetCount:0};
  const minRR=1.5,maxRR=8;
  const window=candles.slice(-12,-1);
  const structuralLevels:number[]=[];
  for(let i=1;i<window.length-1;i++){
    const p=window[i];
    if(direction==="BUY" && p.high>=window[i-1].high && p.high>=window[i+1].high && p.high>entry)structuralLevels.push(p.high);
    if(direction==="SELL" && p.low<=window[i-1].low && p.low<=window[i+1].low && p.low<entry)structuralLevels.push(p.low);
  }
  const current=candles.at(-1);
  if(!current)return {targets:[] as number[],structuralTargetCount:0};
  const futureSide=(p:number)=>
    direction==="BUY" ? p>current.high : p<current.low;
  const valid=(p:number)=>{
    const rr=Math.abs(p-entry)/risk;
    return Number.isFinite(p)&&rr>=minRR&&rr<=maxRR&&futureSide(p);
  };
  const minSpacing=Math.max(risk*0.25,1e-12);
  const out:number[]=[];
  // Prefer actual prior swing/liquidity structure. Mathematical R targets are
  // only used to fill remaining slots after structural levels are selected.
  const structuralCandidates=structuralLevels
    .filter(valid)
    .sort((a,b)=>direction==="BUY"?a-b:b-a);
  for(const p of structuralCandidates){
    if(out.every(x=>Math.abs(p-x)>=minSpacing)){
      out.push(p);
      if(out.length===3)break;
    }
  }
  let structuralTargetCount=out.length;
  const fallback=direction==="BUY"
    ?[entry+risk*1.5,entry+risk*2,entry+risk*3]
    :[entry-risk*1.5,entry-risk*2,entry-risk*3];
  for(const p of fallback){
    if(out.length===3||!valid(p))continue;
    // Do not place a mathematical target before an already-selected structural
    // level; fallback targets should extend beyond the last structural objective.
    const beyondStructure=out.length===0
      ?true
      :direction==="BUY" ? p>out.at(-1)! : p<out.at(-1)!;
    if(beyondStructure&&out.every(x=>Math.abs(p-x)>=minSpacing))out.push(p);
  }
  structuralTargetCount=Math.min(structuralTargetCount,out.length);
  return {targets:out,structuralTargetCount};
}

function volumeSplit(c:Candle){
  if(Number.isFinite(c.takerBuyVolume)){
    const buy=Math.max(0,Math.min(c.volume,c.takerBuyVolume!));
    return {buy,sell:Math.max(0,c.volume-buy),exact:true};
  }
  const range=barRange(c);
  const bodyBias=Math.max(-1,Math.min(1,(c.close-c.open)/range));
  const buy=c.volume*(0.5+bodyBias*0.25);
  return {buy,sell:Math.max(0,c.volume-buy),exact:false};
}

function analyzeBar(candles:Candle[],i:number,buy:number,sell:number):OrderFlowBar{
  const c=candles[i],total=Math.max(buy+sell,1e-12),delta=buy-sell,deltaRatio=delta/total;
  const buyerPressure=buy/total*100,sellerPressure=sell/total*100;
  const imbalanceRatio=Math.max(buy,sell)/Math.max(Math.min(buy,sell),1e-12);
  const imbalance:OrderFlowBar["imbalance"]=buy>sell&&imbalanceRatio>=1.6?"BUY":sell>buy&&imbalanceRatio>=1.6?"SELL":"NONE";
  const range=barRange(c),body=Math.abs(c.close-c.open);
  const upperWick=c.high-Math.max(c.open,c.close),lowerWick=Math.min(c.open,c.close)-c.low;
  const closeLocation=(c.close-c.low)/range;

  const sellerAbsorbed=buy/total>=0.60&&(upperWick>=range*0.25||closeLocation<=0.42)&&(c.close<=c.open||upperWick>=Math.max(body,range*0.1));
  const buyerAbsorbed=sell/total>=0.60&&(lowerWick>=range*0.25||closeLocation>=0.58)&&(c.close>=c.open||lowerWick>=Math.max(body,range*0.1));
  let absorption:OrderFlowAbsorption="NONE",absorptionStrength=0;
  if(sellerAbsorbed&&!buyerAbsorbed){absorption="SELLER";absorptionStrength=clamp(buyerPressure+Math.min(25,upperWick/range*100)-45)}
  else if(buyerAbsorbed&&!sellerAbsorbed){absorption="BUYER";absorptionStrength=clamp(sellerPressure+Math.min(25,lowerWick/range*100)-45)}

  let liquiditySweep:LiquiditySweep="NONE",sweepPrice:number|null=null;
  const lookbackStart=Math.max(0,i-10),history=candles.slice(lookbackStart,i);
  if(history.length>=3){
    const previousHigh=Math.max(...history.map(x=>x.high)),previousLow=Math.min(...history.map(x=>x.low));
    const referenceRange=avg(history.map(barRange));
    // A sweep must penetrate the prior liquidity range by a meaningful amount.
    // This filters one-tick/rounding noise while keeping the threshold adaptive
    // to the local volatility of the analyzed market.
    const minSweepPenetration=Math.max(referenceRange*0.05,1e-12);
    const sweptHigh=c.high-previousHigh>=minSweepPenetration&&c.close<previousHigh;
    const sweptLow=previousLow-c.low>=minSweepPenetration&&c.close>previousLow;
    // A candle that raids both sides is ambiguous; do not classify either side
    // as a directional liquidity sweep.
    if(sweptHigh!==sweptLow){
      if(sweptHigh){liquiditySweep="HIGH";sweepPrice=previousHigh}
      else {liquiditySweep="LOW";sweepPrice=previousLow}
    }
  }

  const structure=candles.slice(Math.max(0,i-3),i);
  let microStructure:MicroStructure="NEUTRAL";
  if(structure.length>=2){
    const previousHigh=Math.max(...structure.map(x=>x.high)),previousLow=Math.min(...structure.map(x=>x.low));
    const structureRange=avg(structure.map(barRange));
    // Require a close materially beyond the prior micro-range rather than a
    // one-tick breach. The displacement threshold adapts to recent volatility.
    const minStructureBreak=Math.max(structureRange*0.10,1e-12);
    const bullishBreak=c.close-previousHigh>=minStructureBreak;
    const bearishBreak=previousLow-c.close>=minStructureBreak;
    if(bullishBreak!==bearishBreak){
      if(bullishBreak)microStructure="BULLISH";
      else if(bearishBreak)microStructure="BEARISH";
    }
  }
  return {index:i,time:c.time,buyVolume:buy,sellVolume:sell,delta,deltaRatio,buyerPressure,sellerPressure,
    imbalanceRatio:Number.isFinite(imbalanceRatio)?imbalanceRatio:0,imbalance,absorption,absorptionStrength,
    liquiditySweep,sweepPrice,microStructure};
}

function emptyResult():OrderFlowResult{
  return {source:"BINANCE_TAKER_FLOW",buyVolume:0,sellVolume:0,delta:0,deltaRatio:0,cumulativeDelta:0,
    buyerPressure:0,sellerPressure:0,pressure:"BALANCED",pressureTrend:"NEUTRAL",imbalance:"NONE",imbalanceRatio:0,
    absorption:"NONE",absorptionStrength:0,liquiditySweep:"NONE",liquiditySweepPrice:null,microStructure:"NEUTRAL",
    direction:"WAIT",signal:"WAIT — no confirmed closed-candle order-flow setup",confidence:0,confirmations:[],
    entry:null,stop:null,targets:[],recentBars:[],footprint:null,footprintHistoryCount:0,diagnostics:[],rejectionReason:"No closed candle data"};
}

/**
 * Non-repainting Order Flow:
 * - only closed candles are eligible;
 * - fallback candle-volume estimates can never produce a confirmed signal;
 * - confirmation is evaluated only on the latest closed candle;
 * - historical bars are never modified by future candles.
 */
export function analyzeOrderFlow(candles:Candle[],footprints:FootprintSnapshot[]=[]):OrderFlowResult{
  // Normalize the feed so causal analysis cannot be broken by bad ordering,
  // duplicate timestamps, malformed OHLC, or impossible candles.
  const byTime=new Map<number,Candle>();
  for(const c of candles){
    if(!Number.isFinite(c.time)||!Number.isFinite(c.open)||!Number.isFinite(c.high)||!Number.isFinite(c.low)||!Number.isFinite(c.close)||!Number.isFinite(c.volume))continue;
    if(c.volume<0||c.high<c.low||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))continue;
    byTime.set(c.time,c);
  }
  const closed=[...byTime.values()].filter(c=>c.closed!==false).sort((x,y)=>x.time-y.time);
  if(!closed.length)return emptyResult();

  let cumulativeDelta=0,allExact=true;
  const bars:OrderFlowBar[]=[];
  for(let i=0;i<closed.length;i++){
    const split=volumeSplit(closed[i]);
    allExact=allExact&&split.exact;
    cumulativeDelta+=split.buy-split.sell;
    bars.push(analyzeBar(closed,i,split.buy,split.sell));
  }
  const last=bars.at(-1);
  if(!last)return emptyResult();

  const flowBars=bars.slice(-12);
  const candleBuyVolume=flowBars.reduce((s,b)=>s+b.buyVolume,0);
  const candleSellVolume=flowBars.reduce((s,b)=>s+b.sellVolume,0);
  const candleTotal=Math.max(candleBuyVolume+candleSellVolume,1e-12);
  const candleDelta=candleBuyVolume-candleSellVolume;

  const fpAll=footprints
    .filter(f=>f.confirmed && Number.isFinite(f.candleTime))
    .sort((a,b)=>a.candleTime-b.candleTime)
    .slice(-36);
  const footprintByTime=new Map(fpAll.map(f=>[f.candleTime,f]));
  const expectedClosed=closed.slice(-12);
  const expectedFootprintTimes=expectedClosed.map(c=>c.time);
  const fpRecent=expectedFootprintTimes
    .map(time=>footprintByTime.get(time))
    .filter((f): f is FootprintSnapshot => !!f);
  const latestFootprint=footprintByTime.get(last.time) ?? null;
  // A time-confirmed footprint is not sufficient if its aggTrade payload is
  // materially incomplete. Compare each footprint bar with Binance kline
  // volume before allowing footprint data to confirm a setup.
  const coverageByTime=new Map(expectedClosed.map(c=>[
    c.time,
    Math.min(1,
      (((footprintByTime.get(c.time)?.buyVolume??0)+(footprintByTime.get(c.time)?.sellVolume??0))/Math.max(c.volume,1e-12))
    )
  ]));
  const footprintCoverage=expectedClosed.length===12
    ?Math.min(...expectedClosed.map(c=>coverageByTime.get(c.time)??0))
    :0;
  const latestFootprintCoverage=coverageByTime.get(last.time)??0;
  const useFootprint=expectedFootprintTimes.length===12
    && fpRecent.length===12
    && footprintCoverage>=0.95
    && latestFootprintCoverage>=0.99;
  const buyVolume=useFootprint?fpRecent.reduce((s,f)=>s+f.buyVolume,0):candleBuyVolume;
  const sellVolume=useFootprint?fpRecent.reduce((s,f)=>s+f.sellVolume,0):candleSellVolume;
  const total=Math.max(buyVolume+sellVolume,1e-12);
  const delta=useFootprint?buyVolume-sellVolume:candleDelta;
  const deltaRatio=delta/total;
  const buyerPressure=buyVolume/total*100,sellerPressure=sellVolume/total*100;
  const pressure:OrderFlowPressure=deltaRatio>=0.08?"BUYERS":deltaRatio<=-0.08?"SELLERS":"BALANCED";

  const recent3=(useFootprint?fpRecent.slice(-3).map(f=>f.deltaRatio):bars.slice(-3).map(b=>b.deltaRatio));
  const prior3=(useFootprint?fpRecent.slice(-6,-3).map(f=>f.deltaRatio):bars.slice(-6,-3).map(b=>b.deltaRatio));
  const trendDelta=avg(recent3)-avg(prior3);
  const pressureTrend=trendDelta>=0.04?"BUYING PRESSURE INCREASING":trendDelta<=-0.04?"SELLING PRESSURE INCREASING":"PRESSURE STABLE";
  // Reject chase entries when the confirmation close is more than one
  // average recent candle range beyond the micro-structure break.
  const recent3Flow=(useFootprint?fpRecent.slice(-3).map(f=>f.deltaRatio):bars.slice(-3).map(b=>b.deltaRatio));
  const recent3FlowAverage=avg(recent3Flow);
  const recentFlowAlignedBuy=recent3Flow.length===3&&recent3FlowAverage>=0.05&&recent3Flow.at(-1)!>=0.08;
  const recentFlowAlignedSell=recent3Flow.length===3&&recent3FlowAverage<=-0.05&&recent3Flow.at(-1)!<=-0.08;
  const structureWindow=closed.slice(-4,-1);
  const structureHigh=structureWindow.length>=2?Math.max(...structureWindow.map(c=>c.high)):null;
  const structureLow=structureWindow.length>=2?Math.min(...structureWindow.map(c=>c.low)):null;
  const structureRange=avg(structureWindow.map(c=>barRange(c)));
  const maxEntryChase=Math.max(structureRange,1e-12);
  // `last` is an OrderFlowBar; OHLC comes from the latest closed Candle.
  const latestClose: number = closed.at(-1)!.close;
  const entryChaseBuy=structureHigh!=null?(latestClose-structureHigh)/maxEntryChase:null;
  const entryChaseSell=structureLow!=null?(structureLow-latestClose)/maxEntryChase:null;
  const entryChaseBuyValid=entryChaseBuy==null||entryChaseBuy<=1;
  const entryChaseSellValid=entryChaseSell==null||entryChaseSell<=1;

  const recentBars=bars.slice(-12);
  const maxSweepAge=5;
  // Use the latest qualifying event, not the oldest one in the lookback window.
  const sweepLow=recentBars.filter(b=>b.liquiditySweep==="LOW").at(-1);
  const sweepHigh=recentBars.filter(b=>b.liquiditySweep==="HIGH").at(-1);
  const buyerAbsorption=recentBars.filter(b=>b.absorption==="BUYER").at(-1);
  const sellerAbsorption=recentBars.filter(b=>b.absorption==="SELLER").at(-1);

  // A confirmation must form in causal order: liquidity event -> absorption -> current closed-bar break.
  // Strict causal sequence: sweep -> candle absorption -> latest footprint absorption/imbalance -> pressure/delta -> current-bar structure break.
  // The sweep must be recent and the candle absorption cannot precede it.
  const longContext=!!sweepLow&&!!buyerAbsorption&&buyerAbsorption.index>sweepLow.index&&buyerAbsorption.index<=last.index&&last.index-buyerAbsorption.index<=5;
  const shortContext=!!sweepHigh&&!!sellerAbsorption&&sellerAbsorption.index>sweepHigh.index&&sellerAbsorption.index<=last.index&&last.index-sellerAbsorption.index<=5;

  // The 12-bar pressure filter must actually have 12 closed bars behind it.
  // Otherwise a short initial dataset could be mislabeled as a "12-bar" setup.
  const sufficientHistory=closed.length>=12;
  const latestBuyFootprint=!!latestFootprint&&latestFootprint.confirmed&&latestFootprint.deltaRatio>=0.08&&latestFootprint.maxBuyImbalanceRatio>=3&&latestFootprint.stackedBuyImbalances>=2&&latestFootprint.absorption==="BUYER";
  const latestSellFootprint=!!latestFootprint&&latestFootprint.confirmed&&latestFootprint.deltaRatio<=-0.08&&latestFootprint.maxSellImbalanceRatio>=3&&latestFootprint.stackedSellImbalances>=2&&latestFootprint.absorption==="SELLER";
  const confirmedFlowData=useFootprint||allExact;
  const sweepRecentBuyValid=!!sweepLow&&last.index-sweepLow.index<=maxSweepAge;
  const sweepRecentSellValid=!!sweepHigh&&last.index-sweepHigh.index<=maxSweepAge;
  const sweepIntegrityBuyValid=sweepRemainsValid(closed,sweepLow,last.index,"BUY");
  const sweepIntegritySellValid=sweepRemainsValid(closed,sweepHigh,last.index,"SELL");
  const longConfirmed=sufficientHistory&&useFootprint&&longContext&&sweepRecentBuyValid&&sweepIntegrityBuyValid&&pressure==="BUYERS"&&recentFlowAlignedBuy&&latestBuyFootprint&&last.microStructure==="BULLISH"&&entryChaseBuyValid;
  const shortConfirmed=sufficientHistory&&useFootprint&&shortContext&&sweepRecentSellValid&&sweepIntegritySellValid&&pressure==="SELLERS"&&recentFlowAlignedSell&&latestSellFootprint&&last.microStructure==="BEARISH"&&entryChaseSellValid;

  const diagnostics:OrderFlowDiagnostic[]=[
    {key:"closed",label:"Closed candle",passed:true,detail:"Latest analysis candle is closed"},
    {key:"history",label:"12+ closed candles",passed:sufficientHistory,detail:`${closed.length}/12 closed candles`},
    {key:"exact",label:"Real Binance taker/footprint flow",passed:confirmedFlowData,detail:useFootprint?"Confirmed Binance footprint window available":allExact?"Exact kline taker-buy volume available":"One or more candles use estimated volume"},
    {key:"footprint_history",label:"12 confirmed footprint bars",passed:expectedFootprintTimes.length===12&&fpRecent.length===12,detail:`${fpRecent.length}/12 confirmed footprint bars`},
    {key:"footprint_coverage",label:"Footprint volume coverage ≥ 95%",passed:footprintCoverage>=0.95,detail:`Minimum per-bar coverage ${(footprintCoverage*100).toFixed(1)}%`},
    {key:"latest_fp_coverage",label:"Latest footprint coverage ≥ 99%",passed:latestFootprintCoverage>=0.99,detail:`Latest candle coverage ${(latestFootprintCoverage*100).toFixed(1)}%`},
    {key:"latest_fp",label:"Latest closed footprint",passed:!!latestFootprint,detail:latestFootprint?"Latest candle has a confirmed footprint":"Latest closed candle has no confirmed footprint snapshot"},
    {key:"sweep_buy",label:"Sell-side liquidity sweep",passed:!!sweepLow,detail:sweepLow?`Sweep at index ${sweepLow.index} · ${sweepLow.sweepPrice??"—"}`:"No low sweep in recent window"},
    {key:"sweep_recent_buy",label:"Recent sell-side sweep",passed:sweepRecentBuyValid,detail:sweepLow?`${last.index-sweepLow.index} bars ago`:"No low sweep"},
    {key:"sweep_integrity_buy",label:"Sell-side sweep still valid",passed:sweepIntegrityBuyValid,detail:sweepIntegrityBuyValid?"No later close invalidated the sweep level":"A later closed candle closed below the sweep level"},
    {key:"abs_buy",label:"Buyer absorption after sweep",passed:longContext,detail:buyerAbsorption?`Latest buyer absorption at index ${buyerAbsorption.index}`:"No buyer absorption after a low sweep"},
    {key:"recent_flow_buy",label:"3-bar buyer flow alignment",passed:recentFlowAlignedBuy,detail:`3-bar average delta ratio ${(recent3FlowAverage*100).toFixed(2)}% · latest ${((recent3.at(-1)??0)*100).toFixed(2)}%`},
    {key:"entry_chase_buy",label:"BUY entry not overextended",passed:entryChaseBuyValid,detail:entryChaseBuy==null?"Not enough structure bars":`Break extension ${entryChaseBuy.toFixed(2)}× avg range`},
    {key:"pressure_buy",label:"12-bar buyer pressure",passed:pressure==="BUYERS",detail:`${buyerPressure.toFixed(1)}% buyers · delta ratio ${(deltaRatio*100).toFixed(2)}%`},
    {key:"delta_buy",label:"Positive delta ≥ 0.08",passed:deltaRatio>=0.08,detail:`Current window delta ratio ${deltaRatio.toFixed(3)}`},
    {key:"imb_buy",label:"2+ stacked buy / 3× imbalance",passed:latestBuyFootprint,detail:latestFootprint?`stacked ${latestFootprint.stackedBuyImbalances}, max ${latestFootprint.maxBuyImbalanceRatio.toFixed(2)}×`:"No latest footprint"},
    {key:"structure_buy",label:"Bullish structure break",passed:last.microStructure==="BULLISH",detail:last.microStructure},
    {key:"sweep_sell",label:"Buy-side liquidity sweep",passed:!!sweepHigh,detail:sweepHigh?`Sweep at index ${sweepHigh.index} · ${sweepHigh.sweepPrice??"—"}`:"No high sweep in recent window"},
    {key:"sweep_recent_sell",label:"Recent buy-side sweep",passed:sweepRecentSellValid,detail:sweepHigh?`${last.index-sweepHigh.index} bars ago`:"No high sweep"},
    {key:"sweep_integrity_sell",label:"Buy-side sweep still valid",passed:sweepIntegritySellValid,detail:sweepIntegritySellValid?"No later close invalidated the sweep level":"A later closed candle closed above the sweep level"},
    {key:"abs_sell",label:"Seller absorption after sweep",passed:shortContext,detail:sellerAbsorption?`Latest seller absorption at index ${sellerAbsorption.index}`:"No seller absorption after a high sweep"},
    {key:"recent_flow_sell",label:"3-bar seller flow alignment",passed:recentFlowAlignedSell,detail:`3-bar average delta ratio ${(recent3FlowAverage*100).toFixed(2)}% · latest ${((recent3.at(-1)??0)*100).toFixed(2)}%`},
    {key:"entry_chase_sell",label:"SELL entry not overextended",passed:entryChaseSellValid,detail:entryChaseSell==null?"Not enough structure bars":`Break extension ${entryChaseSell.toFixed(2)}× avg range`},
    {key:"pressure_sell",label:"12-bar seller pressure",passed:pressure==="SELLERS",detail:`${sellerPressure.toFixed(1)}% sellers · delta ratio ${(deltaRatio*100).toFixed(2)}%`},
    {key:"delta_sell",label:"Negative delta ≤ -0.08",passed:deltaRatio<=-0.08,detail:`Current window delta ratio ${deltaRatio.toFixed(3)}`},
    {key:"imb_sell",label:"2+ stacked sell / 3× imbalance",passed:latestSellFootprint,detail:latestFootprint?`stacked ${latestFootprint.stackedSellImbalances}, max ${latestFootprint.maxSellImbalanceRatio.toFixed(2)}×`:"No latest footprint"},
    {key:"structure_sell",label:"Bearish structure break",passed:last.microStructure==="BEARISH",detail:last.microStructure},
  ];
  const failed = (directionHint:OrderFlowDirection)=>diagnostics.filter(d=>{
    if(directionHint==="BUY") return ["closed","history","exact","footprint_history","footprint_coverage","latest_fp_coverage","latest_fp","sweep_buy","sweep_recent_buy","sweep_integrity_buy","abs_buy","recent_flow_buy","entry_chase_buy","pressure_buy","delta_buy","imb_buy","structure_buy"].includes(d.key);
    if(directionHint==="SELL") return ["closed","history","exact","footprint_history","footprint_coverage","latest_fp_coverage","latest_fp","sweep_sell","sweep_recent_sell","sweep_integrity_sell","abs_sell","recent_flow_sell","entry_chase_sell","pressure_sell","delta_sell","imb_sell","structure_sell"].includes(d.key);
    return ["closed","history","exact","footprint_history","footprint_coverage","latest_fp"].includes(d.key);
  }).filter(d=>!d.passed);
  const maxSide = [
    {side:"BUY" as const,checks:["sweep_buy","sweep_recent_buy","sweep_integrity_buy","abs_buy","recent_flow_buy","entry_chase_buy","pressure_buy","delta_buy","imb_buy","structure_buy"]},
    {side:"SELL" as const,checks:["sweep_sell","sweep_recent_sell","sweep_integrity_sell","abs_sell","recent_flow_sell","entry_chase_sell","pressure_sell","delta_sell","imb_sell","structure_sell"]}
  ].map(x=>({side:x.side,score:x.checks.filter(k=>diagnostics.find(d=>d.key===k)?.passed).length,checks:x.checks.length})).sort((a,b)=>b.score-a.score)[0];
  const diagnosticDirection:OrderFlowDirection = maxSide.score>=3 ? maxSide.side : "WAIT";
  const failedChecks=failed(diagnosticDirection);
  let rejectionReason=failedChecks.length
    ? `${diagnosticDirection==="WAIT"?"No side yet":diagnosticDirection+" candidate"} · blocked by ${failedChecks[0].label.toLowerCase()}${failedChecks.length>1?` + ${failedChecks.length-1} more`:""}`
    : "All required confirmations passed";

  let direction:OrderFlowDirection="WAIT";
  if(longConfirmed&&!shortConfirmed)direction="BUY";
  else if(shortConfirmed&&!longConfirmed)direction="SELL";

  const confirmations:string[]=[];
  if(direction==="BUY"){
    confirmations.push("Closed-candle confirmation","Binance footprint flow","Sell-side liquidity sweep → buyer absorption","12-bar buyer pressure","Positive delta ≥ 0.08","2+ stacked buy imbalances","Max buy imbalance ≥ 3×","Current-bar bullish structure break");
  }else if(direction==="SELL"){
    confirmations.push("Closed-candle confirmation","Binance footprint flow","Buy-side liquidity sweep → seller absorption","12-bar seller pressure","Negative delta ≤ -0.08","2+ stacked sell imbalances","Max sell imbalance ≥ 3×","Current-bar bearish structure break");
  }

  let entry:number|null=null,stop:number|null,targets:number[]=[];
  let tradeGeometryValid=true;
  let targetQualityValid=true;
  if(direction!=="WAIT"){
    entry=closed.at(-1)!.close;
    const buffer=avg(closed.slice(-5).map(c=>barRange(c)))*0.10;
    if(direction==="BUY"){
      const base=sweepLow?.sweepPrice??Math.min(...closed.slice(-5).map(c=>c.low));
      stop=Math.max(0,base-buffer);
    }else{
      const base=sweepHigh?.sweepPrice??Math.max(...closed.slice(-5).map(c=>c.high));
      stop=base+buffer;
    }

    // Trade geometry is part of confirmation, not a presentation detail.
    // BUY must have SL strictly below entry and all TPs strictly above entry.
    // SELL must have SL strictly above entry and all TPs strictly below entry.
    const validStopSide=entry!=null&&stop!=null&&(
      direction==="BUY" ? stop<entry : stop>entry
    );
    if(validStopSide){
      tradeGeometryValid=true;
      const risk=Math.abs(entry!-stop!);
      const targetBuild=buildOrderFlowTargets(direction,entry!,risk,closed);
      const candidateTargets=targetBuild.targets;
      targetQualityValid=candidateTargets.length===3
        &&targetBuild.structuralTargetCount>=1
        &&candidateTargets.every((target)=>(
          Number.isFinite(target)
          &&(direction==="BUY" ? target>entry! : target<entry!)
          &&Math.abs(target-entry!)/risk>=1.5
        ));
      if(targetQualityValid){
        tradeGeometryValid=isValidTradeGeometry(direction,entry!,stop!,candidateTargets,1.5);
        if(tradeGeometryValid)targets=candidateTargets;
      }
      if(!targetQualityValid||!tradeGeometryValid)targets=[];
    }else{
      tradeGeometryValid=false;
      targetQualityValid=false;
    }

    if(!tradeGeometryValid||!targetQualityValid){
      entry=null;
      stop=null;
      targets=[];
      direction="WAIT";
      confirmations.length=0;
      rejectionReason=!tradeGeometryValid
        ?"Confirmed order-flow candidate · blocked by invalid entry/SL geometry"
        :"Confirmed order-flow candidate · blocked by target quality";
    }
  }
  diagnostics.push({
    key:"target_quality",
    label:"Target quality / spacing",
    passed:targetQualityValid&&targets.length===3,
    detail:targetQualityValid&&targets.length===3
      ?"3 ordered targets with ≥1 structural/liquidity level, minimum 1.5R, and controlled spacing"
      :"Need 3 valid risk-adjusted targets including at least 1 structural/liquidity level"
  });
  diagnostics.push({
    key:"trade_geometry",
    label:"Entry / SL / TP geometry",
    passed:tradeGeometryValid,
    detail:tradeGeometryValid
      ?targetQualityValid
        ?"Entry/SL geometry is valid and targets pass shared geometry validation"
        :"Entry/SL geometry is valid; target quality is failed separately"
      :"Invalid entry/SL geometry or shared target geometry"
  });

  const signal=direction==="BUY"?"BUY CONFIRMED — CLOSED CANDLE":direction==="SELL"?"SELL CONFIRMED — CLOSED CANDLE":"WAIT — no confirmed closed-candle order-flow setup";
  const lastTotal=Math.max(last.buyVolume+last.sellVolume,1e-12);
  const lastImbalanceRatio=Math.max(last.buyVolume,last.sellVolume)/Math.max(Math.min(last.buyVolume,last.sellVolume),1e-12);

  return {
    source:useFootprint?"BINANCE_FOOTPRINT":allExact?"BINANCE_TAKER_FLOW":"CANDLE_ESTIMATE_FALLBACK",
    buyVolume,sellVolume,delta:safe(delta),deltaRatio:safe(deltaRatio),cumulativeDelta:safe(useFootprint?fpAll.reduce((s,f)=>s+f.delta,0):cumulativeDelta),
    buyerPressure:clamp(buyerPressure),sellerPressure:clamp(sellerPressure),pressure,pressureTrend,
    imbalance:latestFootprint?(latestFootprint.stackedBuyImbalances>=2?"BUY":latestFootprint.stackedSellImbalances>=2?"SELL":"NONE"):last.imbalance,
    imbalanceRatio:latestFootprint?Math.max(latestFootprint.maxBuyImbalanceRatio,latestFootprint.maxSellImbalanceRatio):safe(lastImbalanceRatio),
    absorption:(latestFootprint?.absorption&&latestFootprint.absorption!=="NONE")?latestFootprint.absorption:(buyerAbsorption&&(!sellerAbsorption||buyerAbsorption.index>=sellerAbsorption.index)?"BUYER":sellerAbsorption?"SELLER":last.absorption),

    absorptionStrength:latestFootprint?.absorptionStrength||last.absorptionStrength,
    liquiditySweep:((sweepLow&&sweepHigh)?(sweepLow.index>=sweepHigh.index?sweepLow:sweepHigh):sweepLow||sweepHigh)?.liquiditySweep??"NONE",
    liquiditySweepPrice:((sweepLow&&sweepHigh)?(sweepLow.index>=sweepHigh.index?sweepLow:sweepHigh):sweepLow||sweepHigh)?.sweepPrice??null,
    microStructure:last.microStructure,direction,signal,confidence:direction==="WAIT"?0:100,confirmations,
    entry,stop,targets,recentBars,footprint:latestFootprint,footprintHistoryCount:fpRecent.length,diagnostics,rejectionReason:direction==="WAIT" ? rejectionReason : "All BUY/SELL confirmations passed"
  };
}
