import { analyzeElliottAdvanced, type AdvancedElliottResult } from "./elliott";
export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number;takerBuyVolume?:number;closed?:boolean};
export type Pivot={index:number;price:number;type:"H"|"L";label?:string;strength?:number;confirmedAt?:number};
export type FVG={from:number;to:number;low:number;high:number;type:"bullish"|"bearish";filled:boolean;fillIndex?:number;partial?:boolean;partialFillIndex?:number;size?:number};
export type OB={index:number;low:number;high:number;type:"bullish"|"bearish";mitigated:boolean;mitigationIndex?:number;strength?:number};
export type Breaker={index:number;low:number;high:number;type:"bullish"|"bearish";active:boolean};
export type StructureEvent={index:number;price:number;type:"BOS"|"CHOCH";direction:"bullish"|"bearish";strength:"normal"|"displacement"};
export type Sweep={index:number;price:number;type:"high"|"low";confirmed:boolean;displacement?:boolean};
export type Zone={low:number;high:number;type:"entry"|"stop"|"target"};
export type Setup={direction:"BUY"|"SELL"|"WAIT";status:"WAIT"|"ACTIVE";entry:number|null;stop:number|null;targets:number[];rr:number|null;confidence:number;confirmations:string[]};
export function isValidTradeGeometry(direction:"BUY"|"SELL",entry:number,stop:number,targets:number[],minRR=1.5):boolean{
 if(!Number.isFinite(entry)||!Number.isFinite(stop)||entry<=0||stop<=0||entry===stop)return false;
 const risk=Math.abs(entry-stop);
 if(risk<=0)return false;
 if(direction!=="BUY"&&direction!=="SELL")return false;
 if(direction==="BUY"&&stop>=entry)return false;
 if(direction==="SELL"&&stop<=entry)return false;
 if(!Array.isArray(targets)||targets.length===0)return false;
 if(!targets.every(t=>Number.isFinite(t)))return false;
 if(!targets.every(t=>direction==="BUY"?t>entry:t<entry))return false;
 const requiredRR=Number.isFinite(minRR)&&minRR>0?minRR:MIN_SETUP_RR;
 return targets.every(t=>Math.abs(t-entry)/risk>=requiredRR);
}
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
 liveSetup?:WaveCount|null;
};
export type MTFFrame={interval:string;trend:"Bullish"|"Bearish"|"Neutral";score:number;structure:string;available:boolean;elliottTrend:"Bullish"|"Bearish"|"Neutral";elliottScore:number;elliottPhase:string};
export type MTFResult={trend:"Bullish"|"Bearish"|"Neutral";score:number;elliottTrend:"Bullish"|"Bearish"|"Neutral";elliottScore:number;frames:MTFFrame[]};

