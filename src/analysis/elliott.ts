import type { Candle, ElliottResult, Pivot, WaveCount, WavePoint } from "./engine";

export type ElliottPattern =
  | "Impulse"
  | "Leading Diagonal"
  | "Ending Diagonal"
  | "Zigzag"
  | "Flat"
  | "Triangle"
  | "Correction";

export type ElliottDegree = "Micro" | "Minor" | "Intermediate" | "Primary";
export type ElliottCountState = "HISTORICAL" | "INVALIDATED" | "NONE";

export type NestedWaveEvidence = {
  wave: "3" | "5" | "C";
  subwaves: number;
  alternating: boolean;
  directionAligned: boolean;
  score: number;
};

export type AdvancedElliottResult = ElliottResult & {
  pattern: ElliottPattern | "None";
  degree: ElliottDegree | "—";
  countState: ElliottCountState;
  activeWave: "Wave 1" | "Wave 2" | "Wave 3" | "Wave 4" | "Wave 5" | "A" | "B" | "C" | "None";
  candidateCount: number;
  correctionCandidates: number;
  nested: NestedWaveEvidence[];
  correctionPattern: "Zigzag" | "Flat" | "Triangle" | "None";
  engine: "ADVANCED_ELLIOTT_V2";
};

const EMPTY = (reason:string):AdvancedElliottResult => ({
  primary: null,
  alternative: null,
  correction: null,
  fib: null,
  fibLevels: [],
  channel: null,
  phase: reason === "Insufficient closed-candle history" ? "Insufficient data" : "No qualified Elliott count",
  score: 0,
  confidence: 0,
  setupState: "NONE",
  setupReason: reason,
  pattern: "None",
  degree: "—",
  countState: "NONE",
  activeWave: "None",
  candidateCount: 0,
  correctionCandidates: 0,
  nested: [],
  correctionPattern: "None",
  engine: "ADVANCED_ELLIOTT_V2"
});

function clamp(n:number){ return Math.max(0, Math.min(100, Math.round(n))); }
function abs(n:number){ return Math.abs(n); }
function safeRatio(a:number,b:number){ return Math.abs(b)>1e-12 ? Math.abs(a/b) : Infinity; }
function inRange(v:number,lo:number,hi:number){ return v>=lo && v<=hi; }

function swingPivots(c:Candle[], w=2):Pivot[]{
  const out:Pivot[]=[];
  for(let i=w;i<c.length-w;i++){
    let isHigh=true,isLow=true,hs=0,ls=0;
    for(let j=i-w;j<=i+w;j++){
      if(j===i)continue;
      if(c[j].high>=c[i].high)isHigh=false;
      if(c[j].low<=c[i].low)isLow=false;
      hs+=Math.max(0,c[i].high-c[j].high);
      ls+=Math.max(0,c[j].low-c[i].low);
    }
    if(isHigh&&isLow){ if(hs>=ls)isLow=false; else isHigh=false; }
    const d=Math.max(1,2*w+1);
    if(isHigh)out.push({index:i,price:c[i].high,type:"H",strength:hs/d,confirmedAt:i+w});
    if(isLow)out.push({index:i,price:c[i].low,type:"L",strength:ls/d,confirmedAt:i+w});
  }
  return out;
}

function alternatePivots(ps:Pivot[]):Pivot[]{
  const out:Pivot[]=[];
  for(const p of ps.slice().sort((a,b)=>a.index-b.index)){
    const last=out.at(-1);
    if(!last){out.push(p);continue;}
    if(last.type!==p.type){out.push(p);continue;}
    const keep=p.type==="H"?p.price>last.price:p.price<last.price;
    if(keep)out[out.length-1]=p;
  }
  return out;
}

function sequencePoints(q:Pivot[]):WavePoint[]{
  return q.map((p,i)=>({index:p.index,price:p.price,label:String(i)}));
}

