// SMC/ELLIOTT ENGINE
export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number;takerBuyVolume?:number;closed?:boolean};
export type Pivot={index:number;price:number;type:"H"|"L";label?:string;strength?:number;confirmedAt?:number};
export type FVG={from:number;to:number;low:number;high:number;type:"bullish"|"bearish";filled:boolean;fillIndex?:number;size?:number};
export type OB={index:number;low:number;high:number;type:"bullish"|"bearish";mitigated:boolean;mitigationIndex?:number;strength?:number};
export type Breaker={index:number;low:number;high:number;type:"bullish"|"bearish";active:boolean};
export type StructureEvent={index:number;price:number;type:"BOS"|"CHOCH";direction:"bullish"|"bearish";strength:"normal"|"displacement"};
export type Sweep={index:number;price:number;type:"high"|"low";confirmed:boolean;displacement?:boolean};
export type Zone={low:number;high:number;type:"entry"|"stop"|"target"};
export type Setup={direction:"BUY"|"SELL"|"WAIT";entry:number|null;stop:number|null;targets:number[];rr:number|null;confidence:number;confirmations:string[]};
export type SMCResult={
 trend:"Bullish"|"Bearish"|"Neutral"; asOf:number; pivots:Pivot[]; internalPivots:Pivot[]; events:StructureEvent[];
 fvgs:FVG[]; orderBlocks:OB[]; breakers:Breaker[]; liquidityHighs:Pivot[]; liquidityLows:Pivot[]; equalHighs:Pivot[]; equalLows:Pivot[];
 sweeps:Sweep[]; premiumDiscount:"Premium"|"Discount"|"Equilibrium"; premiumDiscountRange:{high:number;low:number;mid:number};
 vwap:number; volumeRatio:number; displacement:number; entryZone:Zone|null; stop:number|null; targets:number[]; score:number; setup:Setup;
};
export type WavePoint={index:number;price:number;label:string};
export type WaveCount={points:WavePoint[];kind:"Impulse"|"Correction";direction:"bullish"|"bearish";invalidation:number;targets:number[];quality:number;rules:string[]};
export type ElliottResult={
 primary:WaveCount|null;alternative:WaveCount|null;correction:WaveCount|null;
 fib:{w2:number;w3:number;w4:number;w5:number}|null;
 fibLevels:{label:string;price:number}[]; channel:{a:number;b:number}|null;
 phase:string;score:number;confidence:number;
};
export type MTFFrame={interval:string;trend:"Bullish"|"Bearish"|"Neutral";score:number;structure:string;available:boolean};
export type MTFResult={trend:"Bullish"|"Bearish"|"Neutral";score:number;frames:MTFFrame[]};

function trueRange(c:Candle[],i:number){if(i===0)return c[i].high-c[i].low;return Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}
function atr(c:Candle[],n=14){return atrAt(c,c.length-1,n)}
function atrAt(c:Candle[],end:number,n=14){if(!c.length||end<0)return 0;const e=Math.min(end,c.length-1),start=Math.max(0,e-n+1);return c.slice(start,e+1).reduce((v,_,i)=>v+trueRange(c,start+i),0)/Math.max(1,e-start+1)}
function pivots(c:Candle[],w=3):Pivot[]{
 const out:Pivot[]=[];
 const width=Math.max(1,Math.floor(w));
 if(c.length<width*2+3)return out;
 for(let i=width;i<c.length-width;i++){
  let hi=true,lo=true,score=0;
  for(let j=i-width;j<=i+width;j++){
   if(j===i)continue;
   if(c[j].high>=c[i].high)hi=false;
   if(c[j].low<=c[i].low)lo=false;
  }
  for(let j=Math.max(0,i-width);j<=Math.min(c.length-1,i+width);j++)score+=Math.abs(c[j].high-c[j].low);
  if(hi)out.push({index:i,price:c[i].high,type:"H",strength:score/(2*width+1),confirmedAt:i+width});
  if(lo)out.push({index:i,price:c[i].low,type:"L",strength:score/(2*width+1),confirmedAt:i+width});
 }
 return out.sort((a,b)=>a.index-b.index||a.type.localeCompare(b.type));
}
function clamp(n:number){return Math.max(0,Math.min(100,Math.round(n)))}
function range(c:Candle[]){const q=c.slice(-60);return{hi:Math.max(...q.map(x=>x.high)),lo:Math.min(...q.map(x=>x.low))}}
function body(c:Candle){return Math.abs(c.close-c.open)}
function displacementAt(c:Candle[],i:number,a:number){return a>0?body(c[i])/a:0}
function labelPivots(ps:Pivot[]){const out:Pivot[]=[];let lastH:number|undefined,lastL:number|undefined;for(const p of ps){const q={...p};if(p.type==="H"){q.label=lastH===undefined?"SH":p.price>lastH?"HH":"LH";lastH=p.price}else{q.label=lastL===undefined?"SL":p.price>lastL?"HL":"LL";lastL=p.price}out.push(q)}return out}

