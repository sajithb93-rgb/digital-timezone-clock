export type CandleLike={
 time:number;
 open:number;
 high:number;
 low:number;
 close:number;
 volume:number;
 takerBuyVolume?:number;
 closed?:boolean;
};

export function normalizeCandleSeries<T extends CandleLike>(candles:T[],stopAtOpen=true):T[]{
 const byTime=new Map<number,T>();
 // Conflicting open snapshots may be superseded by a later closed snapshot.
 // Conflicting closed snapshots remain ambiguous because OHLC alone cannot
 // determine which closed value is newer.
 const ambiguousClosed=new Set<number>();
 const ambiguousOpen=new Set<number>();
 for(const x of candles){
  if(!Number.isFinite(x.time)||!Number.isFinite(x.open)||!Number.isFinite(x.high)||!Number.isFinite(x.low)||!Number.isFinite(x.close)||!Number.isFinite(x.volume))continue;
  if(x.time<0||x.open<=0||x.high<=0||x.low<=0||x.close<=0||x.volume<0||x.high<x.low||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))continue;
  const prev=byTime.get(x.time);
  if(!prev){
   if(ambiguousClosed.has(x.time))continue;
   if(x.closed===false&&ambiguousOpen.has(x.time))continue;
   byTime.set(x.time,x);continue;
  }
  const prevClosed=prev.closed!==false,nextClosed=x.closed!==false;
  if(prevClosed!==nextClosed){
   if(nextClosed){
    byTime.set(x.time,x);
    ambiguousOpen.delete(x.time);
   }
   continue;
  }
  const samePriceVolume=prev.open===x.open&&prev.high===x.high&&prev.low===x.low&&prev.close===x.close&&prev.volume===x.volume;
  if(samePriceVolume){
   const prevTaker=prev.takerBuyVolume;
   const nextTaker=x.takerBuyVolume;
   if(prevTaker===undefined&&nextTaker!==undefined){byTime.set(x.time,x);continue;}
   if(prevTaker!==undefined&&nextTaker===undefined)continue;
   if(prevTaker===nextTaker)continue;
  }
  byTime.delete(x.time);
  if(prevClosed)ambiguousClosed.add(x.time);
  else ambiguousOpen.add(x.time);
 }
 const ordered=[...byTime.values()].sort((a,b)=>a.time-b.time);
 if(!stopAtOpen)return ordered;
 const firstUnclosed=ordered.findIndex(x=>x.closed===false);
 return firstUnclosed>=0?ordered.slice(0,firstUnclosed):ordered;
}