function internalEvidence(c:Candle[],start:number,end:number,bullish:boolean):NestedWaveEvidence{
  const ps=alternatePivots(swingPivots(c,1).filter(p=>p.index>start&&p.index<end));
  let alternating=true;
  for(let i=1;i<ps.length;i++)if(ps[i].type===ps[i-1].type)alternating=false;
  const directionAligned=ps.length>0
    ? (bullish ? ps.filter(p=>p.type==="H").length : ps.filter(p=>p.type==="L").length) >= Math.ceil(ps.length/2)
    : false;
  const subwaves=ps.length;
  const score=clamp((Math.min(subwaves,5)/5)*70+(alternating?15:0)+(directionAligned?15:0));
  return{wave:"3",subwaves,alternating,directionAligned,score};
}

function inferDegree(spanBars:number,totalBars:number):ElliottDegree{
  const r=spanBars/Math.max(totalBars,1);
  if(r<=.18)return "Micro";
  if(r<=.42)return "Minor";
  if(r<=.72)return "Intermediate";
  return "Primary";
}

function extensionProfile(w1:number,w3:number,w5:number){
  const base=Math.min(w1,w3,w5);
  if(base<=0)return{count:3,plausible:false};
  const count=[w1,w3,w5].filter(x=>x/base>=1.618).length;
  return{count,plausible:count<=2};
}

export type StandardImpulseValidation={
  w2Valid:boolean; w3BeyondW1:boolean; w3NotShortest:boolean; w4Valid:boolean;
  w5DirectionValid:boolean; w5BeyondW3:boolean; truncated:boolean; valid:boolean;
};

export function validateStandardImpulse(prices:number[],bull:boolean):StandardImpulseValidation{
  if(prices.length<6)return{w2Valid:false,w3BeyondW1:false,w3NotShortest:false,w4Valid:false,w5DirectionValid:false,w5BeyondW3:false,truncated:false,valid:false};
  const [p0,p1,p2,p3,p4,p5]=prices;
  const w1=abs(p1-p0),w3=abs(p3-p2),w5=abs(p5-p4);
  const w2Valid=bull?p2>p0&&p2<p1:p2<p0&&p2>p1;
  const w3BeyondW1=bull?p3>p1:p3<p1;
  const w3NotShortest=w3>=w1&&w3>=w5;
  const w4Valid=bull?p4>p1&&p4<p3:p4<p1&&p4>p3;
  const w5DirectionValid=bull?p5>p4:p5<p4;
  const w5BeyondW3=bull?p5>p3:p5<p3;
  const truncated=w5DirectionValid&&!w5BeyondW3;
  return{w2Valid,w3BeyondW1,w3NotShortest,w4Valid,w5DirectionValid,w5BeyondW3,truncated,valid:w2Valid&&w3BeyondW1&&w3NotShortest&&w4Valid&&w5DirectionValid};
}

function impulseCandidate(c:Candle[],q:Pivot[],bull:boolean):WaveCount|null{
  const p=q.map(x=>x.price);
  const v=validateStandardImpulse(p,bull);
  if(!v.valid)return null;
  const w1=abs(p[1]-p[0]),w2=abs(p[2]-p[1]),w3=abs(p[3]-p[2]),w4=abs(p[4]-p[3]),w5=abs(p[5]-p[4]);
  const r2=safeRatio(w2,w1),r3=safeRatio(w3,w1),r4=safeRatio(w4,w3),r5=safeRatio(w5,w1);
  let score=52;
  const rules:string[]=[];
  if(inRange(r2,.236,.786)){score+=9;rules.push("Wave 2 retracement is inside 23.6–78.6%");}else rules.push("Wave 2 retracement is outside the common Fibonacci zone");
  if(r3>=1){score+=9;rules.push("Wave 3 extends Wave 1");}
  if(v.w3NotShortest){score+=8;rules.push("Wave 3 is not the shortest actionary wave");}
  if(inRange(r4,.236,.618)){score+=7;rules.push("Wave 4 depth is plausible");}else rules.push("Wave 4 depth is atypical but structural rule passes");
  if(v.w4Valid){score+=7;rules.push("Wave 4 does not overlap Wave 1 price territory");}
  if(r5>=.382&&r5<=2.618){score+=5;rules.push("Wave 5 projection is plausible");}else rules.push("Wave 5 projection is outside the common range");
  if(v.truncated){score-=2;rules.push("Wave 5 is truncated; structurally valid but less typical");}
  else if(v.w5BeyondW3)rules.push("Wave 5 reaches beyond Wave 3");
  const w2Complexity=swingPivots(c,1).filter(x=>x.index>q[1].index&&x.index<q[2].index).length;
  const w4Complexity=swingPivots(c,1).filter(x=>x.index>q[3].index&&x.index<q[4].index).length;
  if((r2<.5)!=(r4>.5)||(w2Complexity<=2)!=(w4Complexity<=2)){score+=4;rules.push("Wave 2 / 4 alternation supported by depth or structure");}
  else rules.push("Wave 2 / 4 alternation is weak");
  const ext=extensionProfile(w1,w3,w5);
  if(ext.plausible){score+=4;rules.push("Actionary-wave extension profile is plausible");}else{score-=3;rules.push("All three actionary waves look extended; degree may be misidentified");}
  const nested=internalEvidence(c,q[2].index,q[3].index,bull);
  if(nested.score>=60){score+=5;rules.push("Wave 3 contains supporting internal swing structure");}else rules.push("Wave 3 internal subdivision is limited in available history");
  const dir=bull?1:-1,entry=p[2],invalidation=p[0],risk=abs(entry-invalidation);
  return{
    points:sequencePoints(q),kind:"Impulse",direction:bull?"bullish":"bearish",
    invalidation,entry,targets:risk>0?[p[3],p[5],p[5]+dir*Math.max(w1,risk)*1.618]:[p[5]],
    quality:clamp(score),rules,truncated:v.truncated,strict:true
  };
}

