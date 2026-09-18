export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number};
export type Pivot={index:number;price:number;type:"H"|"L";label?:string};
export type FVG={from:number;to:number;low:number;high:number;type:"bullish"|"bearish";filled:boolean};
export type OB={index:number;low:number;high:number;type:"bullish"|"bearish";mitigated:boolean};
export type StructureEvent={index:number;price:number;type:"BOS"|"CHOCH";direction:"bullish"|"bearish"};
export type Sweep={index:number;price:number;type:"high"|"low";confirmed:boolean};
export type Zone={low:number;high:number;type:"entry"|"stop"|"target"};
export type SMCResult={trend:"Bullish"|"Bearish"|"Neutral";pivots:Pivot[];events:StructureEvent[];fvgs:FVG[];orderBlocks:OB[];liquidityHighs:Pivot[];liquidityLows:Pivot[];sweeps:Sweep[];premiumDiscount:"Premium"|"Discount"|"Equilibrium";entryZone:Zone|null;stop:number|null;targets:number[];score:number};

export type WavePoint={index:number;price:number;label:string};
export type WaveCount={points:WavePoint[];kind:"Impulse"|"Correction";direction:"bullish"|"bearish";invalidation:number;targets:number[];quality:number;rules:string[]};
export type ElliottResult={primary:WaveCount|null;alternative:WaveCount|null;correction:WaveCount|null;fib:{w2:number;w3:number;w4:number;w5:number}|null;channel:{a:number;b:number}|null;phase:string;score:number};

function atr(c:Candle[],n=14){if(!c.length)return 0;const s=c.slice(-Math.min(n,c.length)).reduce((v,x)=>v+x.high-x.low,0);return s/Math.min(n,c.length)}
function pivots(c:Candle[],w=3):Pivot[]{const out:Pivot[]=[];for(let i=w;i<c.length-w;i++){let hi=true,lo=true;for(let j=i-w;j<=i+w;j++){if(j===i)continue;if(c[j].high>=c[i].high)hi=false;if(c[j].low<=c[i].low)lo=false}if(hi)out.push({index:i,price:c[i].high,type:"H"});if(lo)out.push({index:i,price:c[i].low,type:"L"})}return out.sort((a,b)=>a.index-b.index)}
function range(c:Candle[]){const q=c.slice(-30);return{hi:Math.max(...q.map(x=>x.high)),lo:Math.min(...q.map(x=>x.low))}}
function clamp(n:number){return Math.max(0,Math.min(100,Math.round(n)))}

