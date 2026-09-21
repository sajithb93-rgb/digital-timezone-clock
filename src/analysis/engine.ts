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
 for(let i=w;i<c.length-w;i++){
  let hi=true,lo=true,score=0;
  for(let j=i-w;j<=i+w;j++){if(j===i)continue;if(c[j].high>=c[i].high)hi=false;if(c[j].low<=c[i].low)lo=false}
  if(hi){for(let j=Math.max(0,i-w);j<=Math.min(c.length-1,i+w);j++)score+=Math.abs(c[j].high-c[j].low);out.push({index:i,price:c[i].high,type:"H",strength:score/(2*w+1),confirmedAt:i+w})}
  if(lo){for(let j=Math.max(0,i-w);j<=Math.min(c.length-1,i+w);j++)score+=Math.abs(c[j].high-c[j].low);out.push({index:i,price:c[i].low,type:"L",strength:score/(2*w+1),confirmedAt:i+w})}
 }
 return out.sort((a,b)=>a.index-b.index);
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
 const empty:SMCResult={
  trend:"Neutral",asOf:-1,pivots:[],internalPivots:[],events:[],fvgs:[],orderBlocks:[],breakers:[],
  liquidityHighs:[],liquidityLows:[],equalHighs:[],equalLows:[],sweeps:[],
  premiumDiscount:"Equilibrium",premiumDiscountRange:{high:0,low:0,mid:0},
  vwap:0,volumeRatio:0,displacement:0,entryZone:null,stop:null,targets:[],score:0,
  setup:{direction:"WAIT",entry:null,stop:null,targets:[],rr:null,confidence:0,confirmations:[]}
 };
 const data=c.at(-1)?.closed===false?c.slice(0,-1):c;
 if(data.length<25)return empty;

 const a=atr(data), ps=labelPivots(pivots(data,3)), internal=labelPivots(pivots(data,1));
 const events:StructureEvent[]=[];
 let structure:"bullish"|"bearish"|null=null;
 let activeH:Pivot|null=null,activeL:Pivot|null=null,hiPtr=0,loPtr=0;
 const confirmedHighs=ps.filter(p=>p.type==="H").sort((x,y)=>(x.confirmedAt??x.index)-(y.confirmedAt??y.index));
 const confirmedLows=ps.filter(p=>p.type==="L").sort((x,y)=>(x.confirmedAt??x.index)-(y.confirmedAt??y.index));

 for(let i=0;i<data.length;i++){
  while(hiPtr<confirmedHighs.length&&(confirmedHighs[hiPtr].confirmedAt??Infinity)<=i)activeH=confirmedHighs[hiPtr++];
  while(loPtr<confirmedLows.length&&(confirmedLows[loPtr].confirmedAt??Infinity)<=i)activeL=confirmedLows[loPtr++];

  const bullBreak=!!activeH&&data[i].close>activeH.price;
  const bearBreak=!!activeL&&data[i].close<activeL.price;
  const disp=displacementAt(data,i,atrAt(data,i))>=.7;

  if(bullBreak){
   events.push({index:i,price:activeH!.price,type:structure&&structure!=="bullish"?"CHOCH":"BOS",direction:"bullish",strength:disp?"displacement":"normal"});
   structure="bullish";
   activeH=null;
  }else if(bearBreak){
   events.push({index:i,price:activeL!.price,type:structure&&structure!=="bearish"?"CHOCH":"BOS",direction:"bearish",strength:disp?"displacement":"normal"});
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
 const equalHighs=equalLevels(highs,tol),equalLows=equalLevels(lows,tol);
 const liquidityHighs=(equalHighs.length?equalHighs:highs.slice(-6)).slice(-8);
 const liquidityLows=(equalLows.length?equalLows:lows.slice(-6)).slice(-8);

 const sweeps:Sweep[]=[];
 const recentLiquidity=[...liquidityHighs,...liquidityLows];
 const sweepStart=Math.max(0,data.length-80);
 for(const p of recentLiquidity){
  const start=Math.max((p.confirmedAt??p.index)+1,sweepStart);
  for(let j=start;j<data.length;j++){
   const x=data[j];
   const swept=p.type==="H"?x.high>p.price&&x.close<p.price:x.low<p.price&&x.close>p.price;
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
 const structureDirection=latestEvent?.direction??structure;
 const trend=structureDirection==="bullish"?"Bullish":structureDirection==="bearish"?"Bearish":last.close>mid?"Bullish":last.close<mid?"Bearish":"Neutral";
 const pd=last.close>mid?"Premium":last.close<mid?"Discount":"Equilibrium";
 const rawDirection=structureDirection??(trend==="Bullish"?"bullish":trend==="Bearish"?"bearish":null);

 let zone:Zone|null=null;
 if(rawDirection){
  const candidates:Zone[]=[
   ...obs.filter(x=>x.type===rawDirection&&!x.mitigated).reverse().map(x=>({low:x.low,high:x.high,type:"entry" as const})),
   ...fvgs.filter(x=>x.type===rawDirection&&!x.filled).reverse().map(x=>({low:x.low,high:x.high,type:"entry" as const}))
  ];
  zone=candidates.find(z=>zoneUsable(z,last,a,rawDirection))??null;
 }
 const triggerIndex=zone&&rawDirection?zoneTrigger(data,zone,rawDirection):-1;
 const direction=zone&&triggerIndex>=0?rawDirection:null;

 const priorLow=zone&&rawDirection==="bullish"
  ?[...lows].reverse().find(p=>p.index<triggerIndex&&p.price<zone.low)
  :undefined;
 const priorHigh=zone&&rawDirection==="bearish"
  ?[...highs].reverse().find(p=>p.index<triggerIndex&&p.price>zone.high)
  :undefined;

 const structuralLow=zone&&rawDirection==="bullish"
  ?(priorLow&&zone.low-priorLow.price<=a*1.5?priorLow.price:zone.low)
  :null;
 const structuralHigh=zone&&rawDirection==="bearish"
  ?(priorHigh&&priorHigh.price-zone.high<=a*1.5?priorHigh.price:zone.high)
  :null;

 const entry=zone?(zone.low+zone.high)/2:null;
 const stop=zone&&rawDirection==="bullish"&&structuralLow!==null
  ?structuralLow-a*.15
  :zone&&rawDirection==="bearish"&&structuralHigh!==null
   ?structuralHigh+a*.15
   :zone&&rawDirection==="bullish"
    ?zone.low-a*.15
    :zone
     ?zone.high+a*.15
     :null;

 const risk=entry!==null&&stop!==null?Math.abs(entry-stop):0;
 const structuralTargets=direction==="bullish"
  ?[...liquidityHighs,...highs].map(p=>p.price).filter(p=>entry!==null&&p>entry&&p>last.close).sort((x,y)=>x-y)
  :direction==="bearish"
   ?[...liquidityLows,...lows].map(p=>p.price).filter(p=>entry!==null&&p<entry&&p<last.close).sort((x,y)=>y-x)
   :[];
 const uniqueTargets=structuralTargets.filter((p,i,arr)=>i===0||Math.abs(p-arr[i-1])>Math.max(Math.abs(p)*.0005,1e-12));
 const targets=entry!==null&&risk
  ?(uniqueTargets.length?uniqueTargets.slice(0,4):[1.5,2.5,3.5].map(x=>direction==="bullish"?entry+risk*x:entry-risk*x))
  :[];

 const confirmations:string[]=[];
 if(direction&&latestEvent?.direction===direction)confirmations.push("Confirmed structure alignment");
 const sweep=direction==="bullish"
  ?sweeps.slice().reverse().find(s=>s.type==="low")
  :direction==="bearish"
   ?sweeps.slice().reverse().find(s=>s.type==="high")
   :undefined;
 if(sweep?.confirmed&&sweep.displacement)confirmations.push("Liquidity sweep + displacement");
 if(direction&&obs.some(x=>x.type===direction&&!x.mitigated))confirmations.push("Unmitigated order block");
 if(direction&&fvgs.some(x=>x.type===direction&&!x.filled))confirmations.push("Unfilled fair value gap");
 if((direction==="bullish"&&pd==="Discount")||(direction==="bearish"&&pd==="Premium"))confirmations.push("Premium/discount aligned");
 if(triggerIndex>=0&&displacementAt(data,triggerIndex,atrAt(data,triggerIndex))>=.5)confirmations.push("Closed-candle displacement trigger");

 const rawScore=direction
  ?25
   +(latestEvent?.direction===direction?20:0)
   +(sweep?.confirmed?15:0)
   +(obs.some(x=>x.type===direction&&!x.mitigated)?15:0)
   +(fvgs.some(x=>x.type===direction&&!x.filled)?10:0)
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

  const r2=w2/w1,r3=w3/w1,r4=w4/w3,r5=w5/w1,r3r5=w3/Math.max(w5,1e-12);
  let points=0;
  const rules:string[]=[];

  if(r2>=.382&&r2<=.786){points+=18;rules.push("Wave 2 retraces 38.2–78.6% of Wave 1")}
  else if(r2<.382||r2<=.786){points+=10;rules.push("Wave 2 retracement is shallow but valid")}
  else rules.push("Wave 2 retracement is deep but under 100%");

  if(r3>=1.618&&r3<=2.618){points+=22;rules.push("Wave 3 has strong 1.618–2.618 extension")}
  else if(r3>=1){points+=18;rules.push("Wave 3 extends Wave 1")}
  else points+=6;

  if(w3>=Math.min(w1,w5)){points+=18;rules.push("Wave 3 is not the shortest impulse wave")}
  else rules.push("Wave 3 is the shortest — strict rule fails");

  if(r4>=.236&&r4<=.618){points+=14;rules.push("Wave 4 retraces 23.6–61.8% of Wave 3")}
  else if(r4<1){points+=8;rules.push("Wave 4 is a shallow retracement")}

  rules.push(bull?"Wave 4 remains above Wave 1 price territory":"Wave 4 remains below Wave 1 price territory");
  points+=14;

  if(r5>=.618&&r5<=2.618){points+=8;rules.push("Wave 5 projection is within a common range")}
  else rules.push("Wave 5 projection is extended/outside common range");

  if(r3r5>=1.05){points+=6;rules.push("Wave 3 is materially stronger than Wave 5")}

  const quality=clamp(points);
  const dir=bull?1:-1;
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
 const ps=pivots(c,2).slice(-20),out:WaveCount[]=[];
 if(ps.length<3)return out;
 for(let s=0;s<=ps.length-3;s++){
  const q=ps.slice(s,s+3);
  if(q.some((p,i)=>i>0&&p.index<=q[i-1].index))continue;
  const bull=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L";
  const bear=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H";
  if(!bull&&!bear)continue;

  const p=q.map(x=>x.price),ab=Math.abs(p[1]-p[0]),bc=Math.abs(p[2]-p[1]);
  if(!ab||!bc)continue;
  const bRetrace=bc/ab;
  const cVsA=Math.abs(p[2]-p[0])/ab;
  let quality=40;
  const rules:string[]=["ABC correction candidate from three confirmed pivots"];

  if(bRetrace>=.382&&bRetrace<=.786){quality+=25;rules.push("C leg is a common 38.2–78.6% retracement of A")}
  else if(bRetrace<1){quality+=12;rules.push("C leg retraces less than 100% of A")}

  if(cVsA>=.618&&cVsA<=1.618){quality+=25;rules.push("C leg length is plausible relative to A")}
  else if(cVsA<2){quality+=10;rules.push("C leg remains within a broad extension range")}

  out.push({
   points:q.map((x,i)=>({index:x.index,price:x.price,label:["A","B","C"][i]})),
   kind:"Correction",
   direction:bull?"bullish":"bearish",
   invalidation:p[0],
   targets:[p[2]],
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

 const qualified=ranked.filter(x=>x.quality>=70);
 const primary=qualified[0]??null;
 const alternative=ranked.find(x=>x!==primary&&(
  !primary ||
  x.direction!==primary.direction ||
  Math.abs((x.points.at(-1)?.index??-1)-(primary.points.at(-1)?.index??-1))>=2
 ))??ranked.find(x=>x!==primary)??null;
 const correction=correctionCandidates(data)[0]??null;

 if(!primary){
  return{
   primary:null,
   alternative,
   correction,
   fib:null,
   fibLevels:[],
   channel:null,
   phase:correction?"ABC correction candidate":"No strict impulse candidate",
   score:0,
   confidence:0
  };
 }

 const p=primary.points.map(x=>x.price);
 const w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]);
 const start=primary.points[0],end=primary.points[5];
 const slope=(p[3]-p[0])/Math.max(primary.points[3].index-primary.points[0].index,1);
 const hi=Math.max(p[0],p[5]),lo=Math.min(p[0],p[5]),waveRange=hi-lo,dir=primary.direction==="bullish"?1:-1;

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
  primary,
  alternative,
  correction,
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
  phase:primary.quality>=85?"Impulse candidate · high rule conformance":primary.quality>=70?"Impulse candidate · acceptable rule conformance":"Impulse candidate · weak conformance",
  score:primary.quality,
  confidence:primary.quality
 };
}

export function analyzeMTF(frames:{interval:string;candles:Candle[]}[]):MTFResult{
 const rows=frames.map(f=>{const available=f.candles.length>=25;const s=available?analyzeSMC(f.candles):null;return{interval:f.interval,trend:s?.trend??"Neutral",score:s?.score??0,structure:s?.events.at(-1)?.type??(available?"No event":"UNAVAILABLE"),available};});
 const usable=rows.filter(r=>r.available); const weight=(r:MTFFrame)=>r.interval==="4h"||r.interval==="1h"?1.4:1; const totalWeight=usable.reduce((sum,r)=>sum+weight(r),0);
 const weighted=usable.reduce((sum,r)=>sum+(r.trend==="Bullish"?r.score:r.trend==="Bearish"?-r.score:0)*weight(r),0)/Math.max(1,totalWeight);
 return{trend:usable.length?(weighted>12?"Bullish":weighted<-12?"Bearish":"Neutral"):"Neutral",score:usable.length?clamp(50+weighted/2):0,frames:rows};
}
