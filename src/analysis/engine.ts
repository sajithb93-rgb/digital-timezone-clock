export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number};
export type Pivot={index:number;price:number;type:"H"|"L";label?:string;strength?:number};
export type FVG={from:number;to:number;low:number;high:number;type:"bullish"|"bearish";filled:boolean;fillIndex?:number;size?:number};
export type OB={index:number;low:number;high:number;type:"bullish"|"bearish";mitigated:boolean;mitigationIndex?:number;strength?:number};
export type Breaker={index:number;low:number;high:number;type:"bullish"|"bearish";active:boolean};
export type StructureEvent={index:number;price:number;type:"BOS"|"CHOCH";direction:"bullish"|"bearish";strength:"normal"|"displacement"};
export type Sweep={index:number;price:number;type:"high"|"low";confirmed:boolean;displacement?:boolean};
export type Zone={low:number;high:number;type:"entry"|"stop"|"target"};
export type Setup={direction:"BUY"|"SELL"|"WAIT";entry:number|null;stop:number|null;targets:number[];rr:number|null;confidence:number;confirmations:string[]};
export type SMCResult={
 trend:"Bullish"|"Bearish"|"Neutral"; pivots:Pivot[]; internalPivots:Pivot[]; events:StructureEvent[];
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
export type MTFResult={trend:"Bullish"|"Bearish"|"Neutral";score:number;frames:{interval:string;trend:"Bullish"|"Bearish"|"Neutral";score:number;structure:string}[]};

function trueRange(c:Candle[],i:number){if(i===0)return c[i].high-c[i].low;return Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}
function atr(c:Candle[],n=14){if(!c.length)return 0;const start=Math.max(0,c.length-n);return c.slice(start).reduce((v,_,i)=>v+trueRange(c,start+i),0)/Math.max(1,c.length-start)}
function pivots(c:Candle[],w=3):Pivot[]{
 const out:Pivot[]=[];
 for(let i=w;i<c.length-w;i++){
  let hi=true,lo=true,score=0;
  for(let j=i-w;j<=i+w;j++){if(j===i)continue;if(c[j].high>=c[i].high)hi=false;if(c[j].low<=c[i].low)lo=false}
  if(hi){for(let j=Math.max(0,i-w);j<=Math.min(c.length-1,i+w);j++)score+=Math.abs(c[j].high-c[j].low);out.push({index:i,price:c[i].high,type:"H",strength:score/(2*w+1)})}
  if(lo){for(let j=Math.max(0,i-w);j<=Math.min(c.length-1,i+w);j++)score+=Math.abs(c[j].high-c[j].low);out.push({index:i,price:c[i].low,type:"L",strength:score/(2*w+1)})}
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
  if(c[i-1].high<c[i+1].low){const low=c[i-1].high,high=c[i+1].low;let fillIndex:number|undefined;for(let j=i+1;j<c.length;j++)if(c[j].low<=low){fillIndex=j;break}out.push({from:i-1,to:i+1,low,high,type:"bullish",filled:fillIndex!==undefined,fillIndex,size:(high-low)/Math.max(a,.0000001)})}
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
   const d=displacementAt(c,i+k,a);
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
 const empty:SMCResult={trend:"Neutral",pivots:[],internalPivots:[],events:[],fvgs:[],orderBlocks:[],breakers:[],liquidityHighs:[],liquidityLows:[],equalHighs:[],equalLows:[],sweeps:[],premiumDiscount:"Equilibrium",premiumDiscountRange:{high:0,low:0,mid:0},vwap:0,volumeRatio:0,displacement:0,entryZone:null,stop:null,targets:[],score:0,setup:{direction:"WAIT",entry:null,stop:null,targets:[],rr:null,confidence:0,confirmations:[]}};
 if(c.length<25)return empty;
 const a=atr(c),ps=labelPivots(pivots(c,3)),internal=labelPivots(pivots(c,1)),events:StructureEvent[]=[];let structure:"bullish"|"bearish"|null=null;let brokenH=-1,brokenL=-1;
 for(let i=0;i<c.length;i++){
  const h=[...ps].reverse().find(p=>p.index<i&&p.type==="H"&&p.index!==brokenH);
  const l=[...ps].reverse().find(p=>p.index<i&&p.type==="L"&&p.index!==brokenL);
  const disp=displacementAt(c,i,a)>=.7;
  if(h&&c[i].close>h.price){events.push({index:i,price:h.price,type:structure&&structure!=="bullish"?"CHOCH":"BOS",direction:"bullish",strength:disp?"displacement":"normal"});structure="bullish";brokenH=h.index}
  if(l&&c[i].close<l.price){events.push({index:i,price:l.price,type:structure&&structure!=="bearish"?"CHOCH":"BOS",direction:"bearish",strength:disp?"displacement":"normal"});structure="bearish";brokenL=l.index}
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
  const vwap=recentCandles.reduce((s,x)=>s+x.close*x.volume,0)/Math.max(totalVolume,.0000001);
  const structureDirection=events.at(-1)?.direction??null;
 const trend=structureDirection==="bullish"?"Bullish":structureDirection==="bearish"?"Bearish":last.close>mid?"Bullish":last.close<mid?"Bearish":"Neutral";
 const pd=last.close>mid?"Premium":last.close<mid?"Discount":"Equilibrium";
 const direction=structureDirection??(trend==="Bullish"?"bullish":trend==="Bearish"?"bearish":null);
 const ob=direction?[...obs].reverse().find(x=>x.type===direction&&!x.mitigated):undefined;
 const fvg=direction?[...fvgs].reverse().find(x=>x.type===direction&&!x.filled):undefined;
 const sweep=direction==="bullish"?sweeps.slice().reverse().find(s=>s.type==="low"):direction==="bearish"?sweeps.slice().reverse().find(s=>s.type==="high"):undefined;
 const zone=ob?{low:ob.low,high:ob.high,type:"entry" as const}:fvg?{low:fvg.low,high:fvg.high,type:"entry" as const}:null;
 const entry=zone?(zone.low+zone.high)/2:null;
 const stop=zone?(direction==="bullish"?Math.min(zone.low,r.lo)-a*.15:Math.max(zone.high,r.hi)+a*.15):null;
 const risk=entry!==null&&stop!==null?Math.abs(entry-stop):0;
 const targets=entry!==null&&risk?[1,2,3,4].map(x=>direction==="bullish"?entry+risk*x:entry-risk*x):[];
 const confirmations:string[]=[];
 if(direction&&events.at(-1)?.direction===direction)confirmations.push("Structure aligned");
 if(sweep?.confirmed&&sweep.displacement)confirmations.push("Liquidity sweep + displacement");
 if(ob)confirmations.push("Unmitigated order block");
 if(fvg)confirmations.push("Unfilled fair value gap");
 if(direction==="bullish"&&pd==="Discount"||direction==="bearish"&&pd==="Premium")confirmations.push("Premium/discount aligned");
 if(Math.abs(last.close-last.open)>=a*.5)confirmations.push("Displacement");
 const score=clamp(35+confirmations.length*10+(events.at(-1)?.strength==="displacement"?10:0)+(equalHighs.length+equalLows.length>0?5:0));
 const rr=entry!==null&&stop!==null&&targets[0]!==undefined?Math.abs(targets[0]-entry)/Math.abs(entry-stop):null;
 const setup:Setup={direction:direction==="bullish"?"BUY":direction==="bearish"?"SELL":"WAIT",entry,stop,targets,rr,confidence:score,confirmations};
 return{trend,pivots:ps.slice(-18),internalPivots:internal.slice(-24),events:events.slice(-12),fvgs:fvgs.slice(-14),orderBlocks:obs.slice(-10),breakers:breakers.slice(-8),liquidityHighs:liquidityHighs.slice(-8),liquidityLows:liquidityLows.slice(-8),equalHighs:equalHighs.slice(-8),equalLows:equalLows.slice(-8),sweeps:sweeps.slice(-10),premiumDiscount:pd,premiumDiscountRange:{high:r.hi,low:r.lo,mid},vwap,volumeRatio,displacement:displacementAt(c,c.length-1,a),entryZone:zone,stop,targets,score,setup};
}

function impulseCandidates(c:Candle[],bull:boolean):WaveCount[]{
 const ps=pivots(c,2).slice(-18),out:WaveCount[]=[];
 if(ps.length<6)return out;
 for(let s=0;s<=ps.length-6;s++){
  const q=ps.slice(s,s+6),types=bull?["L","H","L","H","L","H"]:["H","L","H","L","H","L"];
  if(q.some((p,i)=>p.type!==types[i]))continue;
  const p=q.map(x=>x.price),w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]);if(!w1||!w3||!w5)continue;
  const r2=w2/w1,r3=w3/w1,r4=w4/w3,r5=w5/w1,r3r5=w3/Math.max(w5,.0000001);let points=0;const rules:string[]=[];
  if(r2>=.382&&r2<=.786){points+=18;rules.push("Wave 2 retracement 38.2–78.6%")}else rules.push("Wave 2 outside common retracement");
  if(r3>=1){points+=18;rules.push("Wave 3 extends Wave 1")}else rules.push("Wave 3 weak");
  if(w3>=Math.min(w1,w5)){points+=18;rules.push("Wave 3 is not shortest")}else rules.push("Wave 3 may be shortest");
  if(r4>=.236&&r4<=.618){points+=14;rules.push("Wave 4 retracement 23.6–61.8%")}else rules.push("Wave 4 outside common retracement");
  if(bull?p[4]>p[1]:p[4]<p[1]){points+=14;rules.push("Wave 4 avoids Wave 1 overlap")}else rules.push("Wave 4 overlap / invalid");
  if(r5>=.382&&r5<=2.618){points+=10;rules.push("Wave 5 projection plausible")}
  if(r3r5>1.05){points+=8;rules.push("Wave 3 materially stronger than Wave 5")}
  const quality=clamp(points),dir=bull?1:-1;
  out.push({points:q.map((x,i)=>({index:x.index,price:x.price,label:String(i+1)})),kind:"Impulse",direction:bull?"bullish":"bearish",invalidation:p[0],targets:[p[5]+dir*w1*1.618,p[5]+dir*w1*2.618],quality,rules});
 }
 return out.sort((a,b)=>b.quality-a.quality);
}
function correctionCandidates(c:Candle[]):WaveCount[]{
 const ps=pivots(c,2).slice(-16),out:WaveCount[]=[];
 for(let s=0;s<=ps.length-4;s++){const q=ps.slice(s,s+4),bull=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H"&&q[3].type==="L",bear=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L"&&q[3].type==="H";if(!bull&&!bear)continue;const p=q.map(x=>x.price),ab=Math.abs(p[1]-p[0]),bc=Math.abs(p[2]-p[1]),cd=Math.abs(p[3]-p[2]);const rb=bc/Math.max(ab,.0000001),rc=cd/Math.max(ab,.0000001),quality=clamp(45+(rb>=.382&&rb<=1.618?25:0)+(rc>=.382&&rc<=1.618?25:0));out.push({points:q.map((x,i)=>({index:x.index,price:x.price,label:["A","B","C","D"][i]})),kind:"Correction",direction:bull?"bearish":"bullish",invalidation:p[0],targets:[p[3]],quality,rules:["Alternating pivot correction candidate"]})}
 return out.sort((a,b)=>b.quality-a.quality);
}
export function analyzeElliott(c:Candle[]):ElliottResult{
 if(c.length<30)return{primary:null,alternative:null,correction:null,fib:null,fibLevels:[],channel:null,phase:"Insufficient data",score:0,confidence:0};
 const all=[...impulseCandidates(c,true),...impulseCandidates(c,false)].sort((a,b)=>b.quality-a.quality);
 let primary=all[0]??null;
 const alternative=all[1]??null;
 const correction=correctionCandidates(c)[0]??null;
 if(!primary){
  const ps=pivots(c,2).slice(-6);
  if(ps.length===6){
   const bull=ps[0].type==="L"&&ps[1].type==="H";
   const points=ps.map((x,i)=>({index:x.index,price:x.price,label:String(i+1)}));
   primary={points,kind:"Impulse",direction:bull?"bullish":"bearish",invalidation:ps[0].price,targets:[ps[5].price],quality:35,rules:["Fallback pivot-sequence candidate; strict Elliott rules not confirmed"]};
  }
 }
 if(!primary)return{primary:null,alternative:null,correction,fib:null,fibLevels:[],channel:null,phase:correction?"Correction candidate":"No candidate",score:correction?.quality??0,confidence:correction?.quality??0};
 const p=primary.points.map(x=>x.price),w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]),a=p[0],b=p[3],slope=(b-a)/Math.max(primary.points[3].index-primary.points[0].index,1);
 const hi=Math.max(p[0],p[5]),lo=Math.min(p[0],p[5]),range=hi-lo,dir=primary.direction==="bullish"?1:-1;
 const fibLevels=[["0%",p[5]],["23.6%",p[5]+(p[0]-p[5])*.236],["38.2%",p[5]+(p[0]-p[5])*.382],["50%",p[5]+(p[0]-p[5])*.5],["61.8%",p[5]+(p[0]-p[5])*.618],["78.6%",p[5]+(p[0]-p[5])*.786],["100%",p[0]],["127.2%",p[5]+dir*range*.272],["161.8%",p[5]+dir*range*.618],["261.8%",p[5]+dir*range*1.618]].map(([label,price])=>({label:String(label),price:Number(price)}));
 return{primary,alternative,correction,fib:{w2:+(w2/w1).toFixed(3),w3:+(w3/w1).toFixed(3),w4:+(w4/w3).toFixed(3),w5:+(w5/w1).toFixed(3)},fibLevels,channel:{a,b:a+slope*(primary.points[5].index-primary.points[0].index)},phase:primary.quality>=78?"Impulse candidate · high rule conformance":primary.quality>=60?"Impulse candidate · moderate conformance":"Impulse candidate · low conformance",score:primary.quality,confidence:primary.quality};
}
export function analyzeMTF(frames:{interval:string;candles:Candle[]}[]):MTFResult{
 const rows=frames.map(f=>{const s=analyzeSMC(f.candles);return{interval:f.interval,trend:s.trend,score:s.score,structure:s.events.at(-1)?.type??"No event"}});const weighted=rows.reduce((sum,r,i)=>sum+(r.trend==="Bullish"?r.score:r.trend==="Bearish"?-r.score:0)*(i<2?1.4:1),0)/Math.max(1,rows.reduce((sum,r,i)=>sum+(i<2?1.4:1),0));return{trend:weighted>12?"Bullish":weighted<-12?"Bearish":"Neutral",score:clamp(50+weighted/2),frames:rows};
}
