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
 const ambiguous=new Set<number>();
 for(const x of candles){
  if(!Number.isFinite(x.time)||!Number.isFinite(x.open)||!Number.isFinite(x.high)||!Number.isFinite(x.low)||!Number.isFinite(x.close)||!Number.isFinite(x.volume))continue;
  if(x.time<=0||x.volume<0||x.high<x.low||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))continue;
  if(ambiguous.has(x.time))continue;
  const prev=byTime.get(x.time);
  if(!prev){byTime.set(x.time,x);continue;}
  const prevClosed=prev.closed!==false,nextClosed=x.closed!==false;
  if(prevClosed!==nextClosed){
   if(nextClosed)byTime.set(x.time,x);
   continue;
  }
  const sameCore=prev.open===x.open&&prev.high===x.high&&prev.low===x.low&&prev.close===x.close&&prev.volume===x.volume
    &&(prev.takerBuyVolume??null)===(x.takerBuyVolume??null);
  if(!sameCore){
   byTime.delete(x.time);
   ambiguous.add(x.time);
  }
 }
 const ordered=[...byTime.values()].sort((a,b)=>a.time-b.time);
 if(!stopAtOpen)return ordered;
 const firstUnclosed=ordered.findIndex(x=>x.closed===false);
 return firstUnclosed>=0?ordered.slice(0,firstUnclosed):ordered;
}
