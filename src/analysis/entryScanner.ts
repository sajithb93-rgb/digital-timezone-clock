import type { SMCResult, ElliottResult } from "./engine";

export type EntryScanState="CONFIRMED"|"SETUP"|"WATCH"|"WAIT";
export type EntryScanRow={symbol:string;timeframe:string;state:EntryScanState;direction:"BUY"|"SELL"|"NONE";score:number;price:number|null;entry:number|null;stop:number|null;target:number|null;rr:number|null;reason:string};

const make=(symbol:string,timeframe:string,state:EntryScanState,direction:"BUY"|"SELL"|"NONE",score:number,price:number|null,entry:number|null,stop:number|null,target:number|null,rr:number|null,reason:string):EntryScanRow=>({symbol,timeframe,state,direction,score,price,entry,stop,target,rr,reason});

export function classifySMCEntry(symbol:string,timeframe:string,r:SMCResult):EntryScanRow{
 const s=r.setup;
 const direction=s.direction==="WAIT"?(r.trend==="Bullish"?"BUY":r.trend==="Bearish"?"SELL":"NONE"):s.direction;
 const latestEvent=r.events.slice().reverse().find(e=>e.direction===(direction==="BUY"?"bullish":direction==="SELL"?"bearish":"none"));
 const latestSweep=r.sweeps.slice().reverse().find(sw=>sw.type===(direction==="BUY"?"low":direction==="SELL"?"high":"none"));
 const asOf=r.asOf??0;
 const sweepRecent=!!latestSweep && latestSweep.index>=Math.max(0,asOf-20);
 const sweepAligned=direction==="BUY" ? latestSweep?.type==="low" : direction==="SELL" ? latestSweep?.type==="high" : false;
 const causalSequence=!!latestEvent&&!!latestSweep&&latestSweep.index<latestEvent.index&&sweepRecent&&sweepAligned;
 const activeCausal=causalSequence&&s.confirmations.some(x=>x.includes("sweep")&&x.includes("structure"));
 if(s.status==="ACTIVE"&&s.direction!=="WAIT"&&s.entry!=null&&s.stop!=null&&s.targets[0]!=null&&s.rr!=null&&activeCausal) return make(symbol,timeframe,"CONFIRMED",s.direction,s.confidence,null,s.entry,s.stop,s.targets[0],s.rr,"SMC ACTIVE · "+(s.confirmations.slice(0,3).join(" · ")||"all entry conditions passed"));
 const checks=[direction==="BUY"?r.trend==="Bullish":direction==="SELL"?r.trend==="Bearish":false,!!latestEvent&&((direction==="BUY"&&latestEvent.direction==="bullish")||(direction==="SELL"&&latestEvent.direction==="bearish")),!!r.entryZone,causalSequence,direction==="BUY"?r.premiumDiscount==="Discount":direction==="SELL"?r.premiumDiscount==="Premium":false,r.targets.length>0];
 const passed=checks.filter(Boolean).length; const score=Math.round(passed/checks.length*100);
 const state:EntryScanState=score>=83?"SETUP":score>=66?"WATCH":"WAIT";
 const reason=state==="SETUP"?direction+" setup forming · waiting for active entry/retest":state==="WATCH"?direction+" watch · "+passed+"/"+checks.length+" entry conditions":"No qualifying SMC entry setup";
 return make(symbol,timeframe,state,direction==="BUY"||direction==="SELL"?direction:"NONE",score,null,s.entry,s.stop,s.targets[0]??null,s.rr,reason);
}

export function classifyElliottEntry(symbol:string,timeframe:string,r:ElliottResult,currentPrice?:number):EntryScanRow{
 const live=r.liveSetup;
 if(!live||live.entry==null||live.invalidation==null){
   return make(symbol,timeframe,"WAIT","NONE",0,currentPrice??null,null,null,null,null,
     "No live Elliott continuation setup · historical Wave 1–5 counts are not entry signals");
 }

 const direction=live.direction==="bullish"?"BUY":"SELL";
 const target=live.targets?.[0]??null;
 const risk=Math.abs(live.entry-live.invalidation);
 const rr=target!=null&&risk>0?Math.abs(target-live.entry)/risk:null;
 const geometryValid=live.direction==="bullish"
   ? live.invalidation<live.entry&&target>live.entry
   : live.invalidation>live.entry&&target<live.entry;
 const trigger=geometryValid&&(
   live.direction==="bullish"
     ? (currentPrice!=null&&currentPrice>=live.entry&&currentPrice>live.invalidation&&currentPrice<target)
     : (currentPrice!=null&&currentPrice<=live.entry&&currentPrice<live.invalidation&&currentPrice>target)
 );
 const score=Math.min(100,Math.round((r.confidence||live.quality||0)+(live.strict?5:0)));
 const confirmed=live.strict!==false&&trigger&&target!=null&&rr!=null&&rr>=1.5;

 if(confirmed){
   return make(symbol,timeframe,"CONFIRMED",direction,score,currentPrice??null,live.entry,live.invalidation,target,rr,
     "ELLIOTT "+direction+" · ABC correction confirmed · Wave B trigger broken");
 }

 const state:EntryScanState=score>=70?"SETUP":"WATCH";
 return make(symbol,timeframe,state,direction,score,currentPrice??null,live.entry,live.invalidation,target,rr,
   trigger
     ? "ABC correction confirmed · waiting for RR/target validation"
     : "ABC correction confirmed · waiting for Wave B trigger");
}
