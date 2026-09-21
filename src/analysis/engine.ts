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
const MIN_SETUP_RR=1.5;
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
function range(c:Candle[]){
 const q=c.slice(-60);
 return{hi:Math.max(...q.map(x=>x.high)),lo:Math.min(...q.map(x=>x.low))};
}
function body(c:Candle){return Math.abs(c.close-c.open)}
function displacementAt(c:Candle[],i:number,a:number){
 const tr=Math.max(trueRange(c,i),.0000001);
 const bodyAtr=a>0?body(c[i])/a:0;
 const bodyEfficiency=body(c[i])/tr;
 return bodyAtr*.65+bodyEfficiency*.35;
}
function labelPivots(ps:Pivot[]){
 const out:Pivot[]=[];let lastH:number|undefined,lastL:number|undefined;
 for(const p of ps){
  const q={...p};
  if(p.type==="H"){q.label=lastH===undefined?"SH":p.price>lastH?"HH":"LH";lastH=p.price}
  else{q.label=lastL===undefined?"SL":p.price>lastL?"HL":"LL";lastL=p.price}
  out.push(q);
 }
 return out;
}
function dealingRange(ps:Pivot[],c:Candle[],asOf:number){
 const confirmed=ps.filter(p=>(p.confirmedAt??p.index)<=asOf).sort((a,b)=>a.index-b.index);
 for(let i=confirmed.length-1;i>0;i--){
  const a=confirmed[i],b=confirmed[i-1];
  if(a.type===b.type)continue;
  const high=a.type==="H"?a:b;
  const low=a.type==="L"?a:b;
  if(high.price>low.price)return{
   hi:high.price,lo:low.price,
   anchorIndex:Math.min(high.index,low.index),
   source:"confirmed-swing" as const
  };
 }
 const r=range(c);
 return{hi:r.hi,lo:r.lo,anchorIndex:Math.max(0,asOf-59),source:"fallback-60" as const};
}
function uniquePivots(ps:Pivot[],tol:number){
 const out:Pivot[]=[];
 for(const p of [...ps].sort((a,b)=>a.index-b.index)){
  if(!out.some(x=>Math.abs(x.price-p.price)<=tol))out.push(p);
  else{
   const i=out.findIndex(x=>Math.abs(x.price-p.price)<=tol);
   if(i>=0&&p.index>out[i].index)out[i]=p;
  }
 }
 return out.sort((a,b)=>a.index-b.index);
}
function equalLevels(ps:Pivot[],tol:number){
 const unused=[...ps].sort((a,b)=>a.price-b.price);
 const reps:Pivot[]=[];
 while(unused.length){
  const seed=unused.shift()!;
  const cluster=[seed];
  for(let i=unused.length-1;i>=0;i--){
   if(Math.abs(unused[i].price-seed.price)<=tol)cluster.push(unused.splice(i,1)[0]);
  }
  if(cluster.length>=2){
   reps.push(cluster.reduce((best,p)=>p.index>best.index?p:best));
  }
 }
 return reps.sort((a,b)=>a.index-b.index);
}
function detectStructureEvents(c:Candle[],ps:Pivot[]):StructureEvent[]{
 const events:StructureEvent[]=[];
 let structure:"bullish"|"bearish"|null=null;
 let activeH:Pivot|null=null,activeL:Pivot|null=null;
 const confirmedHighs=ps.filter(p=>p.type==="H").sort((x,y)=>(x.confirmedAt??x.index)-(y.confirmedAt??y.index));
 const confirmedLows=ps.filter(p=>p.type==="L").sort((x,y)=>(x.confirmedAt??x.index)-(y.confirmedAt??y.index));
 let hiPtr=0,loPtr=0;
 for(let i=0;i<c.length;i++){
  while(hiPtr<confirmedHighs.length&&(confirmedHighs[hiPtr].confirmedAt??Infinity)<=i)activeH=confirmedHighs[hiPtr++];
  while(loPtr<confirmedLows.length&&(confirmedLows[loPtr].confirmedAt??Infinity)<=i)activeL=confirmedLows[loPtr++];
  const disp=displacementAt(c,i,atrAt(c,i))>=.7;
  const brokeBull=!!activeH&&c[i].close>activeH.price;
  const brokeBear=!!activeL&&c[i].close<activeL.price;
  if(brokeBull&&brokeBear){
   activeH=null;activeL=null;
   continue;
  }
  if(brokeBull){
   events.push({index:i,price:activeH!.price,type:structure&&structure!=="bullish"?"CHOCH":"BOS",direction:"bullish",strength:disp?"displacement":"normal"});
   structure="bullish";activeH=null;
  }else if(brokeBear){
   events.push({index:i,price:activeL!.price,type:structure&&structure!=="bearish"?"CHOCH":"BOS",direction:"bearish",strength:disp?"displacement":"normal"});
   structure="bearish";activeL=null;
  }
 }
 return events;
}
function findFvgs(c:Candle[],a:number,asOf=c.length-1):FVG[]{
 const out:FVG[]=[];
 const endIndex=Math.min(asOf,c.length-1);
 for(let i=1;i<endIndex;i++){
  if(c[i-1].high<c[i+1].low){
   const low=c[i-1].high,high=c[i+1].low;
   let fillIndex:number|undefined;
   for(let j=i+1;j<=endIndex;j++)if(c[j].low<=low){fillIndex=j;break}
   out.push({from:i-1,to:i+1,low,high,type:"bullish",filled:fillIndex!==undefined,fillIndex,size:(high-low)/Math.max(atrAt(c,i,14),.0000001)})
  }
  if(c[i-1].low>c[i+1].high){
   const low=c[i+1].high,high=c[i-1].low;
   let fillIndex:number|undefined;
   for(let j=i+1;j<=endIndex;j++)if(c[j].high>=high){fillIndex=j;break}
   out.push({from:i-1,to:i+1,low,high,type:"bearish",filled:fillIndex!==undefined,fillIndex,size:(high-low)/Math.max(atrAt(c,i,14),.0000001)})
  }
 }
 return out;
}
function findOrderBlocks(c:Candle[],a:number,asOf=c.length-1,events:StructureEvent[]=[]):OB[]{
 const out:OB[]=[];
 const end=Math.min(asOf,c.length-1);
 for(let i=1;i<=end-1;i++){
  const bullishBase=c[i].close<c[i].open;
  const bearishBase=c[i].close>c[i].open;
  let bullBreak=-1,bearBreak=-1,bullStrength=0,bearStrength=0;
  for(let k=1;k<=3&&i+k<=end;k++){
   const d=displacementAt(c,i+k,atrAt(c,i+k));
   if(bullishBase&&c[i+k].close>c[i].high&&d>=.55){bullBreak=i+k;bullStrength=d;break}
   if(bearishBase&&c[i+k].close<c[i].low&&d>=.55){bearBreak=i+k;bearStrength=d;break}
  }
  if(bullBreak>0){
   const linked=events.some(e=>e.direction==="bullish"&&e.index>=i+1&&e.index<=Math.min(end,i+12));
   if(linked){
    let m:number|undefined,invalid:number|undefined;
    for(let j=bullBreak+1;j<=end;j++){
     if(m===undefined&&c[j].low<=c[i].open)m=j;
     if(c[j].close<c[i].low){invalid=j;break}
    }
    // A block that breaks before it is mitigated is no longer a valid active OB.
    if(m!==undefined||invalid===undefined){
     out.push({index:i,low:c[i].low,high:c[i].open,type:"bullish",mitigated:m!==undefined,mitigationIndex:m,strength:bullStrength});
    }
   }
  }
  if(bearBreak>0){
   const linked=events.some(e=>e.direction==="bearish"&&e.index>=i+1&&e.index<=Math.min(end,i+12));
   if(linked){
    let m:number|undefined,invalid:number|undefined;
    for(let j=bearBreak+1;j<=end;j++){
     if(m===undefined&&c[j].high>=c[i].open)m=j;
     if(c[j].close>c[i].high){invalid=j;break}
    }
    if(m!==undefined||invalid===undefined){
     out.push({index:i,low:c[i].open,high:c[i].high,type:"bearish",mitigated:m!==undefined,mitigationIndex:m,strength:bearStrength});
    }
   }
  }
 }
 return out;
}
function makeBreakers(obs:OB[],c:Candle[],asOf=c.length-1):Breaker[]{
 return obs
  .filter(o=>o.mitigated&&o.mitigationIndex!==undefined&&o.mitigationIndex!<=asOf)
  .map((o):Breaker=>({index:o.mitigationIndex!,low:o.low,high:o.high,type:o.type==="bullish"?"bearish":"bullish",active:true}))
  .filter(b=>{
   const k=c.slice(b.index+1,Math.min(asOf+1,c.length));
   return k.length>0&&(b.type==="bullish"?k.every(x=>x.close>b.low):k.every(x=>x.close<b.high));
  });
}
type ZoneCandidate={low:number;high:number;origin:number;kind:"OB"|"FVG";strength:number;linked:boolean;distance:number};
function chooseEntryZone(
 direction:"bullish"|"bearish"|null,
 obs:OB[],
 fvgs:FVG[],
 events:StructureEvent[],
 last:Candle,
 atrValue:number,
 asOf:number
):ZoneCandidate|null{
 if(!direction)return null;
 const latestEvent=[...events].reverse().find(e=>e.direction===direction&&e.index<=asOf);
 const candidates:ZoneCandidate[]=[];
 for(const o of obs){
  if(o.type!==direction||o.mitigated)continue;
  const age=asOf-o.index;
  if(age<0||age>50)continue;
  const distance=last.close<o.low?o.low-last.close:last.close>o.high?last.close-o.high:0;
  if(distance>atrValue*3.5)continue;
  const linked=!!latestEvent&&o.index<=latestEvent.index&&latestEvent.index-o.index<=12;
  candidates.push({low:o.low,high:o.high,origin:o.index,kind:"OB",strength:o.strength??0,linked,distance});
 }
 for(const f of fvgs){
  if(f.type!==direction||f.filled)continue;
  const origin=f.to,age=asOf-origin;
  if(age<0||age>40)continue;
  const distance=last.close<f.low?f.low-last.close:last.close>f.high?last.close-f.high:0;
  if(distance>atrValue*3.5)continue;
  const linked=!!latestEvent&&origin<=latestEvent.index&&latestEvent.index-origin<=12;
  candidates.push({low:f.low,high:f.high,origin,kind:"FVG",strength:f.size??0,linked,distance});
 }
 if(!candidates.length)return null;
 candidates.sort((x,y)=>{
  const score=(z:ZoneCandidate)=>
   (z.linked?100000:0)
   +(z.kind==="OB"?20000:10000)
   +Math.max(0,5000-(asOf-z.origin)*100)
   +Math.min(2000,z.strength*250)
   -Math.min(5000,z.distance/Math.max(atrValue,.0000001)*1000);
  return score(y)-score(x);
 });
 return candidates[0];
}
function recentOpposingTargets(direction:"bullish"|"bearish",entry:number,last:Candle,obs:OB[],fvgs:FVG[],asOf:number,atrValue:number){
 const levels:number[]=[];
 const opposite=direction==="bullish"?"bearish":"bullish";
 for(const o of obs){
  if(o.type!==opposite||o.mitigated||asOf-o.index>50)continue;
  const mid=(o.low+o.high)/2;
  if(direction==="bullish"&&mid>Math.max(entry,last.close)&&mid<=last.close+atrValue*8)levels.push(mid);
  if(direction==="bearish"&&mid<Math.min(entry,last.close)&&mid>=last.close-atrValue*8)levels.push(mid);
 }
 for(const f of fvgs){
  if(f.type!==opposite||f.filled||asOf-f.to>40)continue;
  const mid=(f.low+f.high)/2;
  if(direction==="bullish"&&mid>Math.max(entry,last.close)&&mid<=last.close+atrValue*8)levels.push(mid);
  if(direction==="bearish"&&mid<Math.min(entry,last.close)&&mid>=last.close-atrValue*8)levels.push(mid);
 }
 return levels;
}

