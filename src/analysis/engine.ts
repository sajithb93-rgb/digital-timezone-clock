import { analyzeElliottAdvanced, type AdvancedElliottResult } from "./elliott";
export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number;takerBuyVolume?:number;closed?:boolean};
export type Pivot={index:number;price:number;type:"H"|"L";label?:string;strength?:number;confirmedAt?:number};
export type FVG={from:number;to:number;low:number;high:number;type:"bullish"|"bearish";filled:boolean;fillIndex?:number;size?:number};
export type OB={index:number;low:number;high:number;type:"bullish"|"bearish";mitigated:boolean;mitigationIndex?:number;strength?:number};
export type Breaker={index:number;low:number;high:number;type:"bullish"|"bearish";active:boolean};
export type StructureEvent={index:number;price:number;type:"BOS"|"CHOCH";direction:"bullish"|"bearish";strength:"normal"|"displacement"};
export type Sweep={index:number;price:number;type:"high"|"low";confirmed:boolean;displacement?:boolean};
export type Zone={low:number;high:number;type:"entry"|"stop"|"target"};
export type Setup={direction:"BUY"|"SELL"|"WAIT";status:"WAIT"|"ACTIVE";entry:number|null;stop:number|null;targets:number[];rr:number|null;confidence:number;confirmations:string[]};
export type SMCResult={
 trend:"Bullish"|"Bearish"|"Neutral"; asOf:number; pivots:Pivot[]; internalPivots:Pivot[]; events:StructureEvent[];
 fvgs:FVG[]; orderBlocks:OB[]; breakers:Breaker[]; liquidityHighs:Pivot[]; liquidityLows:Pivot[]; equalHighs:Pivot[]; equalLows:Pivot[];
 sweeps:Sweep[]; premiumDiscount:"Premium"|"Discount"|"Equilibrium"; premiumDiscountRange:{high:number;low:number;mid:number};
 vwap:number; volumeRatio:number; displacement:number; entryZone:Zone|null; stop:number|null; targets:number[]; score:number; setup:Setup;
};
export type WavePoint={index:number;price:number;label:string};
export type WaveCount={points:WavePoint[];kind:"Impulse"|"Diagonal"|"Correction";direction:"bullish"|"bearish";invalidation:number;entry:number|null;targets:number[];quality:number;rules:string[];truncated?:boolean;strict?:boolean;};
export type ElliottResult={
 primary:WaveCount|null;alternative:WaveCount|null;correction:WaveCount|null;
 fib:{w2:number;w3:number;w4:number;w5:number}|null;
 fibLevels:{label:string;price:number}[]; channel:{a:number;b:number}|null;
 phase:string;score:number;confidence:number;
 setupState:"HISTORICAL"|"INVALIDATED"|"NONE";setupReason:string;
};
export type MTFFrame={interval:string;trend:"Bullish"|"Bearish"|"Neutral";score:number;structure:string;available:boolean;elliottTrend:"Bullish"|"Bearish"|"Neutral";elliottScore:number;elliottPhase:string};
export type MTFResult={trend:"Bullish"|"Bearish"|"Neutral";score:number;elliottTrend:"Bullish"|"Bearish"|"Neutral";elliottScore:number;frames:MTFFrame[]};

function trueRange(c:Candle[],i:number){if(i===0)return c[i].high-c[i].low;return Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}
function atr(c:Candle[],n=14){return atrAt(c,c.length-1,n)}
function atrAt(c:Candle[],end:number,n=14){if(!c.length||end<0)return 0;const e=Math.min(end,c.length-1),start=Math.max(0,e-n+1);return c.slice(start,e+1).reduce((v,_,i)=>v+trueRange(c,start+i),0)/Math.max(1,e-start+1)}
function pivots(c:Candle[],w=3):Pivot[]{
 const out:Pivot[]=[];
 for(let i=w;i<c.length-w;i++){
  let hi=true,lo=true,highScore=0,lowScore=0;
  for(let j=i-w;j<=i+w;j++){
   if(j===i)continue;
   if(c[j].high>=c[i].high)hi=false;
   if(c[j].low<=c[i].low)lo=false;
   highScore+=Math.max(0,c[i].high-c[j].high);
   lowScore+=Math.max(0,c[j].low-c[i].low);
  }
  if(hi&&lo){
   if(highScore>=lowScore)lo=false;
   else hi=false;
  }
  const divisor=2*w+1;
  if(hi)out.push({index:i,price:c[i].high,type:"H",strength:highScore/Math.max(1,divisor),confirmedAt:i+w});
  if(lo)out.push({index:i,price:c[i].low,type:"L",strength:lowScore/Math.max(1,divisor),confirmedAt:i+w});
 }
 return out.sort((a,b)=>a.index-b.index||(a.type==="H"?-1:1));
}

