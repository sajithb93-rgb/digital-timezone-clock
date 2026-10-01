import type { SMCResult, ElliottResult } from "./engine";

export type EntryScanState="CONFIRMED"|"SETUP"|"WATCH"|"WAIT";
export type EntryScanRow={symbol:string;timeframe:string;state:EntryScanState;direction:"BUY"|"SELL"|"NONE";score:number;price:number|null;entry:number|null;stop:number|null;target:number|null;rr:number|null;reason:string};

const make=(symbol:string,timeframe:string,state:EntryScanState,direction:"BUY"|"SELL"|"NONE",score:number,price:number|null,entry:number|null,stop:number|null,target:number|null,rr:number|null,reason:string):EntryScanRow=>({symbol,timeframe,state,direction,score,price,entry,stop,target,rr,reason});

export function classifySMCEntry(symbol:string,timeframe:string,r:SMCResult):EntryScanRow{
 const s=r.setup;
 if(s.status==="ACTIVE"&&s.direction!=="WAIT"&&s.entry!=null&&s.stop!=null&&s.targets[0]!=null&&s.rr!=null) return make(symbol,timeframe,"CONFIRMED",s.direction,s.confidence,null,s.entry,s.stop,s.targets[0],s.rr,"SMC ACTIVE · "+(s.confirmations.slice(0,3).join(" · ")||"all entry conditions passed"));
 const direction=s.direction==="WAIT"?(r.trend==="Bullish"?"BUY":r.trend==="Bearish"?"SELL":"NONE"):s.direction;
 const checks=[direction==="BUY"?r.trend==="Bullish":direction==="SELL"?r.trend==="Bearish":false,!!r.events.at(-1)&&((direction==="BUY"&&r.events.at(-1)?.direction==="bullish")||(direction==="SELL"&&r.events.at(-1)?.direction==="bearish")),!!r.entryZone,!!r.sweeps.at(-1),direction==="BUY"?r.premiumDiscount==="Discount":direction==="SELL"?r.premiumDiscount==="Premium":false,r.targets.length>0];
 const passed=checks.filter(Boolean).length; const score=Math.round(passed/checks.length*100);
 const state:EntryScanState=score>=83?"SETUP":score>=66?"WATCH":"WAIT";
 const reason=state==="SETUP"?direction+" setup forming · waiting for active entry/retest":state==="WATCH"?direction+" watch · "+passed+"/"+checks.length+" entry conditions":"No qualifying SMC entry setup";
 return make(symbol,timeframe,state,direction==="BUY"||direction==="SELL"?direction:"NONE",score,null,s.entry,s.stop,s.targets[0]??null,s.rr,reason);
}

export function classifyElliottEntry(symbol:string,timeframe:string,r:ElliottResult,currentPrice?:number):EntryScanRow{
 const p=r.primary;
 if(!p||p.entry==null||p.invalidation==null) return make(symbol,timeframe,"WAIT","NONE",0,null,null,null,null,null,"No strict actionable Elliott count");
 const direction=p.direction==="bullish"?"BUY":"SELL";
 const rulesOk=p.strict!==false&&r.setupState!=="INVALIDATED";
 const target=p.targets?.[0]??null; const risk=Math.abs(p.entry-p.invalidation); const rr=target!=null&&risk>0?Math.abs(target-p.entry)/risk:null;
 const nearEntry=currentPrice==null||risk<=0?false:Math.abs(currentPrice-p.entry)<=risk*0.35;
 const confirmed=rulesOk&&nearEntry&&target!=null&&rr!=null&&rr>=1.5;
 const score=Math.min(100,Math.round((r.confidence||p.quality||0)+(p.strict?10:0)));
 if(confirmed) return make(symbol,timeframe,"CONFIRMED",direction,score,currentPrice??null,p.entry,p.invalidation,target,rr,"ELLIOTT "+direction+" · strict count · price is within entry trigger band");
 return make(symbol,timeframe,score>=70?"SETUP":"WATCH",direction,score,currentPrice??null,p.entry,p.invalidation,target,rr,rulesOk?(nearEntry?"Strict count · waiting for final entry confirmation":"Strict count · price is away from entry band"):"Wave count invalidated or non-strict");
}
