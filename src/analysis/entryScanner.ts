import { isValidTradeGeometry, setupWindowProfileForInterval, type SMCResult, type ElliottResult } from "./engine";

export const MIN_ENTRY_SCAN_CANDLES=25;
export function isEntryScanDataSufficient(closedCandleCount:number):boolean{
 return Number.isInteger(closedCandleCount)&&closedCandleCount>=MIN_ENTRY_SCAN_CANDLES;
}
export const MIN_SMC_SCAN_CANDLES=MIN_ENTRY_SCAN_CANDLES;
export const isSMCScanDataSufficient=isEntryScanDataSufficient;

export type SMCEmptyScanOutcome="NO_ELIGIBLE_PAIRS"|"ALL_PAIRS_FAILED"|"PARTIAL_FAILURE"|"NO_CONFIRMED_SETUP";

export function classifySMCEmptyScanOutcome(eligiblePairs:number,failedPairs:number):SMCEmptyScanOutcome{
 if(!Number.isFinite(eligiblePairs)||eligiblePairs<=0)return "NO_ELIGIBLE_PAIRS";
 if(!Number.isFinite(failedPairs)||failedPairs>=eligiblePairs)return "ALL_PAIRS_FAILED";
 if(failedPairs>0)return "PARTIAL_FAILURE";
 return "NO_CONFIRMED_SETUP";
}

export type EntryScanState="CONFIRMED"|"SETUP"|"WATCH"|"WAIT";
export type MTFConfluence="ALIGNED"|"MIXED"|"CONFLICTING"|"UNAVAILABLE";
export type MTFFrameContext={available:boolean;trend:"Bullish"|"Bearish"|"Neutral"};
export function classifyMTFConfluence(direction:"BUY"|"SELL"|"NONE",frames:MTFFrameContext[]):MTFConfluence{
 const usable=frames.filter(frame=>frame.available);
 if(direction==="NONE"||usable.length===0)return "UNAVAILABLE";
 const wanted=direction==="BUY"?"Bullish":"Bearish";
 const opposing=direction==="BUY"?"Bearish":"Bullish";
 const aligned=usable.some(frame=>frame.trend===wanted);
 const conflicting=usable.some(frame=>frame.trend===opposing);
 if(aligned&&conflicting)return "MIXED";
 if(conflicting)return "CONFLICTING";
 if(aligned)return "ALIGNED";
 return "MIXED";
}
export type EntryScanRow={symbol:string;timeframe:string;state:EntryScanState;direction:"BUY"|"SELL"|"NONE";score:number;price:number|null;entry:number|null;stop:number|null;target:number|null;rr:number|null;reason:string;mtfConfluence?:MTFConfluence};

const make=(symbol:string,timeframe:string,state:EntryScanState,direction:"BUY"|"SELL"|"NONE",score:number,price:number|null,entry:number|null,stop:number|null,target:number|null,rr:number|null,reason:string):EntryScanRow=>({symbol,timeframe,state,direction,score,price,entry,stop,target,rr,reason});