export function mtfFrameWeight(interval:string):number{
 const weights:Record<string,number>={"1d":3.5,"4h":3,"1h":2,"15m":1.5,"5m":1,"1m":0.75};
 return weights[interval]??1;
}

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
export function classifyPremiumDiscount(price:number,high:number,low:number):"Premium"|"Discount"|"Equilibrium"{
 if(!Number.isFinite(price)||!Number.isFinite(high)||!Number.isFinite(low)||high<=low)return "Equilibrium";
 const mid=(high+low)/2;
 return price>mid?"Premium":price<mid?"Discount":"Equilibrium";
}
export function isSetupActive(zone:Zone|null,last:Candle|undefined):boolean{return !!zone&&!!last&&last.closed!==false&&last.high>=zone.low&&last.low<=zone.high}
export function isSMCCausalSequence(sweepIndex:number,swingBreakIndex:number,internalBreakIndex:number|null,maxGap=12):boolean{
 // Treat the swing break and internal confirmation as two distinct events.
 // An internal event printed on the exact same candle as the swing break is
 // not independent confirmation and can double-count one price move.
 return sweepIndex>=0
  &&swingBreakIndex>sweepIndex
  &&swingBreakIndex-sweepIndex<=maxGap
  &&internalBreakIndex!==null
  &&internalBreakIndex>swingBreakIndex
  &&internalBreakIndex-swingBreakIndex<=maxGap;
}
export function isValidLiquiditySweep(c:Candle[],sweepIndex:number,level:number,type:"high"|"low",asOf=c.length-1):boolean{
 if(!Number.isFinite(level)||!Number.isFinite(asOf)||asOf<0)return false;
 let closedEnd=Math.min(Math.floor(asOf),c.length-1);
 const firstUnclosed=c.slice(0,closedEnd+1).findIndex(x=>x.closed===false);
 if(firstUnclosed>=0)closedEnd=firstUnclosed-1;
 if(sweepIndex<0||sweepIndex>closedEnd||sweepIndex>=c.length)return false;
 const sweepCandle=c[sweepIndex];
 if(sweepCandle.closed===false)return false;
 const hit=type==="high"
  ?sweepCandle.high>level&&sweepCandle.close<level
  :sweepCandle.low<level&&sweepCandle.close>level;
 if(!hit)return false;
 for(let i=sweepIndex+1;i<=closedEnd;i++){
  if(type==="high"&&c[i].close>level)return false;
  if(type==="low"&&c[i].close<level)return false;
 }
 return true;
}
export function findLatestValidLiquiditySweep(c:Candle[],level:number,type:"high"|"low",startIndex:number,asOf=c.length-1):Sweep|null{
 let closedEnd=Math.min(asOf,c.length-1);
 const firstUnclosed=c.slice(0,closedEnd+1).findIndex(x=>x.closed===false);
 if(firstUnclosed>=0)closedEnd=firstUnclosed-1;
 if(startIndex>closedEnd)return null;
 let latest:Sweep|null=null;
 for(let i=Math.max(0,startIndex);i<=closedEnd;i++){
  if(isValidLiquiditySweep(c,i,level,type,closedEnd)){
   latest={index:i,price:level,type,confirmed:true};
  }
 }
 return latest;
}
export function isPostSweepZoneCausal(zoneOrigin:number,sweepIndex:number,structureIndex:number,maxGap=12):boolean{
 return zoneOrigin>=sweepIndex&&zoneOrigin<=structureIndex&&structureIndex-zoneOrigin<=maxGap;
}
export function isOrderBlockCausal(zoneOrigin:number,displacementIndex:number,structureIndex:number,maxGap=12):boolean{
 return zoneOrigin<displacementIndex&&structureIndex>=displacementIndex&&structureIndex-zoneOrigin<=maxGap;
}
export function isEntryZoneCausal(zoneOrigin:number,sweepIndex:number,structureIndex:number,kind:"OB"|"FVG"|"BREAKER",maxGap=12):boolean{
 if(kind==="BREAKER"){
  return sweepIndex>=0&&structureIndex>sweepIndex&&structureIndex-sweepIndex<=maxGap
   &&zoneOrigin>=structureIndex&&zoneOrigin-structureIndex<=maxGap;
 }
 return isPostSweepZoneCausal(zoneOrigin,sweepIndex,structureIndex,maxGap);
}
function range(c:Candle[],asOf=c.length-1){
 const end=Math.min(asOf,c.length-1);
 if(end<0)return{hi:0,lo:0};
 const firstUnclosed=c.slice(0,end+1).findIndex(x=>x.closed===false);
 const causalEnd=firstUnclosed>=0?firstUnclosed-1:end;
 const q=c.slice(0,causalEnd+1).filter(x=>Number.isFinite(x.high)&&Number.isFinite(x.low)).slice(-60);
 if(!q.length)return{hi:0,lo:0};
 return{hi:Math.max(...q.map(x=>x.high)),lo:Math.min(...q.map(x=>x.low))};
}
function body(c:Candle){return Math.abs(c.close-c.open)}
function displacementAt(c:Candle[],i:number){
 if(i<0||i>=c.length)return 0;
 // Use the ATR available before the candidate candle. Including the current
 // candle's true range in its own denominator suppresses displacement exactly
 // when the candle is unusually large, which can make genuine BOS/OB impulses
 // look ordinary. This keeps the displacement test causal and stable.
 const priorAtr=atrAt(c,i-1,14);
 const tr=Math.max(trueRange(c,i),.0000001);
 const bodyAtr=priorAtr>0?body(c[i])/priorAtr:0;
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
 const endIndex=Math.min(asOf,c.length-1);
 const confirmed=ps
  .filter(p=>(p.confirmedAt??p.index)<=endIndex&&p.index<=endIndex)
  .sort((a,b)=>(a.confirmedAt??a.index)-(b.confirmedAt??b.index));
 const rangeMinWidth=Math.max(atrAt(c,endIndex,14)*2,.0000001);
 // Prefer the latest confirmed alternating swing pair that is wide enough
 // to represent the active dealing range rather than micro-structure noise.
 for(let i=confirmed.length-1;i>0;i--){
  const a=confirmed[i],b=confirmed[i-1];
  if(a.type===b.type)continue;
  const high=a.type==="H"?a:b;
  const low=a.type==="L"?a:b;
  if(high.index> endIndex||low.index> endIndex)continue;
  if(high.price>low.price&&high.price-low.price>=rangeMinWidth){
   return{
    hi:high.price,
    lo:low.price,
    anchorIndex:Math.min(high.index,low.index),
    source:"confirmed-swing" as const
   };
  }
 }
 // If no meaningful swing pair exists, use only closed candles. The anchor
 // is the actual first candle included, not an assumed asOf-59 index.
 const closed=c.slice(0,endIndex+1).filter(x=>x.closed!==false).slice(-60);
 if(!closed.length)return{hi:0,lo:0,anchorIndex:0,source:"fallback-60" as const};
 const hi=Math.max(...closed.map(x=>x.high));
 const lo=Math.min(...closed.map(x=>x.low));
 return{
  hi,
  lo,
  anchorIndex:Math.max(0,endIndex-(closed.length-1)),
  source:"fallback-60" as const
 };
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
 // Cluster by price using a running band rather than a single seed. This
 // avoids missing transitive equal levels (A≈B, B≈C, but A slightly > C)
 // while still requiring each liquidity test to be separated in time.
 const ordered=[...ps].sort((a,b)=>a.price-b.price);
 const reps:Pivot[]=[];
 let cluster:Pivot[]=[];
 const flush=()=>{
  if(cluster.length<2){cluster=[];return;}
  // Require at least two distinct tests with >=3 bars separation.
  let separated=false;
  for(let i=0;i<cluster.length&&!separated;i++){
   for(let j=i+1;j<cluster.length;j++){
    if(Math.abs(cluster[j].index-cluster[i].index)>=3){separated=true;break;}
   }
  }
  if(separated){
   const latest=cluster.reduce((best,p)=>p.index>best.index?p:best,cluster[0]);
   reps.push(latest);
  }
  cluster=[];
 };
 for(const p of ordered){
  if(!cluster.length){cluster=[p];continue;}
  const bandLow=Math.min(...cluster.map(x=>x.price));
  const bandHigh=Math.max(...cluster.map(x=>x.price));
  if(p.price-bandLow<=tol&&p.price-bandHigh<=tol){
   cluster.push(p);
  }else{
   flush();
   cluster=[p];
  }
 }
 flush();
 return reps.sort((a,b)=>a.index-b.index);
}
export function classifyStructureBreak(
 previousDirection:"bullish"|"bearish"|null,
 breakDirection:"bullish"|"bearish"
):"BOS"|"CHOCH"{
 return previousDirection!==null&&previousDirection!==breakDirection?"CHOCH":"BOS";
}
export function classifyProtectedStructureBreak(
 previousDirection:"bullish"|"bearish"|null,
 brokenSide:"high"|"low",
 protectedSide:"high"|"low"|null,
 protectedIndex?:number,
 brokenIndex?:number
):"BOS"|"CHOCH"|null{
 if(previousDirection===null)return "BOS";
 const continuationSide=previousDirection==="bullish"?"high":"low";
 if(brokenSide===continuationSide)return "BOS";
 // A counter-trend break is CHOCH only when the actual protected pivot was
 // broken. Merely breaking a newer, unprotected pivot on the same side must
 // not be promoted to CHOCH.
 if(protectedSide===brokenSide){
  if(protectedIndex===undefined||brokenIndex===undefined||protectedIndex===brokenIndex)return "CHOCH";
 }
 return null;
}
function detectStructureEvents(c:Candle[],ps:Pivot[]):StructureEvent[]{
 const events:StructureEvent[]=[];
 let structure:"bullish"|"bearish"|null=null;
 let activeH:Pivot|null=null,activeL:Pivot|null=null;
 let protectedHigh:Pivot|null=null,protectedLow:Pivot|null=null;
 const confirmedHighs=ps.filter(p=>p.type==="H").sort((x,y)=>(x.confirmedAt??x.index)-(y.confirmedAt??y.index));
 const confirmedLows=ps.filter(p=>p.type==="L").sort((x,y)=>(x.confirmedAt??x.index)-(y.confirmedAt??y.index));
 let hiPtr=0,loPtr=0;
 const latestBefore=(list:Pivot[],index:number):Pivot|null=>{
  for(let j=list.length-1;j>=0;j--){
   const p=list[j];
   if(p.index<index&&(p.confirmedAt??p.index)<=index)return p;
  }
  return null;
 };
 for(let i=0;i<c.length;i++){
  while(hiPtr<confirmedHighs.length&&(confirmedHighs[hiPtr].confirmedAt??Infinity)<=i)activeH=confirmedHighs[hiPtr++];
  while(loPtr<confirmedLows.length&&(confirmedLows[loPtr].confirmedAt??Infinity)<=i)activeL=confirmedLows[loPtr++];
  // Structure events are confirmed from closed candles only. An open candle
  // must never print BOS/CHOCH or mutate protected structure state.
  if(c[i].closed===false)continue;
  const disp=displacementAt(c,i)>=.7;
  const brokeBull=!!activeH&&c[i].close>activeH.price;
  const brokeBear=!!activeL&&c[i].close<activeL.price;
  if(brokeBull&&brokeBear){
   // A malformed/ambiguous candle cannot establish two opposing structure
   // events at once; wait for the next closed candle.
   continue;
  }
  if(brokeBull){
   const type=classifyProtectedStructureBreak(
     structure,
     "high",
     protectedHigh?"high":protectedLow?"low":null,
     protectedHigh?.index??protectedLow?.index,
     activeH?.index
    );
   if(type){
    events.push({index:i,price:activeH!.price,type,direction:"bullish",strength:disp?"displacement":"normal"});
    structure="bullish";
    activeH=null;
    if(type==="BOS"){
     // Only a continuation BOS promotes the swing that produced the break
     // into protected structure. A CHoCH is a warning, not a confirmed new
     // trend, so it must not manufacture a protected swing prematurely.
     protectedLow=latestBefore(confirmedLows,i);
    }else{
     protectedLow=null;
    }
    protectedHigh=null;
   }
  }else if(brokeBear){
   const type=classifyProtectedStructureBreak(
     structure,
     "low",
     protectedHigh?"high":protectedLow?"low":null,
     protectedHigh?.index??protectedLow?.index,
     activeL?.index
    );
   if(type){
    events.push({index:i,price:activeL!.price,type,direction:"bearish",strength:disp?"displacement":"normal"});
    structure="bearish";
    activeL=null;
    if(type==="BOS"){
     protectedHigh=latestBefore(confirmedHighs,i);
    }else{
     protectedHigh=null;
    }
    protectedLow=null;
   }
  }
 }
 return events;
}