export function analyzeSMC(c:Candle[]):SMCResult{
 const empty:SMCResult={trend:"Neutral",asOf:-1,pivots:[],internalPivots:[],events:[],fvgs:[],orderBlocks:[],breakers:[],liquidityHighs:[],liquidityLows:[],equalHighs:[],equalLows:[],sweeps:[],premiumDiscount:"Equilibrium",premiumDiscountRange:{high:0,low:0,mid:0},vwap:0,volumeRatio:0,displacement:0,entryZone:null,stop:null,targets:[],score:0,setup:{direction:"WAIT",status:"WAIT",entry:null,stop:null,targets:[],rr:null,confidence:0,confirmations:[]}};
 if(c.length<25)return empty;
 const a=atr(c),ps=labelPivots(pivots(c,3)),internal=labelPivots(pivots(c,1));
 const events=detectStructureEvents(c,ps);
 const internalEvents=detectStructureEvents(c,internal);
 const asOf=c.length-1;
 const fvgs=findFvgs(c,a,asOf),obs=findOrderBlocks(c,a,asOf,events),breakers=makeBreakers(obs,c,asOf),highs=ps.filter(p=>(p.confirmedAt??p.index)<=asOf&&p.type==="H"),lows=ps.filter(p=>(p.confirmedAt??p.index)<=asOf&&p.type==="L"),tol=Math.max(a*.18,.0000001);
 const equalHighs=equalLevels(highs,tol),equalLows=equalLevels(lows,tol);
 const liquidityHighs=uniquePivots([...equalHighs,...highs.slice(-6)],tol).slice(-8);
 const liquidityLows=uniquePivots([...equalLows,...lows.slice(-6)],tol).slice(-8);
 const sweeps:Sweep[]=[];
 for(const p of [...liquidityHighs,...liquidityLows]){
  if(asOf-p.index>40)continue;
  for(let j=p.index+1;j<=asOf;j++){
   const hit=p.type==="H"?c[j].high>p.price&&c[j].close<p.price:c[j].low<p.price&&c[j].close>p.price;
   if(hit){
    sweeps.push({index:j,price:p.price,type:p.type==="H"?"high":"low",confirmed:true,displacement:displacementAt(c,j,atrAt(c,j))>=.7});
    break;
   }
  }
 }
 const r=dealingRange(ps,c,asOf);
 const mid=(r.hi+r.lo)/2;
 const last=c[c.length-1];
 const recentVolumes=c.slice(-21,-1);
 const volBase=recentVolumes.reduce((s,x)=>s+x.volume,0)/Math.max(1,recentVolumes.length);
 const volumeRatio=last.volume/Math.max(volBase,.0000001);
 const recentCandles=c.slice(Math.min(r.anchorIndex,asOf),asOf+1);
 const totalVolume=recentCandles.reduce((sum,x)=>sum+x.volume,0);
 const vwap=recentCandles.reduce((sum,x)=>sum+((x.high+x.low+x.close)/3)*x.volume,0)/Math.max(totalVolume,.0000001);
 const structureDirection=events.at(-1)?.direction??null;
 const trend=structureDirection==="bullish"?"Bullish":structureDirection==="bearish"?"Bearish":last.close>mid?"Bullish":last.close<mid?"Bearish":"Neutral";
 const pd=last.close>mid?"Premium":last.close<mid?"Discount":"Equilibrium";
 const rawDirection=structureDirection??(trend==="Bullish"?"bullish":trend==="Bearish"?"bearish":null);
 const sweep=rawDirection==="bullish"
  ?sweeps.slice().reverse().find(x=>x.type==="low"&&asOf-x.index<=20)
  :rawDirection==="bearish"
   ?sweeps.slice().reverse().find(x=>x.type==="high"&&asOf-x.index<=20)
   :undefined;
 const selectedZone=chooseEntryZone(rawDirection,obs,fvgs,events,last,a,asOf);
 const zone=selectedZone?{low:selectedZone.low,high:selectedZone.high,type:"entry" as const}:null;
 const direction=zone?rawDirection:null;
 const entry=zone?(zone.low+zone.high)/2:null;
 const zoneOrigin=selectedZone?.origin??asOf;
 const priorLow=zone?[...lows].reverse().find(p=>p.index<zoneOrigin):undefined;
 const priorHigh=zone?[...highs].reverse().find(p=>p.index<zoneOrigin):undefined;
 const structuralLow=zone?(priorLow&&zone.low-priorLow.price<=a*1.8?priorLow.price:zone.low):null;
 const structuralHigh=zone?(priorHigh&&priorHigh.price-zone.high<=a*1.8?priorHigh.price:zone.high):null;
 const stop=zone?(direction==="bullish"&&structuralLow!==null?structuralLow-a*.15:direction==="bearish"&&structuralHigh!==null?structuralHigh+a*.15:null):null;
 const risk=entry!==null&&stop!==null?Math.abs(entry-stop):0;
 const structuralTargets=direction==="bullish"
  ?[...liquidityHighs,...highs].map(p=>p.price).filter(p=>entry!==null&&p>Math.max(entry,last.close)).sort((a,b)=>a-b)
  :direction==="bearish"
   ?[...liquidityLows,...lows].map(p=>p.price).filter(p=>entry!==null&&p<Math.min(entry,last.close)).sort((a,b)=>b-a)
   :[];
 const opposingTargets=direction&&entry!==null?recentOpposingTargets(direction,entry,last,obs,fvgs,asOf,a):[];
 const uniqueTargets=[...structuralTargets,...opposingTargets].sort((x,y)=>direction==="bullish"?x-y:y-x)
  .filter((p,i,arr)=>i===0||Math.abs(p-arr[i-1])>Math.max(Math.abs(p)*0.0005,.0000001));
 const targets=entry!==null&&risk
  ?uniqueTargets.filter(p=>Math.abs(p-entry)/risk>=MIN_SETUP_RR).slice(0,4)
  :[];
 const confirmations:string[]=[];
 if(direction&&events.at(-1)?.direction===direction)confirmations.push("Swing structure aligned");
 if(direction&&internalEvents.at(-1)?.direction===direction)confirmations.push("Internal structure aligned");
 if(sweep?.confirmed&&sweep.displacement)confirmations.push("Liquidity sweep + displacement");
 if(selectedZone?.kind==="OB")confirmations.push("Qualified unmitigated order block");
 if(selectedZone?.kind==="FVG")confirmations.push("Qualified unfilled fair value gap");
 if(selectedZone?.linked)confirmations.push("Zone linked to latest structure event");
 if(direction==="bullish"&&pd==="Discount"||direction==="bearish"&&pd==="Premium")confirmations.push("Premium/discount aligned");
 if(Math.abs(last.close-last.open)>=a*.5)confirmations.push("Displacement");
 const rawScore=35+confirmations.length*10+(events.at(-1)?.strength==="displacement"?10:0)+(equalHighs.length+equalLows.length>0?5:0);
 const score=zone&&direction?clamp(rawScore):0;
 const rr=entry!==null&&stop!==null&&targets[0]!==undefined?Math.abs(targets[0]-entry)/Math.abs(entry-stop):null;
 const usable=direction!==null&&entry!==null&&stop!==null&&risk>0&&targets.length>0&&rr!==null&&rr>=MIN_SETUP_RR;
 const plannedDirection=direction==="bullish"?"BUY":direction==="bearish"?"SELL":"WAIT";
 const status:Setup["status"]=usable&&isSetupActive(zone,last)?"ACTIVE":"WAIT";
 const setup:Setup={direction:usable?plannedDirection:"WAIT",status,entry:usable?entry:null,stop:usable?stop:null,targets:usable?targets:[],rr:usable?rr:null,confidence:usable?score:0,confirmations:usable?confirmations:[]};
 return{trend,asOf:c.length-1,pivots:ps.slice(-18),internalPivots:internal.slice(-24),events:events.slice(-12),fvgs:fvgs.slice(-14),orderBlocks:obs.slice(-10),breakers:breakers.slice(-8),liquidityHighs:liquidityHighs.slice(-8),liquidityLows:liquidityLows.slice(-8),equalHighs:equalHighs.slice(-8),equalLows:equalLows.slice(-8),sweeps:sweeps.slice(-10),premiumDiscount:pd,premiumDiscountRange:{high:r.hi,low:r.lo,mid},vwap,volumeRatio,displacement:displacementAt(c,c.length-1,a),entryZone:zone,stop,targets,score,setup};
}