export function classifySMCEntry(symbol:string,timeframe:string,r:SMCResult):EntryScanRow{
 const s=r.setup;
 // The engine may intentionally keep executable setup fields empty while a
 // qualified analytical zone is present. For scanner state, infer the side
 // from the current closed-candle SMC trend instead of collapsing every
 // forming setup to NONE.
 const direction:"BUY"|"SELL"|"NONE"=
  s.direction!=="WAIT"
   ?s.direction
   :r.trend==="Bullish"?"BUY"
   :r.trend==="Bearish"?"SELL"
   :"NONE";
 const latestEvent=r.events.slice().reverse().find(e=>e.direction===(direction==="BUY"?"bullish":direction==="SELL"?"bearish":"none"));
 const latestSweep=r.sweeps.slice().reverse().find(sw=>sw.type===(direction==="BUY"?"low":direction==="SELL"?"high":"none"));
 const asOf=r.asOf??0;
 const windows=setupWindowProfileForInterval(timeframe);
 const sweepLookback=windows.sweepLookbackBars;
 const structureGap=windows.structureGapBars;
 const sweepRecent=!!latestSweep&&latestSweep.index>=Math.max(0,asOf-sweepLookback);
 const sweepAligned=direction==="BUY"?latestSweep?.type==="low":direction==="SELL"?latestSweep?.type==="high":false;
 const causalSequence=!!latestEvent&&!!latestSweep&&latestSweep.index<latestEvent.index
  &&latestEvent.index-latestSweep.index<=structureGap&&sweepRecent&&sweepAligned;
 const activeCausal=causalSequence&&(latestEvent?.type==="BOS"||latestEvent?.type==="CHOCH");
 const executableDirection=s.direction==="BUY"||s.direction==="SELL"?s.direction:null;
 const executableGeometry=executableDirection!==null&&s.entry!=null&&s.stop!=null&&s.targets.length>0
  &&isValidTradeGeometry(executableDirection,s.entry,s.stop,s.targets,1.5)
  &&s.rr!=null&&Number.isFinite(s.rr)&&s.rr>=1.5;
 if(s.status==="ACTIVE"&&executableDirection!==null&&executableGeometry&&activeCausal){
  return make(symbol,timeframe,"CONFIRMED",executableDirection,s.confidence,null,s.entry,s.stop,s.targets[0],s.rr,
   "SMC ACTIVE · "+(s.confirmations.slice(0,3).join(" · ")||"all entry conditions passed"));
 }
 const analyticalEntry=r.entryZone?(r.entryZone.low+r.entryZone.high)/2:null;
 const activeGate=s.status==="ACTIVE"&&executableGeometry&&activeCausal;
 const checks=[
  direction==="BUY"?r.trend==="Bullish":direction==="SELL"?r.trend==="Bearish":false,
  !!latestEvent&&((direction==="BUY"&&latestEvent.direction==="bullish")||(direction==="SELL"&&latestEvent.direction==="bearish")),
  !!r.entryZone,
  causalSequence,
  direction==="BUY"?r.premiumDiscount==="Discount":direction==="SELL"?r.premiumDiscount==="Premium":false,
  r.targets.length>0,
  activeGate
 ];
 const passed=checks.filter(Boolean).length;
 // A setup that has not passed the executable ACTIVE gate cannot receive 100.
 const score=Math.round(passed/checks.length*100);
 const state:EntryScanState=score>=83?"SETUP":score>=66?"WATCH":"WAIT";
 const reason=state==="SETUP"
  ?direction+" setup forming · waiting for active entry/retest"
  :state==="WATCH"
   ?direction+" watch · "+passed+"/"+checks.length+" entry conditions"
   :"No qualifying SMC entry setup";
 return make(symbol,timeframe,state,direction,score,null,
  analyticalEntry,s.stop,r.targets[0]??null,s.rr,reason);
}
export function classifyElliottEntry(symbol:string,timeframe:string,r:ElliottResult,currentPrice?:number):EntryScanRow{
 const live=r.liveSetup;
 if(!live||live.entry==null||live.invalidation==null){
   return make(symbol,timeframe,"WAIT","NONE",0,currentPrice??null,null,null,null,null,
     "No live Elliott continuation setup · historical Wave 1–5 counts are not entry signals");
 }
 const liveState=live.setupStatus??"ACTIVE";
 if(liveState!=="ACTIVE"){
   const terminalReason=liveState==="TARGET_HIT"
     ?"Target already reached"
     :liveState==="INVALIDATED"
       ?"Wave-C stop/invalidation already crossed"
       :"Stop and target touched on the same candle; outcome is ambiguous";
   return make(symbol,timeframe,"WAIT","NONE",0,currentPrice??null,null,null,null,null,
     "Elliott continuation closed · "+terminalReason);
 }

 const direction=live.direction==="bullish"?"BUY":"SELL";
 const target=live.targets?.[0]??null;
 const risk=Math.abs(live.entry-live.invalidation);
 const rr=target!=null&&risk>0?Math.abs(target-live.entry)/risk:null;
 const geometryValid=live.direction==="bullish"
   ? live.invalidation<live.entry&&target>live.entry
   : live.invalidation>live.entry&&target<live.entry;
 // The trigger is stored from the first qualifying closed candle. Do not
 // erase a still-open setup just because price retests below/above the entry;
 // the trade remains live until stop/target resolution on later closed candles.
 const trigger=geometryValid&&(
   live.direction==="bullish"
     ? (currentPrice!=null&&currentPrice>live.invalidation&&currentPrice<target)
     : (currentPrice!=null&&currentPrice<live.invalidation&&currentPrice>target)
 );
 const score=Math.min(100,Math.round((r.confidence||live.quality||0)+(live.strict?5:0)));
 const confirmed=live.strict!==false&&trigger&&target!=null&&rr!=null&&rr>=1.5;

 if(confirmed){
   return make(symbol,timeframe,"CONFIRMED",direction,score,currentPrice??null,live.entry,live.invalidation,target,rr,
     "ELLIOTT "+direction+" · ABC correction confirmed · Wave B trigger broken");
 }

 const validRisk=Number.isFinite(risk)&&risk>0;
 const validTarget=target!=null&&Number.isFinite(target)&&geometryValid;
 if(!validRisk||!validTarget){
   return make(symbol,timeframe,"WAIT",direction,score,currentPrice??null,live.entry,live.invalidation,target,rr,
     "Elliott setup rejected · invalid risk/target geometry");
 }
 const state:EntryScanState=score>=70?"SETUP":"WATCH";
 return make(symbol,timeframe,state,direction,score,currentPrice??null,live.entry,live.invalidation,target,rr,
   trigger
     ? "ABC correction confirmed · waiting for RR validation"
     : "ABC correction confirmed · waiting for Wave B trigger");
}