function findFvgs(c:Candle[],a:number):FVG[]{
 const out:FVG[]=[];
 for(let i=1;i<c.length-1;i++){
  if(c[i-1].high<c[i+1].low){const low=c[i-1].high,high=c[i+1].low;let fillIndex:number|undefined;for(let j=i+1;j<c.length;j++)if(c[j].low<=low){fillIndex=j;break}out.push({from:i-1,to:i+1,low,high,type:"bullish",filled:fillIndex!==undefined,fillIndex,size:(high-low)/Math.max(atrAt(c,i,14),.0000001)})}
  if(c[i-1].low>c[i+1].high){const low=c[i+1].high,high=c[i-1].low;let fillIndex:number|undefined;for(let j=i+1;j<c.length;j++)if(c[j].high>=high){fillIndex=j;break}out.push({from:i-1,to:i+1,low,high,type:"bearish",filled:fillIndex!==undefined,fillIndex,size:(high-low)/Math.max(atrAt(c,i,14),1e-12)})}
 }
 return out;
}
function findOrderBlocks(c:Candle[],a:number,events:StructureEvent[]):OB[]{
 const out:OB[]=[];
 const seen=new Set<string>();
 for(const event of events){
  const i=event.index;
  if(i<1||i>=c.length)continue;
  const eventAtr=atrAt(c,i);
  const displacement=displacementAt(c,i,eventAtr);
  if(displacement<.55)continue;
  const baseType=event.direction==="bullish"?"bearish":"bullish";

  for(let k=1;k<=5;k++){
   const bi=i-k;
   if(bi<0)break;
   const base=c[bi];
   const isBase=baseType==="bearish"?base.close<base.open:base.close>base.open;
   if(!isBase)continue;

   const broken=event.direction==="bullish"?c[i].close>base.high:c[i].close<base.low;
   if(!broken)continue;

   const type=event.direction;
   const low=type==="bullish"?base.low:base.open;
   const high=type==="bullish"?base.open:base.high;
   if(high<=low)continue;

   const key=bi+"|"+type;
   if(seen.has(key))break;
   seen.add(key);

   let mitigationIndex:number|undefined;
   let invalidated=false;
   for(let j=i+1;j<c.length;j++){
    if(mitigationIndex===undefined&&(
      type==="bullish"?c[j].low<=high:c[j].high>=low
    ))mitigationIndex=j;
    if(type==="bullish"?c[j].close<low:c[j].close>high){
     invalidated=true;
     break;
    }
   }

   out.push({
    index:bi,
    low,
    high,
    type,
    mitigated:mitigationIndex!==undefined||invalidated,
    mitigationIndex,
    strength:displacement
   });
   break;
  }
 }
 return out.sort((a,b)=>a.index-b.index);
}
function makeBreakers(obs:OB[],c:Candle[]):Breaker[]{
 return obs.flatMap((o):Breaker[]=>{
  if(!o.mitigated||o.mitigationIndex===undefined)return [];
  let invalidationIndex=-1;
  for(let j=o.mitigationIndex+1;j<c.length;j++){
   const invalidated=o.type==="bullish"?c[j].close<o.low:c[j].close>o.high;
   if(invalidated){invalidationIndex=j;break;}
  }
  if(invalidationIndex<0)return [];
  const type=o.type==="bullish"?"bearish":"bullish";
  let active=true;
  for(let j=invalidationIndex+1;j<c.length;j++){
   const reversed=type==="bullish"?c[j].close<o.low:c[j].close>o.high;
   if(reversed){active=false;break;}
  }
  return[{index:invalidationIndex,low:o.low,high:o.high,type,active}];
 }).sort((a,b)=>a.index-b.index);
}
function equalLevels(ps:Pivot[],tol:number){
 const out:Pivot[]=[];
 for(let i=0;i<ps.length;i++){
  const match=ps.slice(0,i).find(x=>Math.abs(x.price-ps[i].price)<=tol);
  if(!match)continue;
  if(!out.some(x=>x.index===match.index&&x.type===match.type))out.push(match);
  if(!out.some(x=>x.index===ps[i].index&&x.type===ps[i].type))out.push(ps[i]);
 }
 return out.sort((a,b)=>a.index-b.index);
}
function zoneUsable(zone:Zone,last:Candle,atrValue:number,direction:"bullish"|"bearish"){
 const maxDistance=Math.max(atrValue*2,Math.abs(last.close)*.002);
 if(direction==="bullish"){
  if(last.close<zone.low)return false;
  return last.close<=zone.high || last.close-zone.high<=maxDistance;
 }
 if(last.close>zone.high)return false;
 return last.close>=zone.low || zone.low-last.close<=maxDistance;
}
function zoneTrigger(c:Candle[],zone:Zone,direction:"bullish"|"bearish",minIndex=0){
 const start=Math.max(minIndex,c.length-4);
 for(let i=start;i<c.length;i++){
  const x=c[i],a=atrAt(c,i);
  const touched=x.high>=zone.low&&x.low<=zone.high;
  const reaction=direction==="bullish"?x.close>x.open:x.close<x.open;
  const displacement=body(x)/Math.max(a,1e-12)>=.35;
  if(touched&&reaction&&displacement)return i;
 }
 return -1;
}