export type ImpulseMetrics={w1:number;w2:number;w3:number;w4:number;w5:number;r2:number;r3:number;r4:number;r5:number};
export function impulseMetrics(prices:number[]):ImpulseMetrics|null{
 if(prices.length<6)return null;
 const [p0,p1,p2,p3,p4,p5]=prices;
 const w1=Math.abs(p1-p0),w2=Math.abs(p2-p1),w3=Math.abs(p3-p2),w4=Math.abs(p4-p3),w5=Math.abs(p5-p4);
 if(!w1||!w2||!w3||!w4||!w5)return null;
 return{w1,w2,w3,w4,w5,r2:w2/w1,r3:w3/w1,r4:w4/w3,r5:w5/w1};
}

export function buildImpulseFibLevels(prices:number[],bull:boolean):{label:string;price:number}[]{
 if(prices.length<6)return[];
 const [p0,,,,,p5]=prices,dir=bull?1:-1,range=Math.abs(p5-p0);
 return[
  ["0%",p5],["23.6%",p5+(p0-p5)*.236],["38.2%",p5+(p0-p5)*.382],["50%",p5+(p0-p5)*.5],
  ["61.8%",p5+(p0-p5)*.618],["78.6%",p5+(p0-p5)*.786],["100%",p0],
  ["127.2%",p5+dir*range*.272],["161.8%",p5+dir*range*.618],["261.8%",p5+dir*range*1.618]
 ].map(([label,price])=>({label:String(label),price:Number(price)}));
}