export function analyzeSMC(c:Candle[]):SMCResult{
 if(c.length<15)return{trend:"Neutral",pivots:[],events:[],fvgs:[],orderBlocks:[],liquidityHighs:[],liquidityLows:[],sweeps:[],premiumDiscount:"Equilibrium",entryZone:null,stop:null,targets:[],score:0};
 const ps=pivots(c,3), labeled:Pivot[]=[];let lastH=-Infinity,lastL=Infinity;
 for(const p of ps){const q={...p};if(p.type==="H"){q.label=lastH===-Infinity?"SH":p.price>lastH?"HH":"LH";lastH=p.price}else{q.label=lastL===Infinity?"SL":p.price>lastL?"HL":"LL";lastL=p.price}labeled.push(q)}
 const events:StructureEvent[]=[];let structure:"bullish"|"bearish"|null=null;let brokenHigh:number|null=null,brokenLow:number|null=null;
 for(let i=0;i<c.length;i++){const prior=labeled.filter(p=>p.index<i);const h=[...prior].reverse().find(p=>p.type==="H");const l=[...prior].reverse().find(p=>p.type==="L");
  if(h&&brokenHigh!==h.index&&c[i].close>h.price){const d="bullish";events.push({index:i,price:h.price,type:structure&&structure!==d?"CHOCH":"BOS",direction:d});structure=d;brokenHigh=h.index}
  if(l&&brokenLow!==l.index&&c[i].close<l.price){const d="bearish";events.push({index:i,price:l.price,type:structure&&structure!==d?"CHOCH":"BOS",direction:d});structure=d;brokenLow=l.index}
 }
 const fvgs:FVG[]=[];for(let i=1;i<c.length-1;i++){if(c[i-1].high<c[i+1].low)fvgs.push({from:i-1,to:i+1,low:c[i-1].high,high:c[i+1].low,type:"bullish",filled:c.slice(i+1).some(x=>x.low<=c[i-1].high)});if(c[i-1].low>c[i+1].high)fvgs.push({from:i-1,to:i+1,low:c[i+1].high,high:c[i-1].low,type:"bearish",filled:c.slice(i+1).some(x=>x.high>=c[i-1].low)})}
 const a=atr(c),obs:OB[]=[];for(let i=1;i<c.length-1;i++){if(c[i].close<c[i].open&&c[i+1].close>c[i].high+a*.15)obs.push({index:i,low:c[i].low,high:c[i].open,type:"bullish",mitigated:c.slice(i+1).some(x=>x.low<=c[i].open)});if(c[i].close>c[i].open&&c[i+1].close<c[i].low-a*.15)obs.push({index:i,low:c[i].open,high:c[i].high,type:"bearish",mitigated:c.slice(i+1).some(x=>x.high>=c[i].open)})}
 const highs=labeled.filter(p=>p.type==="H"),lows=labeled.filter(p=>p.type==="L"),tol=Math.max(a*.25,a*0.15);
 const liquidityHighs=highs.filter((p,i)=>highs.slice(0,i).some(x=>Math.abs(x.price-p.price)<=tol));
 const liquidityLows=lows.filter((p,i)=>lows.slice(0,i).some(x=>Math.abs(x.price-p.price)<=tol));
 const sweeps:Sweep[]=[];for(const p of [...liquidityHighs.slice(-8),...liquidityLows.slice(-8)]){const after=c.slice(p.index+1);const j=after.findIndex(x=>p.type==="H"?x.high>p.price&&x.close<p.price:x.low<p.price&&x.close>p.price);if(j>=0)sweeps.push({index:p.index+1+j,price:p.price,type:p.type==="H"?"high":"low",confirmed:true})}
 const {hi,lo}=range(c),mid=(hi+lo)/2,last=c.at(-1)!;const trendOut:last["close"]>mid?"Bullish":last.close<mid?"Bearish":"Neutral";const pd=last.close>mid?"Premium":last.close<mid?"Discount":"Equilibrium";
 const direction=trendOut==="Bullish"?"bullish":trendOut==="Bearish"?"bearish":null;const ob=direction?[...obs].reverse().find(x=>x.type===direction&&!x.mitigated):undefined;const fvg=direction?[...fvgs].reverse().find(x=>x.type===direction&&!x.filled):undefined;
 const entryZone=ob?{low:ob.low,high:ob.high,type:"entry" as const}:fvg?{low:fvg.low,high:fvg.high,type:"entry" as const}:null;const stop=entryZone?(direction==="bullish"?Math.min(entryZone.low,lo)-a*.25:Math.max(entryZone.high,hi)+a*.25):null;const risk=entryZone&&stop?Math.abs(((entryZone.low+entryZone.high)/2)-stop):0;const entry=entryZone?(entryZone.low+entryZone.high)/2:null;const targets=entry&&risk?[1.5,2,3].map(r=>direction==="bullish"?entry+r*risk:entry-r*risk):[];
 const score=clamp(45+(direction&&events.at(-1)?.direction===direction?20:0)+(fvg?10:0)+(ob?10:0)+(sweeps.length?10:0)+(liquidityHighs.length+liquidityLows.length?5:0));
 return{trend:trendOut,pivots:labeled,events:events.slice(-10),fvgs:fvgs.slice(-10),orderBlocks:obs.slice(-8),liquidityHighs:liquidityHighs.slice(-6),liquidityLows:liquidityLows.slice(-6),sweeps:sweeps.slice(-8),premiumDiscount:pd,entryZone,stop,targets,score}
}