export function validateZigzag(prices:number[],bullishCorrection:boolean){
  if(prices.length<4)return{valid:false,bRetracement:0,cProjection:0};
  const [x,a,b,c]=prices,xa=Math.abs(a-x),ab=Math.abs(b-a),bc=Math.abs(c-b);
  if(xa<=0||ab<=0||bc<=0)return{valid:false,bRetracement:0,cProjection:0};
  const bRetracement=ab/xa,cProjection=bc/ab;
  const structure=bullishCorrection?c>b&&b>a:a>b&&b<a;
  const bWithinA=bullishCorrection?b<a:b>a;
  const valid=structure&&bWithinA&&bRetracement>=.382&&bRetracement<=.786&&cProjection>=.618;
  return{valid,bRetracement,cProjection};
}

export function validateFlat(prices:number[],bullishCorrection:boolean){
  if(prices.length<4)return{valid:false,bRetracement:0,cProjection:0};
  const [x,a,b,c]=prices,xa=Math.abs(a-x),ab=Math.abs(b-a),bc=Math.abs(c-b);
  if(xa<=0||ab<=0||bc<=0)return{valid:false,bRetracement:0,cProjection:0};
  const bRetracement=ab/xa,cProjection=bc/ab;
  const directionStructure=bullishCorrection?c<a:c>a;
  const valid=bRetracement>=.9&&bRetracement<=1.1&&cProjection>=.618&&cProjection<=1.618&&directionStructure;
  return{valid,bRetracement,cProjection};
}

export function validateTriangle(prices:number[],bullish:boolean){
  if(prices.length<5)return{valid:false,contracting:false,expanding:false};
  const seg=prices.slice(1).map((p,i)=>Math.abs(p-prices[i]));
  const contracting=seg[0]>seg[1]&&seg[1]>seg[2]&&seg[2]>seg[3];
  const expanding=seg[0]<seg[1]&&seg[1]<seg[2]&&seg[2]<seg[3];
  const highs=prices.filter((_,i)=>i%2===0);
  const lows=prices.filter((_,i)=>i%2===1);
  const upperSlope=highs.length>=2?highs.at(-1)!-highs[0]:0;
  const lowerSlope=lows.length>=2?lows.at(-1)!-lows[0]:0;
  const converging=upperSlope<0&&lowerSlope>0 || upperSlope>0&&lowerSlope<0 || (Math.abs(upperSlope)<1e-12&&Math.abs(lowerSlope)<1e-12);
  const valid=(contracting||expanding||converging)&&Math.abs(prices.at(-1)!-prices[0])<Math.abs(prices[1]-prices[0]);
  return{valid,contracting,expanding};
}