function clamp(n:number){return Math.max(0,Math.min(100,Math.round(n)))}
export function isSetupActive(zone:Zone|null,last:Candle|undefined):boolean{return !!zone&&!!last&&last.high>=zone.low&&last.low<=zone.high}
function range(c:Candle[]){const q=c.slice(-60);return{hi:Math.max(...q.map(x=>x.high)),lo:Math.min(...q.map(x=>x.low))}}
function body(c:Candle){return Math.abs(c.close-c.open)}
function displacementAt(c:Candle[],i:number,a:number){return a>0?body(c[i])/a:0}
function labelPivots(ps:Pivot[]){const out:Pivot[]=[];let lastH:number|undefined,lastL:number|undefined;for(const p of ps){const q={...p};if(p.type==="H"){q.label=lastH===undefined?"SH":p.price>lastH?"HH":"LH";lastH=p.price}else{q.label=lastL===undefined?"SL":p.price>lastL?"HL":"LL";lastL=p.price}out.push(q)}return out}

function findFvgs(c:Candle[],a:number):FVG[]{
 const out:FVG[]=[];
 for(let i=1;i<c.length-1;i++){
  if(c[i-1].high<c[i+1].low){const low=c[i-1].high,high=c[i+1].low;let fillIndex:number|undefined;for(let j=i+1;j<c.length;j++)if(c[j].low<=low){fillIndex=j;break}out.push({from:i-1,to:i+1,low,high,type:"bullish",filled:fillIndex!==undefined,fillIndex,size:(high-low)/Math.max(atrAt(c,i,14),.0000001)})}
  if(c[i-1].low>c[i+1].high){const low=c[i+1].high,high=c[i-1].low;let fillIndex:number|undefined;for(let j=i+1;j<c.length;j++)if(c[j].high>=high){fillIndex=j;break}out.push({from:i-1,to:i+1,low,high,type:"bearish",filled:fillIndex!==undefined,fillIndex,size:(high-low)/Math.max(a,.0000001)})}
 }
 return out;
}
function findOrderBlocks(c:Candle[],a:number):OB[]{
 const out:OB[]=[];
 for(let i=1;i<c.length-3;i++){
  const bullishBase=c[i].close<c[i].open;
  const bearishBase=c[i].close>c[i].open;
  let bullBreak=-1,bearBreak=-1,bullStrength=0,bearStrength=0;
  for(let k=1;k<=3&&i+k<c.length;k++){
   const d=displacementAt(c,i+k,atrAt(c,i+k));
   if(bullishBase&&c[i+k].close>c[i].high&&d>=.55){bullBreak=i+k;bullStrength=d;break}
   if(bearishBase&&c[i+k].close<c[i].low&&d>=.55){bearBreak=i+k;bearStrength=d;break}
  }
  if(bullBreak>0){
   let m:number|undefined;
   for(let j=bullBreak+1;j<c.length;j++)if(c[j].low<=c[i].open){m=j;break}
   out.push({index:i,low:c[i].low,high:c[i].open,type:"bullish",mitigated:m!==undefined,mitigationIndex:m,strength:bullStrength});
  }
  if(bearBreak>0){
   let m:number|undefined;
   for(let j=bearBreak+1;j<c.length;j++)if(c[j].high>=c[i].open){m=j;break}
   out.push({index:i,low:c[i].open,high:c[i].high,type:"bearish",mitigated:m!==undefined,mitigationIndex:m,strength:bearStrength});
  }
 }
 return out;
}
function makeBreakers(obs:OB[],c:Candle[]):Breaker[]{return obs.filter(o=>o.mitigated&&o.mitigationIndex!==undefined).map((o):Breaker=>({index:o.mitigationIndex!,low:o.low,high:o.high,type:o.type==="bullish"?"bearish":"bullish",active:true})).filter(b=>{const k=c.slice(b.index+1);return b.type==="bullish"?k.every(x=>x.close>b.low):k.every(x=>x.close<b.high)})}
function equalLevels(ps:Pivot[],tol:number){const out:Pivot[]=[];for(let i=0;i<ps.length;i++)if(ps.slice(0,i).some(x=>Math.abs(x.price-ps[i].price)<=tol))out.push(ps[i]);return out}

