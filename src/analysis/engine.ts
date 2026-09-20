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
export type WaveCount={points:WavePoint[];kind:"Impulse"|"Correction";direction:"bullish"|"bearish";invalidation:number;entry:number|null;targets:number[];quality:number;rules:string[];truncated?:boolean;strict?:boolean;};
export type ElliottResult={
 primary:WaveCount|null;alternative:WaveCount|null;correction:WaveCount|null;
 fib:{w2:number;w3:number;w4:number;w5:number}|null;
 fibLevels:{label:string;price:number}[]; channel:{a:number;b:number}|null;
 phase:string;score:number;confidence:number;
 setupState:"HISTORICAL"|"NONE";setupReason:string;
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

function impulseCandidates(c:Candle[],bull:boolean):WaveCount[]{
 const ps=pivots(c,2).slice(-22),out:WaveCount[]=[];
 if(ps.length<6)return out;
 for(let s=0;s<=ps.length-6;s++){
  const q=ps.slice(s,s+6),types=bull?["L","H","L","H","L","H"]:["H","L","H","L","H","L"];
  if(q.some((p,i)=>p.type!==types[i]))continue;
  const p=q.map(x=>x.price),w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]);
  if(!w1||!w2||!w3||!w4||!w5)continue;
  const r2=w2/w1,r3=w3/w1,r4=w4/w3,r5=w5/w1;
  const validation=validateImpulseWave(p,bull);
  if(!validation.valid)continue;
  let points=0;const rules:string[]=[];
  if(r2>=.382&&r2<=.786){points+=16;rules.push("Wave 2 retracement 38.2–78.6%")}else rules.push("Wave 2 outside common retracement");
  if(r3>=1){points+=18;rules.push("Wave 3 extends Wave 1")}else rules.push("Wave 3 weak");
  if(validation.w3NotShortest){points+=18;rules.push("Wave 3 is not shortest")}else rules.push("Wave 3 may be shortest");
  if(r4>=.236&&r4<=.618){points+=14;rules.push("Wave 4 retracement 23.6–61.8%")}else rules.push("Wave 4 outside common retracement");
  if(validation.w4Valid){points+=14;rules.push("Wave 4 avoids Wave 1 overlap")}else rules.push("Wave 4 overlap / invalid");
  if(r5>=.382&&r5<=2.618){points+=10;rules.push("Wave 5 projection plausible")}else rules.push("Wave 5 projection weak");
  if(validation.w5BeyondW3){points+=6;rules.push("Wave 5 exceeds Wave 3")}
  else if(validation.truncated){points-=6;rules.push("Wave 5 truncation candidate")}
  else rules.push("Wave 5 direction invalid");
  const alternatesDeep=(r2>=.5)!=(r4>=.5);
  if(alternatesDeep){points+=6;rules.push("Wave 2 / 4 depth alternation")}else rules.push("Wave 2 / 4 depth similarity");
  const internal3=internalImpulseSupport(c,q[2].index,q[3].index,bull);
  if(internal3>=6){points+=6;rules.push("Wave 3 internal pivot structure supports impulse")}
  else if(internal3>0)rules.push("Wave 3 internal structure weak / partial");
  const quality=clamp(points),dir=bull?1:-1;
  const entry=p[2],invalidation=p[0],risk=Math.abs(entry-invalidation);
  const targets=risk>0?[p[3],p[5],p[5]+dir*Math.max(w1,risk)*1.618]:[p[5]];
  out.push({
   points:q.map((x,i)=>({index:x.index,price:x.price,label:i===0?"":String(i)})),
   kind:"Impulse",direction:bull?"bullish":"bearish",invalidation,entry,targets,quality,rules,truncated:validation.truncated,strict:true
  });
 }
 return out;
}
export type ImpulseValidation={
 w2Valid:boolean;
 w3BeyondW1:boolean;
 w3NotShortest:boolean;
 w4Valid:boolean;
 w5DirectionValid:boolean;
 w5BeyondW3:boolean;
 truncated:boolean;
 valid:boolean;
};