export function findFvgs(c:Candle[],a:number,asOf=c.length-1):FVG[]{
 const out:FVG[]=[];
 let closedEnd=Math.min(asOf,c.length-1);
 const firstUnclosed=c.slice(0,closedEnd+1).findIndex(x=>x.closed===false);
 if(firstUnclosed>=0)closedEnd=firstUnclosed-1;
 const end=closedEnd;
 for(let i=1;i<end;i++){
  const left=c[i-1],middle=c[i],right=c[i+1];
  // A 3-candle FVG is confirmed only when all three candles are closed.
  if(left.closed===false||middle.closed===false||right.closed===false)continue;
  const bull=left.high<right.low;
  const bear=left.low>right.high;
  if(!bull&&!bear)continue;
  const low=bull?left.high:right.high;
  const high=bull?right.low:left.low;
  if(!(high>low))continue;
  let fillIndex:number|undefined;
  let partialFillIndex:number|undefined;
  for(let j=i+2;j<=end;j++){
   if(c[j].closed===false)break;
   // Touching/entering the gap counts as partial fill; reaching the far
   // boundary counts as full fill.
   const entered=bull ? c[j].low<=high : c[j].high>=low;
   const fullyFilled=bull ? c[j].low<=low : c[j].high>=high;
   if(partialFillIndex===undefined&&entered)partialFillIndex=j;
   if(fullyFilled){fillIndex=j;break}
  }
  out.push({
   from:i-1,to:i+1,low,high,type:bull?"bullish":"bearish",
   filled:fillIndex!==undefined,fillIndex,
   partial:partialFillIndex!==undefined,
   partialFillIndex,
   size:(high-low)/Math.max(atrAt(c,i,14),0.0000001)
  });
 }
 return out;
}
function findOrderBlocks(c:Candle[],a:number,asOf=c.length-1,events:StructureEvent[]=[]):OB[]{
 const out:OB[]=[];
 const end=Math.min(asOf,c.length-1);
 for(let i=1;i<=end-1;i++){
  // Only closed, directional candles can be OB bases.
  if(c[i].closed===false)continue;
  const bullishBase=c[i].close<c[i].open;
  const bearishBase=c[i].close>c[i].open;
  if(!bullishBase&&!bearishBase)continue;
  let bullBreak=-1,bearBreak=-1,bullStrength=0,bearStrength=0;
  for(let k=1;k<=3&&i+k<=end;k++){
   const j=i+k;
   if(c[j].closed===false)continue;
   const d=displacementAt(c,j);
   if(bullishBase&&c[j].close>c[i].high&&d>=.55){bullBreak=j;bullStrength=d;break}
   if(bearishBase&&c[j].close<c[i].low&&d>=.55){bearBreak=j;bearStrength=d;break}
  }
  if(bullBreak>0){
   const linked=events.some(e=>e.direction==="bullish"&&isOrderBlockCausal(i,bullBreak,e.index,12));
   if(linked){
    let m:number|undefined,invalid:number|undefined;
    for(let j=bullBreak+1;j<=end;j++){
     if(c[j].closed===false)continue;
     if(m===undefined&&c[j].low<=c[i].open&&c[j].high>=c[i].low)m=j;
     if(c[j].close<c[i].low){invalid=j;break}
    }
    if(invalid===undefined||(m!==undefined&&m<invalid)){
     out.push({index:i,low:c[i].low,high:c[i].open,type:"bullish",mitigated:m!==undefined,mitigationIndex:m,strength:bullStrength});
    }
   }
  }
  if(bearBreak>0){
   const linked=events.some(e=>e.direction==="bearish"&&isOrderBlockCausal(i,bearBreak,e.index,12));
   if(linked){
    let m:number|undefined,invalid:number|undefined;
    for(let j=bearBreak+1;j<=end;j++){
     if(c[j].closed===false)continue;
     if(m===undefined&&c[j].high>=c[i].open&&c[j].low<=c[i].high)m=j;
     if(c[j].close>c[i].high){invalid=j;break}
    }
    if(invalid===undefined||(m!==undefined&&m<invalid)){
     out.push({index:i,low:c[i].open,high:c[i].high,type:"bearish",mitigated:m!==undefined,mitigationIndex:m,strength:bearStrength});
    }
   }
  }
 }
 return out;
}
export function makeBreakers(obs:OB[],c:Candle[],asOf=c.length-1):Breaker[]{
 const out:Breaker[]=[];
 let endIndex=Math.min(asOf,c.length-1);
 const firstUnclosed=c.slice(0,endIndex+1).findIndex(x=>x.closed===false);
 if(firstUnclosed>=0)endIndex=firstUnclosed-1;
 for(const o of obs){
  const mitigation=o.mitigationIndex;
  // A breaker can only form after a confirmed, closed-candle mitigation.
  if(!o.mitigated||mitigation===undefined||mitigation<=o.index||mitigation>endIndex)continue;
  let breakIndex:number|undefined;
  for(let j=mitigation+1;j<=endIndex;j++){
   if(c[j].closed===false)continue;
   // The original OB must be broken by a closed candle through its far
   // boundary; a wick alone is not enough to create a breaker.
   const broken=o.type==="bullish" ? c[j].close<o.low : c[j].close>o.high;
   if(broken){breakIndex=j;break}
  }
  if(breakIndex===undefined)continue;
  let invalidAfterBreak=false;
  for(let j=breakIndex+1;j<=endIndex;j++){
   if(c[j].closed===false)continue;
   // Once converted, a close back through the opposite OB boundary
   // invalidates the breaker. Keep the zone active until that happens.
   const invalid=o.type==="bullish" ? c[j].close>o.high : c[j].close<o.low;
   if(invalid){invalidAfterBreak=true;break}
  }
  if(!invalidAfterBreak){
   out.push({
    index:breakIndex,
    low:o.low,
    high:o.high,
    type:o.type==="bullish"?"bearish":"bullish",
    active:true
   });
  }
 }
 return out;
}
type ZoneCandidate={low:number;high:number;origin:number;kind:"OB"|"FVG"|"BREAKER";strength:number;linked:boolean;distance:number};
function chooseEntryZone(
 direction:"bullish"|"bearish"|null,
 obs:OB[],
 fvgs:FVG[],
 breakers:Breaker[],
 events:StructureEvent[],
 last:Candle,
 atrValue:number,
 asOf:number,
 sweepIndex:number|null
):ZoneCandidate|null{
 if(!direction||sweepIndex===null||sweepIndex<0)return null;
 const latestEvent=[...events].reverse().find(e=>e.direction===direction&&e.index<=asOf);
 if(!latestEvent)return null;
 const candidates:ZoneCandidate[]=[];
 for(const o of obs){
  if(o.type!==direction||o.mitigated)continue;
  const age=asOf-o.index;
  if(age<0||age>50)continue;
  if(!isEntryZoneCausal(o.index,sweepIndex,latestEvent.index,"OB",12))continue;
  const distance=last.close<o.low?o.low-last.close:last.close>o.high?last.close-o.high:0;
  if(distance>atrValue*3.5)continue;
  candidates.push({low:o.low,high:o.high,origin:o.index,kind:"OB",strength:o.strength??0,linked:true,distance});
 }
 for(const f of fvgs){
  if(f.type!==direction||f.filled)continue;
  const origin=f.to,age=asOf-origin;
  if(age<0||age>40)continue;
  if(!isEntryZoneCausal(origin,sweepIndex,latestEvent.index,"FVG",12))continue;
  const distance=last.close<f.low?f.low-last.close:last.close>f.high?last.close-f.high:0;
  if(distance>atrValue*3.5)continue;
  candidates.push({low:f.low,high:f.high,origin,kind:"FVG",strength:f.size??0,linked:true,distance});
 }
 for(const b of breakers){
  if(!b.active||b.type!==direction)continue;
  const age=asOf-b.index;
  if(age<0||age>40)continue;
  if(!isEntryZoneCausal(b.index,sweepIndex,latestEvent.index,"BREAKER",12))continue;
  const distance=last.close<b.low?b.low-last.close:last.close>b.high?last.close-b.high:0;
  if(distance>atrValue*3.5)continue;
  candidates.push({low:b.low,high:b.high,origin:b.index,kind:"BREAKER",strength:0.8,linked:true,distance});
 }
 if(!candidates.length)return null;
 candidates.sort((x,y)=>{
  const score=(z:ZoneCandidate)=>
   (z.kind==="OB"?20000:z.kind==="BREAKER"?18000:10000)
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
  if(direction==="bullish"&&mid>Math.max(entry,last.high)&&mid<=last.high+atrValue*8)levels.push(mid);
  if(direction==="bearish"&&mid<Math.min(entry,last.low)&&mid>=last.low-atrValue*8)levels.push(mid);
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
 // Core SMC indices are causal positions, so normalize the exchange feed before
 // any pivot/event calculation. Keep only valid OHLC candles, dedupe timestamps,
 // sort chronologically, and stop at the first open candle.
 const byTime=new Map<number,Candle>();
 for(const x of c){
  if(!Number.isFinite(x.time)||!Number.isFinite(x.open)||!Number.isFinite(x.high)||!Number.isFinite(x.low)||!Number.isFinite(x.close)||!Number.isFinite(x.volume))continue;
  if(x.volume<0||x.high<x.low||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))continue;
  byTime.set(x.time,x);
 }
 const normalized=[...byTime.values()].sort((a,b)=>a.time-b.time);
 // An open candle creates a causal boundary. Never consume later candles
 // from a feed that already contains a forming-bar gap.
 const firstUnclosed=normalized.findIndex(x=>x.closed===false);
 const closedEnd=firstUnclosed>=0?firstUnclosed-1:normalized.length-1;
 if(closedEnd<24)return empty;
 const data=normalized.slice(0,closedEnd+1);
 const a=atr(data),ps=labelPivots(pivots(data,3)),internal=labelPivots(pivots(data,1));
 const events=detectStructureEvents(data,ps);
 const internalEvents=detectStructureEvents(data,internal);
 const asOf=data.length-1;
 const fvgs=findFvgs(data,a,asOf),obs=findOrderBlocks(data,a,asOf,events),breakers=makeBreakers(obs,data,asOf),highs=ps.filter(p=>(p.confirmedAt??p.index)<=asOf&&p.type==="H"),lows=ps.filter(p=>(p.confirmedAt??p.index)<=asOf&&p.type==="L"),tol=Math.max(a*.15,.0000001);
 const equalHighs=equalLevels(highs,tol),equalLows=equalLevels(lows,tol);
 const liquidityHighs=uniquePivots([...equalHighs,...highs.slice(-6)],tol).slice(-8);
 const liquidityLows=uniquePivots([...equalLows,...lows.slice(-6)],tol).slice(-8);
 const sweeps:Sweep[]=[];
 for(const p of [...liquidityHighs,...liquidityLows]){
  if(asOf-p.index>40)continue;
  const sweepType=p.type==="H"?"high":"low";
  const latest=findLatestValidLiquiditySweep(data,p.price,sweepType,p.index+1,asOf);
  if(latest){
   latest.displacement=displacementAt(data,latest.index)>=.7;
   // Only displacement-confirmed sweeps are actionable liquidity events.
   // Keep the raw wick/close-back test in findLatestValidLiquiditySweep,
   // then apply displacement here as the confirmation layer.
   if(!latest.displacement)continue;
   // Avoid duplicate sweep events when equal-level clustering and recent
   // raw pivots resolve to effectively the same liquidity pool.
   const duplicate=sweeps.some(x=>x.type===latest!.type&&Math.abs(x.price-latest!.price)<=tol&&x.index===latest!.index);
   if(!duplicate)sweeps.push(latest);
  }
 }
 const r=dealingRange(ps,data,asOf);
 const mid=(r.hi+r.lo)/2;
 const last=data[asOf];
 const recentVolumes=data.slice(-21,-1);
 const volBase=recentVolumes.reduce((s,x)=>s+x.volume,0)/Math.max(1,recentVolumes.length);
 const volumeRatio=last.volume/Math.max(volBase,.0000001);
 const recentCandles=data.slice(Math.min(r.anchorIndex,asOf),asOf+1);
 const totalVolume=recentCandles.reduce((sum,x)=>sum+x.volume,0);
 const vwap=recentCandles.reduce((sum,x)=>sum+((x.high+x.low+x.close)/3)*x.volume,0)/Math.max(totalVolume,.0000001);
 const structureDirection=events.at(-1)?.direction??null;
 const trend=structureDirection==="bullish"?"Bullish":structureDirection==="bearish"?"Bearish":last.close>mid?"Bullish":last.close<mid?"Bearish":"Neutral";
 const pd=classifyPremiumDiscount(last.close,r.hi,r.lo);
 const rawDirection=structureDirection??(trend==="Bullish"?"bullish":trend==="Bearish"?"bearish":null);
 const sweep=rawDirection==="bullish"
  ?sweeps.slice().reverse().find(x=>x.type==="low"&&asOf-x.index<=20)
  :rawDirection==="bearish"
   ?sweeps.slice().reverse().find(x=>x.type==="high"&&asOf-x.index<=20)
   :undefined;
 const latestDirectionalEvent=rawDirection
  ?events.slice().reverse().find(x=>x.direction===rawDirection&&x.index<=asOf)
  :undefined;
 const causalSequence=!!rawDirection
  &&!!latestDirectionalEvent
  &&!!sweep
  &&latestDirectionalEvent.direction===rawDirection
  &&sweep.index<latestDirectionalEvent.index
  &&latestDirectionalEvent.index<=asOf
  &&latestDirectionalEvent.index-sweep.index<=12;
 const latestInternalDirectionalEvent=rawDirection
  ?internalEvents.slice().reverse().find(x=>x.direction===rawDirection&&x.index<=asOf)
  :undefined;
 const internalCausal=isSMCCausalSequence(
  sweep?.index??-1,
  latestDirectionalEvent?.index??-1,
  latestInternalDirectionalEvent?.index??null,
  12
) && !!latestInternalDirectionalEvent && latestInternalDirectionalEvent.direction===rawDirection;
 const selectedZone=chooseEntryZone(rawDirection,obs,fvgs,breakers,events,last,a,asOf,sweep?.index??null);
 const zoneCausal=!!selectedZone&&!!sweep&&!!latestDirectionalEvent
  &&isEntryZoneCausal(selectedZone.origin,sweep.index,latestDirectionalEvent.index,selectedZone.kind,12);
 const zone=selectedZone&&selectedZone.linked&&causalSequence&&zoneCausal
  ?{low:selectedZone.low,high:selectedZone.high,type:"entry" as const}:null;
 const direction=zone?rawDirection:null;
 const entry=zone?(zone.low+zone.high)/2:null;
 const zoneOrigin=selectedZone?.origin??asOf;
 const priorLow=zone?[...lows].reverse().find(p=>p.index<zoneOrigin):undefined;
 const priorHigh=zone?[...highs].reverse().find(p=>p.index<zoneOrigin):undefined;
 const structuralLow=zone?(priorLow&&zone.low-priorLow.price<=a*1.8?priorLow.price:zone.low):null;
 const structuralHigh=zone?(priorHigh&&priorHigh.price-zone.high<=a*1.8?priorHigh.price:zone.high):null;
 const stop=zone
  ?direction==="bullish"
   ?Math.min(structuralLow??zone.low,zone.low)-a*.15
   :direction==="bearish"
    ?Math.max(structuralHigh??zone.high,zone.high)+a*.15
    :null
  :null;
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
 if(direction&&latestDirectionalEvent?.direction===direction)confirmations.push("Swing structure aligned");
 if(direction&&causalSequence)confirmations.push("Liquidity sweep → structure break sequence aligned");
 if(direction&&internalCausal)confirmations.push("Internal structure aligned");
 if(sweep?.confirmed&&sweep.displacement)confirmations.push("Liquidity sweep + displacement");
 if(selectedZone?.kind==="OB")confirmations.push("Qualified unmitigated order block");
 if(selectedZone?.kind==="FVG")confirmations.push("Qualified unfilled fair value gap");
 if(selectedZone?.kind==="BREAKER")confirmations.push("Qualified active breaker");
 if(selectedZone?.linked&&zoneCausal)confirmations.push("Zone linked to current post-sweep structure leg");
 if((direction==="bullish"&&pd==="Discount")||(direction==="bearish"&&pd==="Premium"))confirmations.push("Premium/discount aligned");
 if(Math.abs(last.close-last.open)>=a*.5)confirmations.push("Displacement");
 const rawScore=35+confirmations.length*10+(events.at(-1)?.strength==="displacement"?10:0)+(equalHighs.length+equalLows.length>0?5:0);
 const score=zone&&direction?clamp(rawScore):0;
 const rr=entry!==null&&stop!==null&&targets[0]!==undefined?Math.abs(targets[0]-entry)/Math.abs(entry-stop):null;
 const geometryValid=direction!==null&&entry!==null&&stop!==null&&targets.length>0
  &&isValidTradeGeometry(direction as "BUY"|"SELL",entry,stop,targets,MIN_SETUP_RR);
 const usable=geometryValid&&risk>0&&rr!==null&&rr>=MIN_SETUP_RR;
 const hasSwing=confirmations.includes("Swing structure aligned");
 const hasConfirmedBOS=latestDirectionalEvent?.type==="BOS"&&latestDirectionalEvent.direction===rawDirection;
 const hasInternal=confirmations.includes("Internal structure aligned"); const hasSweep=confirmations.includes("Liquidity sweep + displacement");
 const hasPD=confirmations.includes("Premium/discount aligned");
 const hasQualifiedZone=confirmations.includes("Qualified unmitigated order block")||confirmations.includes("Qualified unfilled fair value gap")||confirmations.includes("Qualified active breaker"); // "ACTIVE" is now a genuine multi-confirmation gate rather than merely
 // "entry zone + RR". A scanner row can remain WATCH/SETUP without this gate.
 const confirmedGate=last.closed!==false
  &&rawDirection!==null
  &&hasSwing
  &&hasConfirmedBOS
  &&hasInternal
  &&hasSweep
  &&hasPD
  &&hasQualifiedZone
  &&causalSequence
  &&internalCausal
  &&selectedZone?.linked===true
  &&zoneCausal;
 const plannedDirection=direction==="bullish"?"BUY":direction==="bearish"?"SELL":"WAIT";
 const status:Setup["status"]=usable&&confirmedGate&&isSetupActive(zone,last)?"ACTIVE":"WAIT";
 const setup:Setup={direction:usable?plannedDirection:"WAIT",status,entry:usable?entry:null,stop:usable?stop:null,targets:usable?targets:[],rr:usable?rr:null,confidence:usable&&confirmedGate?score:0,confirmations:usable?confirmations:[]};
 return{trend,asOf,pivots:ps.slice(-18),internalPivots:internal.slice(-24),events:events.slice(-12),fvgs:fvgs.slice(-14),orderBlocks:obs.slice(-10),breakers:breakers.slice(-8),liquidityHighs:liquidityHighs.slice(-8),liquidityLows:liquidityLows.slice(-8),equalHighs:equalHighs.slice(-8),equalLows:equalLows.slice(-8),sweeps:sweeps.slice(-10),premiumDiscount:pd,premiumDiscountRange:{high:r.hi,low:r.lo,mid},vwap,volumeRatio,displacement:displacementAt(data,asOf),entryZone:zone,stop,targets,score,setup};
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
  ["61.8%",p5+(p0-p5)*.618],["78.6%",p5+(p0-p5)*.786],["100%",p0],  ["127.2%",p5+dir*range*.272],["161.8%",p5+dir*range*.618],["261.8%",p5+dir*range*1.618]
 ].map(([label,price])=>({label:String(label),price:Number(price)}));
}