export function analyzeSMC(c:Candle[]):SMCResult{
 const empty:SMCResult={trend:"Neutral",asOf:-1,pivots:[],internalPivots:[],events:[],fvgs:[],orderBlocks:[],breakers:[],liquidityHighs:[],liquidityLows:[],equalHighs:[],equalLows:[],sweeps:[],premiumDiscount:"Equilibrium",premiumDiscountRange:{high:0,low:0,mid:0},vwap:0,volumeRatio:0,displacement:0,entryZone:null,stop:null,targets:[],score:0,setup:{direction:"WAIT",status:"WAIT",entry:null,stop:null,targets:[],rr:null,confidence:0,confirmations:[]}};
 if(c.length<25)return empty;
 const a=atr(c),ps=labelPivots(pivots(c,3)),internal=labelPivots(pivots(c,1)),events:StructureEvent[]=[];let structure:"bullish"|"bearish"|null=null;let activeH:Pivot|null=null,activeL:Pivot|null=null;
 const confirmedHighs=ps.filter(p=>p.type==="H").sort((x,y)=>(x.confirmedAt??x.index)-(y.confirmedAt??y.index));
 const confirmedLows=ps.filter(p=>p.type==="L").sort((x,y)=>(x.confirmedAt??x.index)-(y.confirmedAt??y.index));
 let hiPtr=0,loPtr=0;
 for(let i=0;i<c.length;i++){
  while(hiPtr<confirmedHighs.length&&(confirmedHighs[hiPtr].confirmedAt??Infinity)<=i)activeH=confirmedHighs[hiPtr++];
  while(loPtr<confirmedLows.length&&(confirmedLows[loPtr].confirmedAt??Infinity)<=i)activeL=confirmedLows[loPtr++];
  const disp=displacementAt(c,i,atrAt(c,i))>=.7;
  if(activeH&&c[i].close>activeH.price){events.push({index:i,price:activeH.price,type:structure&&structure!=="bullish"?"CHOCH":"BOS",direction:"bullish",strength:disp?"displacement":"normal"});structure="bullish";activeH=null;}
  if(activeL&&c[i].close<activeL.price){events.push({index:i,price:activeL.price,type:structure&&structure!=="bearish"?"CHOCH":"BOS",direction:"bearish",strength:disp?"displacement":"normal"});structure="bearish";activeL=null;}
 }
 const fvgs=findFvgs(c,a),obs=findOrderBlocks(c,a),breakers=makeBreakers(obs,c),highs=ps.filter(p=>p.type==="H"),lows=ps.filter(p=>p.type==="L"),tol=Math.max(a*.18,.0000001);
 const equalHighs=equalLevels(highs,tol),equalLows=equalLevels(lows,tol);
 const liquidityHighs=equalHighs.length?equalHighs:highs.slice(-6),liquidityLows=equalLows.length?equalLows:lows.slice(-6);
 const sweeps:Sweep[]=[];
 for(const p of [...liquidityHighs.slice(-6),...liquidityLows.slice(-6)]){
  for(let j=p.index+1;j<c.length;j++){const hit=p.type==="H"?c[j].high>p.price&&c[j].close<p.price:c[j].low<p.price&&c[j].close>p.price;if(hit){sweeps.push({index:j,price:p.price,type:p.type==="H"?"high":"low",confirmed:true,displacement:displacementAt(c,j,a)>=.7});break}}
 }
  const r=range(c);
  const mid=(r.hi+r.lo)/2;
  const last=c[c.length-1];
  const recentVolumes=c.slice(-21,-1);
  const volBase=recentVolumes.reduce((s,x)=>s+x.volume,0)/Math.max(1,recentVolumes.length);
  const volumeRatio=last.volume/Math.max(volBase,.0000001);
  const recentCandles=c.slice(-60);
  const totalVolume=recentCandles.reduce((s,x)=>s+x.volume,0);
  const vwap=recentCandles.reduce((s,x)=>s+((x.high+x.low+x.close)/3)*x.volume,0)/Math.max(totalVolume,.0000001);
  const structureDirection=events.at(-1)?.direction??null;
 const trend=structureDirection==="bullish"?"Bullish":structureDirection==="bearish"?"Bearish":last.close>mid?"Bullish":last.close<mid?"Bearish":"Neutral";
 const pd=last.close>mid?"Premium":last.close<mid?"Discount":"Equilibrium";
 const rawDirection=structureDirection??(trend==="Bullish"?"bullish":trend==="Bearish"?"bearish":null);
 const ob=rawDirection?[...obs].reverse().find(x=>x.type===rawDirection&&!x.mitigated):undefined;
 const fvg=rawDirection?[...fvgs].reverse().find(x=>x.type===rawDirection&&!x.filled):undefined;
 const sweep=rawDirection==="bullish"?sweeps.slice().reverse().find(s=>s.type==="low"):rawDirection==="bearish"?sweeps.slice().reverse().find(s=>s.type==="high"):undefined;
 const zone=rawDirection?(ob?{low:ob.low,high:ob.high,type:"entry" as const}:fvg?{low:fvg.low,high:fvg.high,type:"entry" as const}:null):null;
 const direction=zone?rawDirection:null;
 const entry=zone?(zone.low+zone.high)/2:null;
 const priorLow=zone?[...lows].reverse().find(p=>p.index<c.length-1&&p.price<zone.low):undefined;
 const priorHigh=zone?[...highs].reverse().find(p=>p.index<c.length-1&&p.price>zone.high):undefined;
 const structuralLow=zone?(priorLow&&zone.low-priorLow.price<=a*1.5?priorLow.price:zone.low):null;
 const structuralHigh=zone?(priorHigh&&priorHigh.price-zone.high<=a*1.5?priorHigh.price:zone.high):null;
 const stop=zone?(direction==="bullish"&&structuralLow!==null?structuralLow-a*.15:direction==="bearish"&&structuralHigh!==null?structuralHigh+a*.15:null):null;
 const risk=entry!==null&&stop!==null?Math.abs(entry-stop):0;
 const structuralTargets=direction==="bullish"?[...liquidityHighs,...highs].map(p=>p.price).filter(p=>entry!==null&&p>entry&&p>last.close).sort((a,b)=>a-b):direction==="bearish"?[...liquidityLows,...lows].map(p=>p.price).filter(p=>entry!==null&&p<entry&&p<last.close).sort((a,b)=>b-a):[];
 const uniqueTargets=structuralTargets.filter((p,i,a)=>i===0||Math.abs(p-a[i-1])>Math.max(Math.abs(p)*0.0005,.0000001));
 const targets=entry!==null&&risk?(uniqueTargets.length?uniqueTargets.slice(0,4):[1,2,3,4].map(x=>direction==="bullish"?entry+risk*x:entry-risk*x)):[];
 const confirmations:string[]=[];
 if(direction&&events.at(-1)?.direction===direction)confirmations.push("Structure aligned");
 if(sweep?.confirmed&&sweep.displacement)confirmations.push("Liquidity sweep + displacement");
 if(ob)confirmations.push("Unmitigated order block");
 if(fvg)confirmations.push("Unfilled fair value gap");
 if(direction==="bullish"&&pd==="Discount"||direction==="bearish"&&pd==="Premium")confirmations.push("Premium/discount aligned");
 if(Math.abs(last.close-last.open)>=a*.5)confirmations.push("Displacement");
 const rawScore=35+confirmations.length*10+(events.at(-1)?.strength==="displacement"?10:0)+(equalHighs.length+equalLows.length>0?5:0);
 const score=zone&&direction?clamp(rawScore):0;
 const rr=entry!==null&&stop!==null&&targets[0]!==undefined?Math.abs(targets[0]-entry)/Math.abs(entry-stop):null;
 const usable=direction!==null&&entry!==null&&stop!==null&&risk>0&&targets.length>0;
 const plannedDirection=direction==="bullish"?"BUY":direction==="bearish"?"SELL":"WAIT";
 const status:Setup["status"]=usable&&isSetupActive(zone,last)?"ACTIVE":"WAIT";
 const setup:Setup={direction:usable?plannedDirection:"WAIT",status,entry:usable?entry:null,stop:usable?stop:null,targets:usable?targets:[],rr:usable?rr:null,confidence:usable?score:0,confirmations:usable?confirmations:[]};
 return{trend,asOf:c.length-1,pivots:ps.slice(-18),internalPivots:internal.slice(-24),events:events.slice(-12),fvgs:fvgs.slice(-14),orderBlocks:obs.slice(-10),breakers:breakers.slice(-8),liquidityHighs:liquidityHighs.slice(-8),liquidityLows:liquidityLows.slice(-8),equalHighs:equalHighs.slice(-8),equalLows:equalLows.slice(-8),sweeps:sweeps.slice(-10),premiumDiscount:pd,premiumDiscountRange:{high:r.hi,low:r.lo,mid},vwap,volumeRatio,displacement:displacementAt(c,c.length-1,a),entryZone:zone,stop,targets,score,setup};
}