export function validateImpulseWave(prices:number[],bull:boolean):ImpulseValidation{
 if(prices.length<6)return{w2Valid:false,w3BeyondW1:false,w3NotShortest:false,w4Valid:false,w5DirectionValid:false,w5BeyondW3:false,truncated:false,valid:false};
 const p=prices;
 const w1=Math.abs(p[1]-p[0]),w3=Math.abs(p[3]-p[2]),w5=Math.abs(p[5]-p[4]);
 const w2Valid=bull?p[2]>p[0]&&p[2]<p[1]:p[2]<p[0]&&p[2]>p[1];
 const w3BeyondW1=bull?p[3]>p[1]:p[3]<p[1];
 const w3NotShortest=w3>0&&w3>=w1&&w3>=w5;
 const w4Valid=bull?p[4]>p[1]&&p[4]<p[3]:p[4]<p[1]&&p[4]>p[3];
 const w5DirectionValid=bull?p[5]>p[4]:p[5]<p[4];
 const w5BeyondW3=bull?p[5]>p[3]:p[5]<p[3];
 const truncated=w5DirectionValid&&!w5BeyondW3;
 return{w2Valid,w3BeyondW1,w3NotShortest,w4Valid,w5DirectionValid,w5BeyondW3,truncated,valid:w2Valid&&w3BeyondW1&&w3NotShortest&&w4Valid&&w5DirectionValid};
}

function internalImpulseSupport(c:Candle[],start:number,end:number,bull:boolean):number{
 const ps=pivots(c,1).filter(p=>p.index>start&&p.index<end);
 if(ps.length<3)return 0;
 let alternating=0;
 for(let i=1;i<ps.length;i++)if(ps[i].type!==ps[i-1].type)alternating++;
 const directionPoints=ps.filter(p=>bull?p.type==="H":p.type==="L").length;
 return Math.min(10,Math.round(Math.min(ps.length,5)/5*6+(alternating>=Math.min(4,ps.length-1)?2:0)+(directionPoints>=2?2:0)));
}