function correctionCandidates(c:Candle[]){
  const ps=alternatePivots(swingPivots(c,2)),out:(WaveCount & {pattern:ElliottPattern})[]=[];
  for(let i=0;i<=ps.length-4;i++){
    const q=ps.slice(i,i+4),bullish=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H"&&q[3].type==="L",bearish=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L"&&q[3].type==="H";
    if(!bullish&&!bearish)continue;
    const p=q.map(x=>x.price),isBullishCorrection=bearish,z=validateZigzag(p,isBullishCorrection),f=validateFlat(p,isBullishCorrection);
    const abc=q.slice(1);
    if(z.valid)out.push({points:sequencePoints(abc).map((x,j)=>({...x,label:["A","B","C"][j]})),kind:"Correction",direction:isBullishCorrection?"bullish":"bearish",invalidation:q[0].price,entry:null,targets:[q[3].price],quality:80,rules:["A–B–C zigzag geometry","B retraces 38.2–78.6% of X–A","C reaches at least 61.8% of A–B"],strict:false,pattern:"Zigzag"});
    else if(f.valid)out.push({points:sequencePoints(abc).map((x,j)=>({...x,label:["A","B","C"][j]})),kind:"Correction",direction:isBullishCorrection?"bullish":"bearish",invalidation:q[0].price,entry:null,targets:[q[3].price],quality:74,rules:["A–B–C flat geometry","B retraces roughly 90–110% of X–A","C length is inside a common flat range"],strict:false,pattern:"Flat"});
  }
  for(let i=0;i<=ps.length-5;i++){
    const q=ps.slice(i,i+5),bullish=q[0].type==="L"&&q[1].type==="H",bearish=q[0].type==="H"&&q[1].type==="L";
    if(!bullish&&!bearish)continue;
    const p=q.map(x=>x.price),tri=validateTriangle(p,bullish);
    if(!tri.valid)continue;
    out.push({points:sequencePoints(q).map((x,j)=>({...x,label:["A","B","C","D","E"][j]})),kind:"Correction",direction:bullish?"bullish":"bearish",invalidation:q[0].price,entry:null,targets:[q[4].price],quality:tri.contracting?82:68,rules:["A–B–C–D–E triangle candidate",tri.contracting?"Contracting triangle proportions detected":"Triangle boundary convergence detected"],strict:false,pattern:"Triangle"});
  }
  return out.sort((a,b)=>b.quality-a.quality||((b.points.at(-1)?.index??-1)-(a.points.at(-1)?.index??-1)));
}

function correctionCandidates(c:Candle[]){
  const ps=alternatePivots(swingPivots(c,2)),out:(WaveCount & {pattern:ElliottPattern})[]=[];
  for(let i=0;i<=ps.length-3;i++){
    const q=ps.slice(i,i+3),bullish=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L",bearish=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H";
    if(!bullish&&!bearish)continue;
    const p=q.map(x=>x.price),z=validateZigzag(p,bullish),f=validateFlat(p,bullish);
    if(z.valid)out.push({points:sequencePoints(q).map((x,j)=>({...x,label:["A","B","C"][j]})),kind:"Correction",direction:bullish?"bullish":"bearish",invalidation:q[0].price,entry:null,targets:[q[2].price],quality:78,rules:["A–B–C zigzag geometry","B remains within the A leg","C reaches at least 61.8% of A"],strict:false,pattern:"Zigzag"});
    else if(f.valid)out.push({points:sequencePoints(q).map((x,j)=>({...x,label:["A","B","C"][j]})),kind:"Correction",direction:bullish?"bullish":"bearish",invalidation:q[0].price,entry:null,targets:[q[2].price],quality:72,rules:["A–B–C flat geometry","B retraces roughly 90–110% of A","C length is inside a common flat range"],strict:false,pattern:"Flat"});
  }
  for(let i=0;i<=ps.length-5;i++){
    const q=ps.slice(i,i+5),bullish=q[0].type==="L"&&q[1].type==="H",bearish=q[0].type==="H"&&q[1].type==="L";
    if(!bullish&&!bearish)continue;
    const p=q.map(x=>x.price),tri=validateTriangle(p,bullish);
    if(!tri.valid)continue;
    out.push({points:sequencePoints(q).map((x,j)=>({...x,label:["A","B","C","D","E"][j]})),kind:"Correction",direction:bullish?"bullish":"bearish",invalidation:q[0].price,entry:null,targets:[q[4].price],quality:tri.contracting?82:68,rules:["A–B–C–D–E triangle candidate",tri.contracting?"Contracting triangle proportions detected":"Expanding triangle proportions detected"],strict:false,pattern:"Triangle"});
  }
  return out.sort((a,b)=>b.quality-a.quality||((b.points.at(-1)?.index??-1)-(a.points.at(-1)?.index??-1)));
}