export type ImpulseValidation={
 w2Valid:boolean;w3BeyondW1:boolean;w3NotShortest:boolean;w4Valid:boolean;
 w5DirectionValid:boolean;w5BeyondW3:boolean;truncated:boolean;valid:boolean;
};
export function validateImpulseWave(prices:number[],bull:boolean):ImpulseValidation{
 if(prices.length<6)return{w2Valid:false,w3BeyondW1:false,w3NotShortest:false,w4Valid:false,w5DirectionValid:false,w5BeyondW3:false,truncated:false,valid:false};
 const [p0,p1,p2,p3,p4,p5]=prices;
 const w1=Math.abs(p1-p0),w3=Math.abs(p3-p2),w5=Math.abs(p5-p4);
 const w2Valid=bull?p2>p0&&p2<p1:p2<p0&&p2>p1;
 const w3BeyondW1=bull?p3>p1:p3<p1;
 const w3NotShortest=w3>=w1&&w3>=w5;
 const w4Valid=bull?p4>p1&&p4<p3:p4<p1&&p4>p3;
 const w5DirectionValid=bull?p5>p4:p5<p4;
 const w5BeyondW3=bull?p5>p3:p5<p3;
 const truncated=w5DirectionValid&&!w5BeyondW3;
 return{w2Valid,w3BeyondW1,w3NotShortest,w4Valid,w5DirectionValid,w5BeyondW3,truncated,valid:w2Valid&&w3BeyondW1&&w3NotShortest&&w4Valid&&w5DirectionValid};
}