export type ImpulseValidation={
 w2Valid:boolean;w3BeyondW1:boolean;w3NotShortest:boolean;w4Valid:boolean;
 w5DirectionValid:boolean;w5BeyondW3:boolean;truncated:boolean;valid:boolean;
};
export function validateImpulseWave(prices:number[],bull:boolean):ImpulseValidation{
 if(prices.length<6)return{w2Valid:false,w3BeyondW1:false,w3NotShortest:false,w4Valid:false,w5DirectionValid:false,w5BeyondW3:false,truncated:false,valid:false};
 const [p0,p1,p2,p3,p4,p5]=prices;
 const w1=Math.abs(p1-p0),w2=Math.abs(p2-p1),w3=Math.abs(p3-p2),w4=Math.abs(p4-p3),w5=Math.abs(p5-p4);
 const positiveLengths=w1>0&&w2>0&&w3>0&&w4>0&&w5>0;
 const w2Valid=bull?p2>p0&&p2<p1:p2<p0&&p2>p1;
 const w3BeyondW1=bull?p3>p1:p3<p1;
 const w3NotShortest=w3>=Math.min(w1,w5);
 const w4Valid=bull?p4>p1&&p4<p3:p4<p1&&p4>p3;
 const w5DirectionValid=bull?p5>p4:p5<p4;
 const w5BeyondW3=bull?p5>p3:p5<p3;
 const truncated=w5DirectionValid&&!w5BeyondW3;
 return{w2Valid,w3BeyondW1,w3NotShortest,w4Valid,w5DirectionValid,w5BeyondW3,truncated,valid:positiveLengths&&w2Valid&&w3BeyondW1&&w3NotShortest&&w4Valid&&w5DirectionValid};
}