function correctionCandidates(c:Candle[]):WaveCount[]{
 const ps=pivots(c,2).slice(-18),out:WaveCount[]=[];
 if(ps.length<3)return out;
 for(let s=0;s<=ps.length-3;s++){
  const q=ps.slice(s,s+3);
  const bear=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H";
  const bull=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L";
  if(!bull&&!bear)continue;
  const p=q.map(x=>x.price),ab=Math.abs(p[1]-p[0]),bc=Math.abs(p[2]-p[1]);
  if(!ab||!bc)continue;
  const ratio=bc/ab;
  const quality=clamp(50+(ratio>=.382&&ratio<=1.618?30:0)+(bc>=ab*.5?10:0)+(bc<=ab*1.618?10:0));
  const direction=bull?"bullish":"bearish";
  out.push({
   points:q.map((x,i)=>({index:x.index,price:x.price,label:["A","B","C"][i]})),
   kind:"Correction",direction,invalidation:p[0],entry:null,targets:[p[2]],
   quality,rules:[
    "A–B–C three-point correction candidate",
    ratio>=.382&&ratio<=1.618?"B/C proportion plausible":"B/C proportion outside common range"
   ]
  });
 }
 return out.sort((a,b)=>b.quality-a.quality||((b.points.at(-1)?.index??-1)-(a.points.at(-1)?.index??-1)));
}
export function analyzeElliott(c:Candle[]):ElliottResult{
 if(c.length<30)return{primary:null,alternative:null,correction:null,fib:null,fibLevels:[],channel:null,phase:"Insufficient data",score:0,confidence:0,setupState:"NONE",setupReason:"Insufficient closed-candle history"};
 const all=[...impulseCandidates(c,true),...impulseCandidates(c,false)].sort((a,b)=>b.quality-a.quality||((b.points.at(-1)?.index??-1)-(a.points.at(-1)?.index??-1)));
 const qualified=all.filter(x=>x.quality>=60);
 let primary=qualified[0]??null;
 let alternative=qualified.find(x=>x!==primary)??null;
 const correction=correctionCandidates(c)[0]??null;
 if(!primary){
  const ps=pivots(c,2).slice(-5);
  if(ps.length===5){
   const bull=ps[0].type==="L"&&ps[1].type==="H";
   const bear=ps[0].type==="H"&&ps[1].type==="L";
   if(bull||bear){
    const points=ps.map((x,i)=>({index:x.index,price:x.price,label:String(i+1)}));
    const entry=ps[2].price, invalidation=ps[0].price, dir=bull?1:-1, risk=Math.abs(entry-invalidation);
    alternative={points,kind:"Impulse",direction:bull?"bullish":"bearish",invalidation,entry,targets:risk>0?[ps[3].price,ps[4].price,ps[4].price+dir*Math.max(risk,Math.abs(ps[1].price-ps[0].price))*1.618]:[ps[4].price],quality:35,rules:["Fallback 1–5 pivot-sequence candidate; strict Elliott rules not confirmed"],strict:false};
   }
  }
 }
 if(!primary)return{primary:null,alternative,correction,fib:null,fibLevels:[],channel:null,phase:correction?"A–B–C correction candidate":"No strict 1–5 impulse candidate",score:0,confidence:0,setupState:"NONE",setupReason:"No qualified impulse count"};
 const p=primary.points.map(x=>x.price),w1=Math.abs(p[1]-p[0]),w2=Math.abs(p[2]-p[1]),w3=Math.abs(p[3]-p[2]),w4=Math.abs(p[4]-p[3]),w5=Math.abs(p[5]-p[4]),entry=primary.entry??p[2],dir=primary.direction==="bullish"?1:-1;
 const hi=Math.max(p[0],p[5]),lo=Math.min(p[0],p[5]),range=hi-lo;
 const fibLevels=[["0%",p[5]],["23.6%",p[5]+(p[0]-p[5])*.236],["38.2%",p[5]+(p[0]-p[5])*.382],["50%",p[5]+(p[0]-p[5])*.5],["61.8%",p[5]+(p[0]-p[5])*.618],["78.6%",p[5]+(p[0]-p[5])*.786],["100%",p[0]],["127.2%",p[5]+dir*range*.272],["161.8%",p[5]+dir*range*.618],["261.8%",p[5]+dir*range*1.618]].map(([label,price])=>({label:String(label),price:Number(price)}));
 const i2=primary.points[2].index,i3=primary.points[3].index,i4=primary.points[4].index;
 const channelSlope=(p[4]-p[2])/Math.max(i4-i2,1);
 const channel={a:p[3]-channelSlope*(i3-i2),b:p[3]};
 const phaseBase=primary.quality>=78?"1–5 impulse candidate · high rule conformance":primary.quality>=60?"1–5 impulse candidate · moderate rule conformance":"1–5 impulse candidate · low rule conformance";
 const phase=primary.truncated?phaseBase+" · Wave 5 truncation candidate":phaseBase;
 return{primary,alternative,correction,fib:{w2:+(w2/w1).toFixed(3),w3:+(w3/w1).toFixed(3),w4:+(w4/w3).toFixed(3),w5:+(w5/w1).toFixed(3)},fibLevels,channel,phase,score:primary.quality,confidence:primary.quality,setupState:"HISTORICAL",setupReason:"The primary 1–5 count is already complete; Entry is the historical Wave 2 termination, not a current executable setup"};
}
export function analyzeMTF(frames:{interval:string;candles:Candle[]}[]):MTFResult{
 const rows=frames.map(f=>{
  const available=f.candles.length>=25;
  if(!available)return{interval:f.interval,trend:"Neutral" as const,score:0,structure:"UNAVAILABLE",available:false,elliottTrend:"Neutral" as const,elliottScore:0,elliottPhase:"UNAVAILABLE"};
  const smc=analyzeSMC(f.candles),ew=analyzeElliott(f.candles);
  const elliottTrend=ew.primary?.direction==="bullish"?"Bullish":ew.primary?.direction==="bearish"?"Bearish":"Neutral";
  const smcSigned=smc.trend==="Bullish"?smc.score:smc.trend==="Bearish"?-smc.score:0;
  const ewSigned=elliottTrend==="Bullish"?ew.score:elliottTrend==="Bearish"?-ew.score:0;
  const signed=(smcSigned+ewSigned)/2;
  return{interval:f.interval,trend:signed>12?"Bullish":signed<-12?"Bearish":"Neutral",score:clamp(50+signed/2),structure:smc.events.at(-1)?.type??"No event",available:true,elliottTrend,elliottScore:ew.score,elliottPhase:ew.phase};
 });
 const usable=rows.filter(r=>r.available);
 const weight=(r:MTFFrame)=>r.interval==="4h"||r.interval==="1h"?1.4:1;
 const totalWeight=usable.reduce((sum,r)=>sum+weight(r),0);
 const weightedSigned=usable.reduce((sum,r)=>sum+(r.trend==="Bullish"?r.score:r.trend==="Bearish"?-r.score:0)*weight(r),0)/Math.max(1,totalWeight);
 const elliottSigned=usable.reduce((sum,r)=>sum+(r.elliottTrend==="Bullish"?r.elliottScore:r.elliottTrend==="Bearish"?-r.elliottScore:0)*weight(r),0)/Math.max(1,totalWeight);
 return{
  trend:usable.length?(weightedSigned>50?"Bullish":weightedSigned<50?"Bearish":"Neutral"):"Neutral",
  score:usable.length?clamp(weightedSigned):0,
  elliottTrend:usable.length?(elliottSigned>12?"Bullish":elliottSigned<-12?"Bearish":"Neutral"):"Neutral",
  elliottScore:usable.length?clamp(50+elliottSigned/2):0,
  frames:rows
 };
}