export function analyzeSMC(c:Candle[]):SMCResult{
 const empty:SMCResult={
  trend:"Neutral",asOf:-1,pivots:[],internalPivots:[],events:[],fvgs:[],orderBlocks:[],breakers:[],
  liquidityHighs:[],liquidityLows:[],equalHighs:[],equalLows:[],sweeps:[],
  premiumDiscount:"Equilibrium",premiumDiscountRange:{high:0,low:0,mid:0},
  vwap:0,volumeRatio:0,displacement:0,entryZone:null,stop:null,targets:[],score:0,
  setup:{direction:"WAIT",entry:null,stop:null,targets:[],rr:null,confidence:0,confirmations:[]}
 };
 const data=c.at(-1)?.closed===false?c.slice(0,-1):c;
 if(data.length<25)return empty;

 const a=atr(data),ps=labelPivots(pivots(data,3)),internal=labelPivots(pivots(data,1));
 const events:StructureEvent[]=[];
 let structure:"bullish"|"bearish"|null=null;
 let activeH:Pivot|null=null,activeL:Pivot|null=null;
 let hiPtr=0,loPtr=0;
 const confirmedHighs=ps.filter(p=>p.type==="H");
 const confirmedLows=ps.filter(p=>p.type==="L");

 for(let i=0;i<data.length;i++){
  while(hiPtr<confirmedHighs.length&&(confirmedHighs[hiPtr].confirmedAt??Infinity)<=i)activeH=confirmedHighs[hiPtr++];
  while(loPtr<confirmedLows.length&&(confirmedLows[loPtr].confirmedAt??Infinity)<=i)activeL=confirmedLows[loPtr++];

  const bullBreak=!!activeH&&data[i].close>activeH.price;
  const bearBreak=!!activeL&&data[i].close<activeL.price;
  const displacement=displacementAt(data,i,atrAt(data,i))>=.7;

  if(bullBreak){
   events.push({
    index:i,price:activeH!.price,
    type:structure==="bearish"?"CHOCH":"BOS",
    direction:"bullish",
    strength:displacement?"displacement":"normal"
   });
   structure="bullish";
   activeH=null;
  }else if(bearBreak){
   events.push({
    index:i,price:activeL!.price,
    type:structure==="bullish"?"CHOCH":"BOS",
    direction:"bearish",
    strength:displacement?"displacement":"normal"
   });
   structure="bearish";
   activeL=null;
  }
 }

 const fvgs=findFvgs(data,a);
 const obs=findOrderBlocks(data,a,events);
 const breakers=makeBreakers(obs,data);
 const highs=ps.filter(p=>p.type==="H");
 const lows=ps.filter(p=>p.type==="L");
 const tol=Math.max(a*.15,1e-12);
 const equalHighs=equalLevels(highs,tol);
 const equalLows=equalLevels(lows,tol);
 const liquidityHighs=(equalHighs.length?equalHighs:highs.slice(-6)).slice(-8);
 const liquidityLows=(equalLows.length?equalLows:lows.slice(-6)).slice(-8);

 const sweeps:Sweep[]=[];
 const sweepStart=Math.max(0,data.length-80);
 for(const p of [...liquidityHighs,...liquidityLows]){
  const start=Math.max((p.confirmedAt??p.index)+1,sweepStart);
  for(let j=start;j<data.length;j++){
   const x=data[j];
   const swept=p.type==="H"
    ?x.high>p.price&&x.close<p.price
    :x.low<p.price&&x.close>p.price;
   if(!swept)continue;
   sweeps.push({
    index:j,
    price:p.price,
    type:p.type==="H"?"high":"low",
    confirmed:true,
    displacement:displacementAt(data,j,atrAt(data,j))>=.7
   });
   break;
  }
 }
 sweeps.sort((x,y)=>x.index-y.index);

 const r=range(data),mid=(r.hi+r.lo)/2,last=data.at(-1)!;
 const recentVolumes=data.slice(-21,-1);
 const volBase=recentVolumes.reduce((s,x)=>s+x.volume,0)/Math.max(1,recentVolumes.length);
 const volumeRatio=last.volume/Math.max(volBase,1e-12);
 const recentCandles=data.slice(-60);
 const totalVolume=recentCandles.reduce((s,x)=>s+x.volume,0);
 const vwap=recentCandles.reduce((s,x)=>s+((x.high+x.low+x.close)/3)*x.volume,0)/Math.max(totalVolume,1e-12);

 const latestEvent=events.at(-1);
 const eventAge=latestEvent?data.length-1-latestEvent.index:Infinity;
 const recentStructure=latestEvent&&eventAge<=30?latestEvent:undefined;
 const structureDirection=recentStructure?.direction??null;
 const latestSwingHigh=highs.at(-1),latestSwingLow=lows.at(-1);
 let trend:SMCResult["trend"];
 if(structureDirection==="bullish")trend="Bullish";
 else if(structureDirection==="bearish")trend="Bearish";
 else if(latestSwingHigh&&latestSwingLow){
  const hh=latestSwingHigh.label==="HH",hl=latestSwingLow.label==="HL";
  const lh=latestSwingHigh.label==="LH",ll=latestSwingLow.label==="LL";
  trend=hh&&hl?"Bullish":lh&&ll?"Bearish":last.close>mid?"Bullish":last.close<mid?"Bearish":"Neutral";
 }else trend=last.close>mid?"Bullish":last.close<mid?"Bearish":"Neutral";

 const pd=last.close>mid?"Premium":last.close<mid?"Discount":"Equilibrium";
 const rawDirection=structureDirection??(trend==="Bullish"?"bullish":trend==="Bearish"?"bearish":null);

 let zone:Zone|null=null;
 let zoneAnchor=-1;
 if(rawDirection){
  const candidates:[Zone,number][]=[
   ...obs.filter(x=>x.type===rawDirection&&!x.mitigated).reverse().map(x=>[{low:x.low,high:x.high,type:"entry" as const},x.index] as [Zone,number]),
   ...fvgs.filter(x=>x.type===rawDirection&&!x.filled).reverse().map(x=>[{low:x.low,high:x.high,type:"entry" as const},x.to] as [Zone,number])
  ];
  const selected=candidates.find(([z])=>zoneUsable(z,last,a,rawDirection));
  if(selected){zone=selected[0];zoneAnchor=selected[1];}
 }

 const triggerIndex=zone&&rawDirection?zoneTrigger(data,zone,rawDirection,zoneAnchor+1):-1;
 const recentStructureAligned=!!recentStructure&&recentStructure.direction===rawDirection&&recentStructure.index<triggerIndex;
 const recentSweepAligned=rawDirection==="bullish"
  ?sweeps.some(s=>s.type==="low"&&s.displacement&&s.index>=Math.max(zoneAnchor+1,data.length-10)&&s.index<=triggerIndex)
  :rawDirection==="bearish"
   ?sweeps.some(s=>s.type==="high"&&s.displacement&&s.index>=Math.max(zoneAnchor+1,data.length-10)&&s.index<=triggerIndex)
   :false;
 const setupFresh=triggerIndex>=Math.max(0,data.length-3)&&zone!==null&&zoneUsable(zone,last,a,rawDirection!);
 const qualifiedTrigger=recentStructureAligned||recentSweepAligned;
 const direction=zone&&triggerIndex>=0&&setupFresh&&qualifiedTrigger?rawDirection:null;

 const priorLow=zone&&direction==="bullish"
  ?[...lows].reverse().find(p=>p.index<triggerIndex&&p.price<zone.low)
  :undefined;
 const priorHigh=zone&&direction==="bearish"
  ?[...highs].reverse().find(p=>p.index<triggerIndex&&p.price>zone.high)
  :undefined;

 const structuralLow=zone&&direction==="bullish"
  ?(priorLow&&zone.low-priorLow.price<=a*1.5?priorLow.price:zone.low)
  :null;
 const structuralHigh=zone&&direction==="bearish"
  ?(priorHigh&&priorHigh.price-zone.high<=a*1.5?priorHigh.price:zone.high)
  :null;

 const entry=zone?(zone.low+zone.high)/2:null;
 const stop=direction==="bullish"&&structuralLow!==null
  ?structuralLow-a*.15
  :direction==="bearish"&&structuralHigh!==null
   ?structuralHigh+a*.15
   :direction==="bullish"&&zone
    ?zone.low-a*.15
    :direction==="bearish"&&zone
     ?zone.high+a*.15
     :null;

 const risk=entry!==null&&stop!==null?Math.abs(entry-stop):0;
 const structuralTargets=direction==="bullish"
  ?[...liquidityHighs,...highs].map(p=>p.price).filter(p=>entry!==null&&p>entry&&p>last.close).sort((x,y)=>x-y)
  :direction==="bearish"
   ?[...liquidityLows,...lows].map(p=>p.price).filter(p=>entry!==null&&p<entry&&p<last.close).sort((x,y)=>y-x)
   :[];
 const uniqueTargets=structuralTargets.filter((p,i,arr)=>i===0||Math.abs(p-arr[i-1])>Math.max(Math.abs(p)*.0005,1e-12));
 const targets=entry!==null&&risk>0?uniqueTargets.slice(0,4):[];

 const confirmations:string[]=[];
 if(direction&&latestEvent?.direction===direction)confirmations.push("Confirmed structure alignment");

 const sweep=direction==="bullish"
  ?sweeps.slice().reverse().find(s=>s.type==="low"&&s.index>=Math.max(0,data.length-20)&&(triggerIndex<0||s.index<=triggerIndex))
  :direction==="bearish"
   ?sweeps.slice().reverse().find(s=>s.type==="high"&&s.index>=Math.max(0,data.length-20)&&(triggerIndex<0||s.index<=triggerIndex))
   :undefined;
 if(sweep?.confirmed&&sweep.displacement)confirmations.push("Liquidity sweep + displacement");
 if(direction&&zone?.type==="entry"&&obs.some(x=>x.type===direction&&!x.mitigated&&x.low===zone.low&&x.high===zone.high))confirmations.push("Selected unmitigated order block");
 if(direction&&zone?.type==="entry"&&fvgs.some(x=>x.type===direction&&!x.filled&&x.low===zone.low&&x.high===zone.high))confirmations.push("Selected unfilled fair value gap");
 if((direction==="bullish"&&pd==="Discount")||(direction==="bearish"&&pd==="Premium"))confirmations.push("Premium/discount aligned");
 if(triggerIndex>=0&&displacementAt(data,triggerIndex,atrAt(data,triggerIndex))>=.5)confirmations.push("Closed-candle displacement trigger");

 const rawScore=direction
  ?25
   +(latestEvent?.direction===direction?20:0)
   +(sweep?.confirmed?15:0)
   +(zone&&obs.some(x=>x.type===direction&&!x.mitigated&&x.low===zone.low&&x.high===zone.high)?15:0)
   +(zone&&fvgs.some(x=>x.type===direction&&!x.filled&&x.low===zone.low&&x.high===zone.high)?10:0)
   +(((direction==="bullish"&&pd==="Discount")||(direction==="bearish"&&pd==="Premium"))?10:0)
   +(volumeRatio>=1.2?5:0)
  :0;

 const score=direction&&entry!==null&&stop!==null&&risk>0?clamp(rawScore):0;
 const rr=entry!==null&&stop!==null&&targets[0]!==undefined?Math.abs(targets[0]-entry)/Math.abs(entry-stop):null;
 const usable=direction!==null&&entry!==null&&stop!==null&&risk>0&&targets.length>0&&
  ((direction==="bullish"&&stop<entry&&targets[0]>entry)||(direction==="bearish"&&stop>entry&&targets[0]<entry));

 const setup:Setup={
  direction:usable?(direction==="bullish"?"BUY":"SELL"):"WAIT",
  entry:usable?entry:null,
  stop:usable?stop:null,
  targets:usable?targets:[],
  rr:usable?rr:null,
  confidence:usable?score:0,
  confirmations:usable?confirmations:[]
 };

 return{
  trend,
  asOf:data.length-1,
  pivots:ps.slice(-18),
  internalPivots:internal.slice(-24),
  events:events.slice(-12),
  fvgs:fvgs.slice(-14),
  orderBlocks:obs.slice(-10),
  breakers:breakers.slice(-8),
  liquidityHighs,
  liquidityLows,
  equalHighs:equalHighs.slice(-8),
  equalLows:equalLows.slice(-8),
  sweeps:sweeps.slice(-10),
  premiumDiscount:pd,
  premiumDiscountRange:{high:r.hi,low:r.lo,mid},
  vwap,
  volumeRatio,
  displacement:displacementAt(data,data.length-1,a),
  entryZone:zone,
  stop,
  targets,
  score,
  setup
 }
}