export type DiagonalValidation={
 w2Valid:boolean;w3BeyondW1:boolean;w3NotShortest:boolean;w4OverlapsW1:boolean;w4DoesNotPassW2:boolean;
 w5DirectionValid:boolean;w5BeyondW3:boolean;contracting:boolean;expanding:boolean;valid:boolean;
};
export function validateDiagonalWave(prices:number[],bull:boolean):DiagonalValidation{
 if(prices.length<6)return{w2Valid:false,w3BeyondW1:false,w3NotShortest:false,w4OverlapsW1:false,w4DoesNotPassW2:false,w5DirectionValid:false,w5BeyondW3:false,contracting:false,expanding:false,valid:false};
 const [p0,p1,p2,p3,p4,p5]=prices;
 const w1=Math.abs(p1-p0),w2=Math.abs(p2-p1),w3=Math.abs(p3-p2),w4=Math.abs(p4-p3),w5=Math.abs(p5-p4);
 const positiveLengths=w1>0&&w2>0&&w3>0&&w4>0&&w5>0;
 const w2Valid=bull?p2>p0&&p2<p1:p2<p0&&p2>p1;
 const w3BeyondW1=bull?p3>p1:p3<p1;
 const w3NotShortest=w3>=Math.min(w1,w5);
 const w4OverlapsW1=bull?p4<=p1&&p4>p0:p4>=p1&&p4<p0;
 // Retain this as diagnostic information, but do not use it as a hard
 // validity gate. Valid diagonals can have deeper Wave-4 retracements.
 const w4DoesNotPassW2=bull?p4>p2:p4<p2;
 const w5DirectionValid=bull?p5>p4:p5<p4;
 const w5BeyondW3=bull?p5>p3:p5<p3;
 const contracting=w3<w1&&w4<w2&&w5<w3;
 const expanding=w3>w1&&w4>w2&&w5>w3;
 return{w2Valid,w3BeyondW1,w3NotShortest,w4OverlapsW1,w4DoesNotPassW2,w5DirectionValid,w5BeyondW3,contracting,expanding,valid:positiveLengths&&w2Valid&&w3BeyondW1&&w3NotShortest&&w4OverlapsW1&&w5DirectionValid};
}