export function analyzeElliott(c:Candle[]):AdvancedElliottResult{
 return analyzeElliottAdvanced(c);
}
export function analyzeMTF(frames:{interval:string;candles:Candle[]}[]):MTFResult{
 const rows:MTFFrame[]=frames.map(f=>{
  const available=f.candles.length>=25;
  if(!available)return{interval:f.interval,trend:"Neutral" as const,score:0,structure:"UNAVAILABLE",available:false,elliottTrend:"Neutral" as const,elliottScore:0,elliottPhase:"UNAVAILABLE"};
  const smc=analyzeSMC(f.candles),ew=analyzeElliott(f.candles);
  const elliottTrend=ew.primary?.direction==="bullish"?"Bullish":ew.primary?.direction==="bearish"?"Bearish":"Neutral";
  const smcSigned=smc.trend==="Bullish"?smc.score:smc.trend==="Bearish"?-smc.score:0;
  const ewSigned=elliottTrend==="Bullish"?ew.score:elliottTrend==="Bearish"?-ew.score:0;
  const signed=(smcSigned+ewSigned)/2;
  const trend:MTFFrame["trend"]=signed>12?"Bullish":signed<-12?"Bearish":"Neutral";
  return{interval:f.interval,trend,score:clamp(50+signed/2),structure:smc.events.at(-1)?.type??"No event",available:true,elliottTrend,elliottScore:ew.score,elliottPhase:ew.phase};
 });
 const usable=rows.filter(r=>r.available);
 const weight=(r:MTFFrame)=>r.interval==="4h"||r.interval==="1h"?1.4:1;
 const totalWeight=usable.reduce((sum,r)=>sum+weight(r),0);
 const weightedCentered=usable.reduce((sum,r)=>sum+(r.score-50)*weight(r),0)/Math.max(1,totalWeight);
 const elliottSigned=usable.reduce((sum,r)=>sum+(r.elliottTrend==="Bullish"?r.elliottScore:r.elliottTrend==="Bearish"?-r.elliottScore:0)*weight(r),0)/Math.max(1,totalWeight);
 return{
  trend:usable.length?(weightedCentered>12?"Bullish":weightedCentered<-12?"Bearish":"Neutral"):"Neutral",
  score:usable.length?clamp(50+weightedCentered/2):0,
  elliottTrend:usable.length?(elliottSigned>12?"Bullish":elliottSigned<-12?"Bearish":"Neutral"):"Neutral",
  elliottScore:usable.length?clamp(50+elliottSigned/2):0,
  frames:rows
 };
}

