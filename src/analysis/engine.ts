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
 let closedEnd=c.length-1;
 while(closedEnd>=0&&c[closedEnd].closed===false)closedEnd--;
 if(closedEnd<24)return empty;
 const data=c.slice(0,closedEnd+1);
 const a=atr(data),ps=labelPivots(pivots(data,3)),internal=labelPivots(pivots(data,1));
 const events=detectStructureEvents(data,ps);
 const internalEvents=detectStructureEvents(data,internal);
 const asOf=data.length-1;
 const fvgs=findFvgs(data,a,asOf),obs=findOrderBlocks(data,a,asOf,events),breakers=makeBreakers(obs,data,asOf),highs=ps.filter(p=>(p.confirmedAt??p.index)<=asOf&&p.type==="H"),lows=ps.filter(p=>(p.confirmedAt??p.index)<=asOf&&p.type==="L"),tol=Math.max(a*.18,.0000001);
 const equalHighs=equalLevels(highs,tol),equalLows=equalLevels(lows,tol);
 const liquidityHighs=uniquePivots([...equalHighs,...highs.slice(-6)],tol).slice(-8);
 const liquidityLows=uniquePivots([...equalLows,...lows.slice(-6)],tol).slice(-8);
 const sweeps:Sweep[]=[];
 for(const p of [...liquidityHighs,...liquidityLows]){
  if(asOf-p.index>40)continue;
  const sweepType=p.type==="H"?"high":"low";