export function analyzeElliott(c:Candle[]):AdvancedElliottResult{
 return analyzeElliottAdvanced(c);
}
export function analyzeMTF(frames:{interval:string;candles:Candle[]}[]):MTFResult{
 const rows:MTFFrame[]=frames.map(f=>{
  const byTime=new Map<number,Candle>();
  for(const x of f.candles){
   if(!Number.isFinite(x.time)||!Number.isFinite(x.open)||!Number.isFinite(x.high)||!Number.isFinite(x.low)||!Number.isFinite(x.close)||!Number.isFinite(x.volume))continue;
   if(x.volume<0||x.high<x.low||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))continue;
   byTime.set(x.time,x);
  }
  const normalized=[...byTime.values()].sort((a,b)=>a.time-b.time);
  const firstUnclosed=normalized.findIndex(x=>x.closed===false);
  const closed=firstUnclosed>=0?normalized.slice(0,firstUnclosed):normalized;
  const available=closed.length>=25;
  if(!available)return{interval:f.interval,trend:"Neutral" as const,score:0,structure:"UNAVAILABLE",available:false,elliottTrend:"Neutral" as const,elliottScore:0,elliottPhase:"UNAVAILABLE"};
  const smc=analyzeSMC(closed),ew=analyzeElliott(closed);
  // An Elliott count that has already crossed its Wave-1 origin is historical
  // evidence of invalidation, not current directional bias.
  const elliottUsable=ew.setupState!=="INVALIDATED"&&!!ew.primary;
  const elliottTrend=elliottUsable&&ew.primary?.direction==="bullish"?"Bullish"
    :elliottUsable&&ew.primary?.direction==="bearish"?"Bearish":"Neutral";
  const smcSigned=smc.trend==="Bullish"?smc.score:smc.trend==="Bearish"?-smc.score:0;
  const ewSigned=elliottTrend==="Bullish"?ew.score:elliottTrend==="Bearish"?-ew.score:0;
  const signed=(smcSigned+ewSigned)/2;
  const trend:MTFFrame["trend"]=signed>12?"Bullish":signed<-12?"Bearish":"Neutral";
  return{interval:f.interval,trend,score:clamp(50+signed/2),structure:smc.events.at(-1)?.type??"No event",available:true,elliottTrend,elliottScore:elliottUsable?ew.score:0,elliottPhase:ew.phase};
 });
 const usable=rows.filter(r=>r.available);
 const weight=(r:MTFFrame)=>mtfFrameWeight(r.interval);
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