function diagonalCandidates(c:Candle[],bull:boolean){
  const ps=alternatePivots(swingPivots(c,2)),out:WaveCount[]=[];
  for(let i=0;i<=ps.length-6;i++){
    const q=ps.slice(i,i+6),types=bull?["L","H","L","H","L","H"]:["H","L","H","L","H","L"];
    if(q.some((p,j)=>p.type!==types[j]))continue;
    const [p0,p1,p2,p3,p4,p5]=q.map(x=>x.price);
    const w1=abs(p1-p0),w2=abs(p2-p1),w3=abs(p3-p2),w4=abs(p4-p3),w5=abs(p5-p4);
    const w2Valid=bull?p2>p0&&p2<p1:p2<p0&&p2>p1;
    const w3BeyondW1=bull?p3>p1:p3<p1;
    const overlap=bull?p4<=p1&&p4>p2:p4>=p1&&p4<p2;
    const w4NotPassW2=bull?p4>p2:p4<p2;
    const w5Direction=bull?p5>p4:p5<p4;
    const w3NotShortest=w3>=w5;
    if(!(w1>0&&w2>0&&w2Valid&&w3BeyondW1&&overlap&&w4NotPassW2&&w3NotShortest&&w5Direction))continue;
    const contracting=w3<w1&&w4<w2&&w5<w3,expanding=w3>w1&&w4>w2&&w5>w3;
    const symmetry=1-Math.min(1,abs(w3/w1-w5/w3));
    let quality=60+(contracting||expanding?13:5)+Math.round(symmetry*8);
    const nested=internalEvidence(c,q[2].index,q[3].index,bull);
    if(nested.score>=60)quality+=5;
    const dir=bull?1:-1,risk=abs(p2-p0);
    out.push({
      points:sequencePoints(q),kind:"Diagonal",direction:bull?"bullish":"bearish",invalidation:p0,entry:p2,
      targets:risk>0?[p3,p5,p5+dir*Math.max(w1,risk)*1.618]:[p5],quality:clamp(quality),
      rules:["Wave 4 overlaps Wave 1 — diagonal structure allowed","Wave 3 is not the shortest actionary wave",
        contracting?"Contracting diagonal geometry":expanding?"Expanding diagonal geometry":"Mixed diagonal geometry",
        "Leading/ending role requires higher-degree context"],strict:true
    });
  }
  return out;
}

function buildFib(prices:number[],bull:boolean){
  if(prices.length<6)return[];
  const p=prices,dir=bull?1:-1,range=abs(p[5]-p[0]);
  return[
    ["0%",p[5]],["23.6%",p[5]+(p[0]-p[5])*.236],["38.2%",p[5]+(p[0]-p[5])*.382],
    ["50%",p[5]+(p[0]-p[5])*.5],["61.8%",p[5]+(p[0]-p[5])*.618],["78.6%",p[5]+(p[0]-p[5])*.786],
    ["100%",p[0]],["127.2%",p[5]+dir*range*.272],["161.8%",p[5]+dir*range*.618],["261.8%",p[5]+dir*range*1.618]
  ].map(([label,price])=>({label:String(label),price:Number(price)}));
}