function impulseCandidates(c:Candle[],bull:boolean):WaveCount[]{
 const ps=pivots(c,2).slice(-14),out:WaveCount[]=[];if(ps.length<6)return out;
 for(let s=0;s<=ps.length-6;s++){const q=ps.slice(s,s+6);const types=bull?["L","H","L","H","L","H"]:["H","L","H","L","H","L"];if(q.some((p,i)=>p.type!==types[i]))continue;
  const p=q.map(x=>x.price),w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]);if(!w1||!w3||!w5)continue;
  const r2=w2/w1,r3=w3/w1,r4=w4/w3,r5=w5/w1;const rules:string[]=[];let points=0;
  if(r2>=.382&&r2<=.786){points+=20;rules.push("Wave 2 retracement in common range")}else rules.push("Wave 2 retracement outside common range");
  if(r3>=1){points+=20;rules.push("Wave 3 extends Wave 1")}else rules.push("Wave 3 is weak");
  if(w3>=Math.min(w1,w5)){points+=20;rules.push("Wave 3 is not the shortest")}else rules.push("Wave 3 may be shortest");
  if(r4>=.236&&r4<=.618){points+=15;rules.push("Wave 4 retracement in common range")}else rules.push("Wave 4 outside common range");
  if(bull?(p[4]>p[1]):(p[4]<p[1])){points+=15;rules.push("Wave 4 avoids Wave 1 overlap")}else rules.push("Wave 4 overlaps Wave 1");
  if(r5>=.382&&r5<=2.618){points+=10;rules.push("Wave 5 projection plausible")}
  const quality=clamp(points);const inv=bull?p[0]:p[0];const dir=bull?1:-1;const targets=[p[5]+dir*w1*1.618,p[5]+dir*w1*2.618];out.push({points:q.map((x,i)=>({index:x.index,price:x.price,label:String(i+1)})),kind:"Impulse",direction:bull?"bullish":"bearish",invalidation:inv,targets,quality,rules})
 }return out.sort((a,b)=>b.quality-a.quality)
}
function correctionCandidates(c:Candle[]):WaveCount[]{
 const ps=pivots(c,2).slice(-12),out:WaveCount[]=[];for(let s=0;s<=ps.length-4;s++){const q=ps.slice(s,s+4),bull=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H"&&q[3].type==="L",bear=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L"&&q[3].type==="H";if(!bull&&!bear)continue;const p=q.map(x=>x.price),ab=Math.abs(p[1]-p[0]),bc=Math.abs(p[2]-p[1]),cd=Math.abs(p[3]-p[2]);const quality=clamp(50+(bc/Math.max(ab,.0000001)>=.382&&bc/Math.max(ab,.0000001)<=1.618?25:0)+(cd/Math.max(ab,.0000001)>=.382&&cd/Math.max(ab,.0000001)<=1.618?25:0));out.push({points:q.map((x,i)=>({index:x.index,price:x.price,label:["A","B","C","D"][i]})),kind:"Correction",direction:bull?"bearish":"bullish",invalidation:p[0],targets:[p[3]],quality,rules:["ABC candidate based on alternating pivots"]})}return out.sort((a,b)=>b.quality-a.quality)
}
export function analyzeElliott(c:Candle[]):ElliottResult{
 if(c.length<25)return{primary:null,alternative:null,correction:null,fib:null,channel:null,phase:"Insufficient data",score:0};
 const bs=impulseCandidates(c,true),bear=impulseCandidates(c,false),all=[...bs,...bear].sort((a,b)=>b.quality-a.quality),primary=all[0]??null,alternative=all[1]??null,correction=correctionCandidates(c)[0]??null;
 if(!primary)return{primary:null,alternative:null,correction, fib:null,channel:null,phase:correction?"Correction candidate":"No valid candidate",score:correction?.quality??0};
 const p=primary.points.map(x=>x.price),w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]);const a=p[0],b=p[3],slope=(b-a)/Math.max(primary.points[3].index-primary.points[0].index,1);return{primary,alternative,correction,fib:{w2:+(w2/w1).toFixed(3),w3:+(w3/w1).toFixed(3),w4:+(w4/w3).toFixed(3),w5:+(w5/w1).toFixed(3)},channel:{a,b:a+slope*(primary.points[5].index-primary.points[0].index)},phase:primary.quality>=75?"Impulse candidate · strong rule conformance":"Impulse candidate · needs confirmation",score:primary.quality}
}