function impulseCandidates(c:Candle[],bull:boolean):WaveCount[]{
 const ps=pivots(c,2).slice(-24),out:WaveCount[]=[];
 if(ps.length<6)return out;
 const types=bull?["L","H","L","H","L","H"]:["H","L","H","L","H","L"];

 for(let s=0;s<=ps.length-6;s++){
  const q=ps.slice(s,s+6);
  if(q.some((p,i)=>p.type!==types[i]))continue;
  if(q.some((p,i)=>i>0&&p.index<=q[i-1].index))continue;

  const p=q.map(x=>x.price);
  const w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]);
  if([w1,w2,w3,w4,w5].some(x=>!Number.isFinite(x)||x<=0))continue;

  const geometry=bull
   ?p[1]>p[0]&&p[2]>p[0]&&p[2]<p[1]&&p[3]>p[1]&&p[4]>p[2]&&p[4]<p[3]&&p[4]>p[1]&&p[5]>p[3]
   :p[1]<p[0]&&p[2]<p[0]&&p[2]>p[1]&&p[3]<p[1]&&p[4]<p[2]&&p[4]>p[3]&&p[4]<p[1]&&p[5]<p[3];
  if(!geometry)continue;

  const r2=w2/w1,r3=w3/w1,r4=w4/w3,r5=w5/w1;
  let points=0;
  const rules:string[]=[];

  if(r2>=.382&&r2<=.786){points+=18;rules.push("Wave 2 retraces 38.2–78.6%")}
  else if(r2<.382){points+=10;rules.push("Wave 2 is shallow but remains valid")}
  else {points+=4;rules.push("Wave 2 is deep but below 100%")}

  if(r3>=1.618&&r3<=2.618){points+=22;rules.push("Wave 3 has strong extension")}
  else if(r3>=1){points+=18;rules.push("Wave 3 extends Wave 1")}
  else points+=6;

  if(w3>=Math.min(w1,w5)){points+=18;rules.push("Wave 3 is not the shortest")}
  else rules.push("Wave 3 shortest rule violated");

  if(r4>=.236&&r4<=.618){points+=14;rules.push("Wave 4 retraces 23.6–61.8%")}
  else if(r4<1){points+=8;rules.push("Wave 4 is shallow")}

  points+=14;
  rules.push(bull?"Wave 4 does not overlap Wave 1 territory":"Wave 4 does not overlap Wave 1 territory");

  if(r5>=.618&&r5<=2.618){points+=8;rules.push("Wave 5 projection is common")}
  else rules.push("Wave 5 projection is outside common range");

  const quality=clamp(points),dir=bull?1:-1;
  out.push({
   points:q.map((x,i)=>({index:x.index,price:x.price,label:String(i+1)})),
   kind:"Impulse",
   direction:bull?"bullish":"bearish",
   invalidation:p[0],
   targets:[p[5]+dir*w1*1.618,p[5]+dir*w1*2.618],
   quality,
   rules
  });
 }
 return out;
}
function correctionCandidates(c:Candle[]):WaveCount[]{
 const ps=pivots(c,2).slice(-22),out:WaveCount[]=[];
 if(ps.length<4)return out;

 for(let s=0;s<=ps.length-4;s++){
  const q=ps.slice(s,s+4);
  if(q.some((p,i)=>i>0&&p.index<=q[i-1].index))continue;

  const bearish=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H"&&q[3].type==="L";
  const bullish=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L"&&q[3].type==="H";
  if(!bearish&&!bullish)continue;

  const p=q.map(x=>x.price);
  const aLeg=Math.abs(p[1]-p[0]);
  const bLeg=Math.abs(p[2]-p[1]);
  const cLeg=Math.abs(p[3]-p[2]);
  if(aLeg<=0||bLeg<=0||cLeg<=0)continue;

  const bRetrace=bLeg/aLeg;
  const cProjection=cLeg/aLeg;
  let quality=35;
  const rules:string[]=["ABC correction candidate from four confirmed pivots"];

  if(bRetrace>=.382&&bRetrace<=.786){quality+=30;rules.push("B retraces 38.2–78.6% of A")}
  else if(bRetrace<1){quality+=12;rules.push("B is a shallow A retracement")}
  else if(bRetrace<1.0)quality+=8;

  if(cProjection>=.618&&cProjection<=1.618){quality+=25;rules.push("C is 0.618–1.618× A")}
  else if(cProjection<2){quality+=12;rules.push("C remains within a broad A extension range")}

  if(bearish?p[3]<p[1]:p[3]>p[1]){quality+=10;rules.push("C extends beyond A termination")}
  else rules.push("C fails to extend beyond A termination");

  out.push({
   points:q.map((x,i)=>({index:x.index,price:x.price,label:["Start","A","B","C"][i]})),
   kind:"Correction",
   direction:bearish?"bearish":"bullish",
   invalidation:p[0],
   targets:[p[3]],
   quality:clamp(quality),
   rules
  });
 }
 return out.sort((a,b)=>b.quality-a.quality);
}
export function analyzeElliott(c:Candle[]):ElliottResult{
 const data=c.at(-1)?.closed===false?c.slice(0,-1):c;
 if(data.length<30)return{primary:null,alternative:null,correction:null,fib:null,fibLevels:[],channel:null,phase:"Insufficient data",score:0,confidence:0};

 const all=[...impulseCandidates(data,true),...impulseCandidates(data,false)];
 const latestIndex=data.length-1;
 const ranked=[...all].sort((a,b)=>{
  const ai=a.points.at(-1)?.index??-1,bi=b.points.at(-1)?.index??-1;
  const ageA=Math.max(0,latestIndex-ai),ageB=Math.max(0,latestIndex-bi);
  const rankA=a.quality+Math.max(0,8-ageA*.25);
  const rankB=b.quality+Math.max(0,8-ageB*.25);
  return rankB-rankA||b.quality-a.quality;
 });

 const primary=ranked.find(x=>x.quality>=70)??null;
 const alternative=ranked.find(x=>x!==primary&&(!primary||x.direction!==primary.direction))??ranked.find(x=>x!==primary)??null;
 const correction=correctionCandidates(data)[0]??null;

 if(!primary){
  return{
   primary:null,alternative,correction,fib:null,fibLevels:[],channel:null,
   phase:correction?"ABC correction candidate":"No strict impulse candidate",
   score:0,confidence:0
  };
 }

 const p=primary.points.map(x=>x.price);
 const w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]);
 const start=primary.points[0],end=primary.points[5];
 const slope=(p[3]-p[0])/Math.max(primary.points[3].index-primary.points[0].index,1);
 const hi=Math.max(p[0],p[5]),lo=Math.min(p[0],p[5]),waveRange=hi-lo;
 const dir=primary.direction==="bullish"?1:-1;

 const fibLevels=[
  ["0%",p[5]],
  ["23.6%",p[5]+(p[0]-p[5])*.236],
  ["38.2%",p[5]+(p[0]-p[5])*.382],
  ["50%",p[5]+(p[0]-p[5])*.5],
  ["61.8%",p[5]+(p[0]-p[5])*.618],
  ["78.6%",p[5]+(p[0]-p[5])*.786],
  ["100%",p[0]],
  ["127.2%",p[5]+dir*waveRange*.272],
  ["161.8%",p[5]+dir*waveRange*.618],
  ["261.8%",p[5]+dir*waveRange*1.618]
 ].map(([label,price])=>({label:String(label),price:Number(price)}));

 return{
  primary,alternative,correction,
  fib:{
   w2:+(w2/w1).toFixed(3),
   w3:+(w3/w1).toFixed(3),
   w4:+(w4/w3).toFixed(3),
   w5:+(w5/w1).toFixed(3)
  },
  fibLevels,
  channel:{
   a:start.price,
   b:start.price+slope*(end.index-start.index)
  },
  phase:primary.quality>=85?"Impulse candidate · high rule conformance":"Impulse candidate · acceptable rule conformance",
  score:primary.quality,
  confidence:primary.quality
 };
}
export function analyzeMTF(frames:{interval:string;candles:Candle[]}[]):MTFResult{
 const rows=frames.map(f=>{
  const data=f.candles.at(-1)?.closed===false?f.candles.slice(0,-1):f.candles;
  const available=data.length>=25;
  const s=available?analyzeSMC(data):null;
  if(!s)return{interval:f.interval,trend:"Neutral" as const,score:0,structure:"UNAVAILABLE",available:false};

  const latest=s.events.at(-1);
  const age=latest?s.asOf-latest.index:Infinity;
  let contextScore=25;
  if(s.trend!=="Neutral")contextScore=50;
  if(latest&&age<=20)contextScore=latest.strength==="displacement"?75:65;
  if(latest&&latest.type==="CHOCH"&&age<=10)contextScore+=5;
  contextScore=clamp(contextScore);

  return{
   interval:f.interval,
   trend:s.trend,
   score:contextScore,
   structure:latest?.type??"No event",
   available:true
  };
 });

 const usable=rows.filter(r=>r.available);
 const weight=(r:MTFFrame)=>r.interval==="4h"||r.interval==="1h"?1.4:1;
 const totalWeight=usable.reduce((sum,r)=>sum+weight(r),0);
 const weighted=usable.reduce((sum,r)=>{
  const signed=r.trend==="Bullish"?r.score:r.trend==="Bearish"?-r.score:0;
  return sum+signed*weight(r);
 },0)/Math.max(1,totalWeight);

 return{
  trend:usable.length?(weighted>12?"Bullish":weighted<-12?"Bearish":"Neutral"):"Neutral",
  score:usable.length?clamp(50+weighted/2):0,
  frames:rows
 };
}