export function analyzeElliottAdvanced(c:Candle[]):AdvancedElliottResult{
  if(c.length<30)return EMPTY("Insufficient closed-candle history");
  const ps=alternatePivots(swingPivots(c,2));
  const corrections=correctionCandidates(c);
  const action:WaveCount[]=[
    ...[true,false].flatMap(bull=>{
      const out:WaveCount[]=[];
      for(let i=0;i<=ps.length-6;i++){
        const q=ps.slice(i,i+6),types=bull?["L","H","L","H","L","H"]:["H","L","H","L","H","L"];
        if(q.some((p,j)=>p.type!==types[j]))continue;
        const candidate=impulseCandidate(c,q,bull);
        if(candidate)out.push(candidate);
      }
      return out;
    }),
    ...diagonalCandidates(c,true),...diagonalCandidates(c,false)
  ];
  const ranked=action
    .sort((a,b)=>b.quality-a.quality||((b.points.at(-1)?.index??-1)-(a.points.at(-1)?.index??-1)))
    .filter((x,i,a)=>i===a.findIndex(y=>y.points.map(p=>p.index).join(",")===x.points.map(p=>p.index).join(",")));
  const primary=ranked.find(x=>x.quality>=60)??null;
  const alternative=ranked.find(x=>x!==primary&&x.quality>=55)??null;
  const correction=corrections[0]??null;

  if(!primary){
    const r=EMPTY(correction?"No complete 1–5 count; correction candidate is the strongest completed structure":"No qualified Elliott count");
    r.alternative=alternative;
    r.correction=correction;
    r.candidateCount=action.length;
    r.correctionCandidates=corrections.length;
    r.phase=correction ? correction.pattern + " correction candidate" : "No qualified Elliott count";
    r.pattern=correction?.pattern??"Correction";
    r.correctionPattern=(correction?.pattern==="Zigzag"||correction?.pattern==="Flat"||correction?.pattern==="Triangle")?correction.pattern:"None";
    r.activeWave=correction ? (String(correction.points.at(-1)?.label||"C") as AdvancedElliottResult["activeWave"]) : "None";
    return r;
  }

  const prices=primary.points.map(p=>p.price);
  const w1=abs(prices[1]-prices[0]),w2=abs(prices[2]-prices[1]),w3=abs(prices[3]-prices[2]),w4=abs(prices[4]-prices[3]),w5=abs(prices[5]-prices[4]);
  const fibLevels=buildFib(prices,primary.direction==="bullish");
  const nested3=internalEvidence(c,primary.points[2].index,primary.points[3].index,primary.direction==="bullish");
  const nested5=internalEvidence(c,primary.points[4].index,primary.points[5].index,primary.direction==="bullish");
  nested3.wave="3"; nested5.wave="5";
  const nested=[nested3,nested5];
  const degree=inferDegree((primary.points.at(-1)?.index??0)-(primary.points[0]?.index??0),c.length);
  const lastClose=c.at(-1)?.close??prices[5];
  const invalidated=primary.direction==="bullish"?lastClose<=prices[0]:lastClose>=prices[0];
  const setupState:ElliottCountState=invalidated?"INVALIDATED":"HISTORICAL";
  const pattern:AdvancedElliottResult["pattern"]=primary.kind==="Impulse" ? "Impulse" : "Diagonal";
  const confidence=clamp(primary.quality-(nested3.score<45?8:0)+(nested5.score>=60?4:0));
  const channelSlope=(prices[4]-prices[2])/Math.max(primary.points[4].index-primary.points[2].index,1);
  const channel={a:prices[3]-channelSlope*(primary.points[3].index-primary.points[2].index),b:prices[3]};
  const phase=invalidated
    ? pattern + " · " + degree + " · INVALIDATED"
    : pattern + " · " + degree + " · completed historical count";
  const setupReason=invalidated
    ? "Closed price crossed the Wave 1 origin; the completed count is invalidated in hindsight"
    : "Completed count is historical; the engine does not convert it into a live entry signal";
  return{
    primary,alternative,correction,
    fib:{
      w2:+safeRatio(w2,w1).toFixed(3),
      w3:+safeRatio(w3,w1).toFixed(3),
      w4:+safeRatio(w4,w3).toFixed(3),
      w5:+safeRatio(w5,w1).toFixed(3)
    },
    fibLevels,channel,phase,score:primary.quality,confidence,setupState,
    setupReason,pattern,degree,countState:setupState,activeWave:"Wave 5",
    candidateCount:action.length,correctionCandidates:corrections.length,nested,
    correctionPattern:(correction?.pattern==="Zigzag"||correction?.pattern==="Flat"||correction?.pattern==="Triangle")?correction.pattern:"None",engine:"ADVANCED_ELLIOTT_V2"
  };
}