export type DiagonalValidation={
 w2Valid:boolean;w3BeyondW1:boolean;w3NotShortest:boolean;w4OverlapsW1:boolean;w4DoesNotPassW2:boolean;
 w5DirectionValid:boolean;w5BeyondW3:boolean;contracting:boolean;expanding:boolean;valid:boolean;
};
export function validateDiagonalWave(prices:number[],bull:boolean):DiagonalValidation{
 if(prices.length<6)return{w2Valid:false,w3BeyondW1:false,w3NotShortest:false,w4OverlapsW1:false,w4DoesNotPassW2:false,w5DirectionValid:false,w5BeyondW3:false,contracting:false,expanding:false,valid:false};
 const [p0,p1,p2,p3,p4,p5]=prices;
 const w1=Math.abs(p1-p0),w2=Math.abs(p2-p1),w3=Math.abs(p3-p2),w4=Math.abs(p4-p3),w5=Math.abs(p5-p4);
 const w2Valid=bull?p2>p0&&p2<p1:p2<p0&&p2>p1;
 const w3BeyondW1=bull?p3>p1:p3<p1;
 const w3NotShortest=w3>=w5;
 const w4OverlapsW1=bull?p4<=p1&&p4>p2:p4>=p1&&p4<p2;
 const w4DoesNotPassW2=bull?p4>p2:p4<p2;
 const w5DirectionValid=bull?p5>p4:p5<p4;
 const w5BeyondW3=bull?p5>p3:p5<p3;
 const contracting=w3<w1&&w4<w2&&w5<w3;
 const expanding=w3>w1&&w4>w2&&w5>w3;
 return{w2Valid,w3BeyondW1,w3NotShortest,w4OverlapsW1,w4DoesNotPassW2,w5DirectionValid,w5BeyondW3,contracting,expanding,valid:w2Valid&&w3BeyondW1&&w3NotShortest&&w4OverlapsW1&&w4DoesNotPassW2&&w5DirectionValid};
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

