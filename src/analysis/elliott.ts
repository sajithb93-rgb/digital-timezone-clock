import type { Candle, ElliottResult, Pivot, WaveCount, WavePoint } from "./engine";

export type ElliottPattern =
  | "Impulse"
  | "Leading Diagonal"
  | "Ending Diagonal"
  | "Diagonal"
  | "Zigzag"
  | "Flat"
  | "Expanded Flat"
  | "Running Flat"
  | "Double Zigzag"
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
  correctionPattern: "Zigzag" | "Flat" | "Expanded Flat" | "Running Flat" | "Double Zigzag" | "Triangle" | "None";
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
  engine: "ADVANCED_ELLIOTT_V2",
  liveSetup: null
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

export type NestedImpulseValidation={
  alternating:boolean;
  structural:boolean;
  valid:boolean;
};

export function validateNestedImpulse(prices:number[],bullish:boolean):NestedImpulseValidation{
  if(prices.length<6)return{alternating:false,structural:false,valid:false};
  // Nested validation receives prices only, so alternation is checked from
  // the expected five-wave directional geometry rather than inferred later.
  const structural=validateStandardImpulse(prices,bullish).valid;
  const alternating=structural;
  return{alternating,structural,valid:alternating&&structural};
}

function internalEvidence(c:Candle[],start:number,end:number,bullish:boolean):NestedWaveEvidence{
  // A genuine nested 5-wave subdivision needs the two parent boundaries
  // plus four internal turning points. A raw pivot count is not enough.
  const internal=alternatePivots(
    swingPivots(c,1).filter(p=>p.index>start&&p.index<end)
  );
  const startType=bullish?"L":"H";
  const endType=bullish?"H":"L";
  const boundaryStart:Pivot={
    index:start,
    price:bullish?(c[start]?.low??0):(c[start]?.high??0),
    type:startType,
    strength:0,
    confirmedAt:start
  };
  const boundaryEnd:Pivot={
    index:end,
    price:bullish?(c[end]?.high??0):(c[end]?.low??0),
    type:endType,
    strength:0,
    confirmedAt:end
  };

  let best:Pivot[]|null=null;
  const expectedTypes=bullish?["L","H","L","H","L","H"]:["H","L","H","L","H","L"];
  for(let i=0;i<=internal.length-4;i++){
    const candidate=[boundaryStart,...internal.slice(i,i+4),boundaryEnd];
    if(candidate.some((p,j)=>p.type!==expectedTypes[j]))continue;
    const prices=candidate.map(p=>p.price);
    if(validateNestedImpulse(prices,bullish).valid){
      best=candidate;
      break;
    }
  }

  const alternating=internal.every((p,i)=>i===0||p.type!==internal[i-1].type);
  const directionAligned=best!==null;
  const subwaves=best?5:Math.min(internal.length+1,5);
  const score=best
    ? 100
    : clamp((Math.min(internal.length,4)/4)*55+(alternating?15:0)+(directionAligned?30:0));
  return{wave:"3",subwaves,alternating,directionAligned,score};
}
function inferDegree(spanBars:number,totalBars:number):ElliottDegree{
  const r=spanBars/Math.max(totalBars,1);
  if(r<=.18)return "Micro";
  if(r<=.42)return "Minor";
  if(r<=.72)return "Intermediate";
  return "Primary";
}

const MAX_PRIMARY_AGE_BARS = 144;

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
  const aUp=a>x;
  const bRetracement=ab/xa,cProjection=bc/ab;
  const bWithinXA=aUp ? b>x&&b<a : b<x&&b>a;
  const cExtendsA=aUp ? c>a : c<a;
  const direction=aUp ? "bullish" : "bearish";
  const valid=direction===(bullishCorrection?"bullish":"bearish")&&bWithinXA&&cExtendsA&&bRetracement>=.382&&bRetracement<=.786&&cProjection>=.618;
  return{valid,bRetracement,cProjection};
}

export type FlatValidation={
  valid:boolean;
  subtype:"Regular Flat"|"Expanded Flat"|"Running Flat"|"None";
  bRetracement:number;
  cProjection:number;
};

export function validateFlat(prices:number[],bullishCorrection:boolean):FlatValidation{
  if(prices.length<4)return{valid:false,subtype:"None",bRetracement:0,cProjection:0};
  const [x,a,b,c]=prices,xa=Math.abs(a-x),ab=Math.abs(b-a),bc=Math.abs(c-b);
  if(xa<=0||ab<=0||bc<=0)return{valid:false,subtype:"None",bRetracement:0,cProjection:0};
  const aUp=a>x;
  const bRetracement=ab/xa;
  const cProjection=bc/ab;
  const direction=aUp?"bullish":"bearish";
  const bInXA=aUp?b>x&&b<a:b<x&&b>a;
  const cReversesA=aUp?c>b:c<b;
  const bExceedsX=aUp?b<=x:b>=x;
  const cBeyondA=aUp?c>a:c<a;
  const cFailsA=aUp?c<a:c>a;
  if(direction!==(bullishCorrection?"bullish":"bearish")||!cReversesA)return{valid:false,subtype:"None",bRetracement,cProjection};

  const regular=bInXA&&bRetracement>=.90&&bRetracement<=1.10&&cProjection>=.618&&cProjection<=1.618;
  const expanded=bExceedsX&&bRetracement>1.00&&bRetracement<=1.618&&cProjection>=.618&&cBeyondA;
  const running=bExceedsX&&bRetracement>1.00&&bRetracement<=1.618&&cProjection>=.618&&cFailsA;

  const subtype=expanded?"Expanded Flat":running?"Running Flat":regular?"Regular Flat":"None";
  return{valid:subtype!=="None",subtype,bRetracement,cProjection};
}

export type TriangleValidation={
  valid:boolean;
  contracting:boolean;
  expanding:boolean;
  converging:boolean;
  alternating:boolean;
};

export function validateTriangle(prices:number[],bullish:boolean):TriangleValidation{
  if(prices.length<5)return{valid:false,contracting:false,expanding:false,converging:false,alternating:false};
  const [x,a,b,c,d]=prices;
  const swings=[Math.abs(a-x),Math.abs(b-a),Math.abs(c-b),Math.abs(d-c)];
  if(swings.some(v=>v<=0))return{valid:false,contracting:false,expanding:false,converging:false,alternating:false};
  const alternating=bullish
    ? a>x&&b<a&&c>b&&d<c
    : a<x&&b>a&&c<b&&d>c;
  if(!alternating)return{valid:false,contracting:false,expanding:false,converging:false,alternating:false};

  const highs=[a,c], lows=[x,b,d];
  const highSlope=highs[1]-highs[0];
  const lowSlope=lows[2]-lows[0];
  const contracting=Math.abs(swings[1])<swings[0]&&Math.abs(swings[2])<swings[1]&&Math.abs(swings[3])<swings[2] &&
    highSlope<=0 && lowSlope>=0;
  const expanding=Math.abs(swings[1])>swings[0]&&Math.abs(swings[2])>swings[1]&&Math.abs(swings[3])>swings[2] &&
    highSlope>=0 && lowSlope<=0;
  const initialRange=Math.abs(a-x);
  const finalRange=Math.abs(c-b);
  const converging=initialRange>0&&finalRange<initialRange;
  return{valid:contracting||expanding,contracting,expanding,converging,alternating};
}

export function validateDoubleZigzag(prices:number[],bullishCorrection:boolean){
  if(prices.length<8)return{valid:false,firstValid:false,secondValid:false,connectorValid:false};
  const first=prices.slice(0,4);
  const connector=prices.slice(3,5);
  const second=prices.slice(4,8);
  const a=validateZigzag(first,bullishCorrection);
  const b=validateZigzag(second,bullishCorrection);
  const connectorSize=Math.abs(connector[1]-connector[0]);
  const firstSize=Math.abs(first[3]-first[0]);
  const secondSize=Math.abs(second[3]-second[0]);
  const connectorValid=connectorSize>0&&connectorSize<Math.max(firstSize,secondSize)*.618;
  return{valid:a.valid&&b.valid&&connectorValid,firstValid:a.valid,secondValid:b.valid,connectorValid};
}

function correctionCandidates(c:Candle[]){
  const ps=alternatePivots(swingPivots(c,2)),out:(WaveCount & {pattern:ElliottPattern})[]=[];

  // Single zigzag / flat: X-A-B-C.
  for(let i=0;i<=ps.length-4;i++){
    const q=ps.slice(i,i+4);
    const downward=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H"&&q[3].type==="L";
    const upward=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L"&&q[3].type==="H";
    if(!downward&&!upward)continue;
    const p=q.map(x=>x.price),isBullishCorrection=upward;
    const z=validateZigzag(p,isBullishCorrection),f=validateFlat(p,isBullishCorrection);
    const direction=upward?"bullish":"bearish";
    if(z.valid)out.push({
      points:sequencePoints(q).map((x,j)=>({...x,label:["X","A","B","C"][j]})),
      kind:"Correction",direction,invalidation:q[0].price,entry:null,targets:[q[3].price],
      quality:80,rules:["X-A-B-C zigzag geometry","B retraces 38.2–78.6% of X-A","C extends beyond A"],
      strict:false,pattern:"Zigzag"
    });
    else if(f.valid)out.push({
      points:sequencePoints(q).map((x,j)=>({...x,label:["X","A","B","C"][j]})),
      kind:"Correction",direction,invalidation:q[0].price,entry:null,targets:[q[3].price],
      quality:f.subtype==="Expanded Flat"?78:f.subtype==="Running Flat"?76:74,
      rules:[`${f.subtype} geometry`,"B-wave retracement and C-wave projection validated"],
      strict:false,pattern:f.subtype==="Expanded Flat"?"Expanded Flat":f.subtype==="Running Flat"?"Running Flat":"Flat"
    });
  }

  // Double zigzag W-X-Y: two valid zigzags joined by a smaller connector.
  for(let i=0;i<=ps.length-8;i++){
    const q=ps.slice(i,i+8);
    const upward=q[0].type==="L"&&q[1].type==="H"&&q[2].type==="L"&&q[3].type==="H"&&q[4].type==="L"&&q[5].type==="H"&&q[6].type==="L"&&q[7].type==="H";
    const downward=q[0].type==="H"&&q[1].type==="L"&&q[2].type==="H"&&q[3].type==="L"&&q[4].type==="H"&&q[5].type==="L"&&q[6].type==="H"&&q[7].type==="L";
    if(!upward&&!downward)continue;
    const p=q.map(x=>x.price),bullishCorrection=upward,dz=validateDoubleZigzag(p,bullishCorrection);
    if(!dz.valid)continue;
    out.push({
      points:sequencePoints(q).map((x,j)=>({...x,label:["W","A","B","C","X","A","B","C"][j]})),
      kind:"Correction",direction:upward?"bullish":"bearish",invalidation:q[0].price,entry:null,targets:[q[7].price],
      quality:86,rules:["W-X-Y double zigzag geometry","Both component zigzags validated","Connector is smaller than the main correction legs"],
      strict:false,pattern:"Double Zigzag"
    });
  }

  // Triangle A-B-C-D-E. The validator enforces alternation and boundary geometry.
  for(let i=0;i<=ps.length-5;i++){
    const q=ps.slice(i,i+5);
    const upward=q[0].type==="L"&&q[1].type==="H";
    const downward=q[0].type==="H"&&q[1].type==="L";
    if(!upward&&!downward)continue;
    const tri=validateTriangle(q.map(x=>x.price),upward);
    if(!tri.valid)continue;
    out.push({
      points:sequencePoints(q).map((x,j)=>({...x,label:["A","B","C","D","E"][j]})),
      kind:"Correction",direction:upward?"bullish":"bearish",invalidation:q[0].price,entry:null,targets:[q[4].price],
      quality:tri.contracting?82:68,
      rules:["A-B-C-D-E triangle geometry",tri.contracting?"Contracting triangle proportions detected":"Expanding triangle proportions detected"],
      strict:false,pattern:"Triangle"
    });
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
    const w3NotShortest=w3>=Math.min(w1,w5);
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

function buildLiveContinuationSetup(c:Candle[],primary:WaveCount):WaveCount|null{
  if(primary.kind!=="Impulse"&&primary.kind!=="Diagonal")return null;
  const endIndex=primary.points.at(-1)?.index??-1;
  const bull=primary.direction==="bullish";
  const ps=alternatePivots(swingPivots(c,2)).filter(p=>p.index>endIndex);
  // A live continuation correction must be represented as X-A-B-C.
  // Scan every recent 4-pivot window instead of only the final four pivots;
  // an extra minor swing must not hide an otherwise valid correction.
  if(ps.length<4)return null;

  let best:{q:Pivot[];correction:ReturnType<typeof validateZigzag>;flat:ReturnType<typeof validateFlat>}|null=null;
  const expected=bull?["H","L","H","L"]:["L","H","L","H"];
  for(let i=0;i<=ps.length-4;i++){
    const q=ps.slice(i,i+4);
    if(q.some((p,j)=>p.type!==expected[j]))continue;
    const prices=q.map(p=>p.price);
    const correction=bull
      ? validateZigzag(prices,false)
      : validateZigzag(prices,true);
    const flat=bull
      ? validateFlat(prices,false)
      : validateFlat(prices,true);
    if(!correction.valid&&!flat.valid)continue;
    if(!best || q[3].index>best.q[3].index) best={q,correction,flat};
  }
  if(!best)return null;

  const q=best.q;
  const correction=best.correction;
  const flat=best.flat;
  const prices=q.map(p=>p.price);

  const [x,a,b,cPoint]=prices;
  // The completed ABC correction must not break the parent impulse origin.
  // Once C crosses that boundary, the parent 1–5 count is no longer a valid
  // continuation context even if price later reclaims the level.
  const parentOrigin=primary.points[0].price;
  const nonInvalidatingC=bull?cPoint>parentOrigin:cPoint<parentOrigin;
  if(!nonInvalidatingC)return null;

  // Entry is the B trigger after C completes; C is the invalidation point.
  const entry=b;
  const invalidation=cPoint;
  const risk=abs(entry-invalidation);
  if(risk<=0)return null;

  const dir=bull?1:-1;
  const extension=Math.max(abs(b-a),risk)*1.618;
  const target=entry+dir*extension;
  const lastClose=c.at(-1)?.close??entry;
  // A live continuation is only actionable while price is still on the
  // non-invalidated side of C. Reclaims after invalidation do not revive the
  // old count.
  const liveNotInvalidated=bull?lastClose>invalidation:lastClose<invalidation;
  if(!liveNotInvalidated)return null;
  const triggered=bull?lastClose>=entry:lastClose<=entry;
  const quality=clamp(72+(correction.valid?8:4)+(triggered?10:0)+(flat.valid?0:2));

  return{
    points:sequencePoints(q).map((x,i)=>({...x,label:["X","A","B","C"][i]})),
    kind:"Correction",
    direction:bull?"bullish":"bearish",
    invalidation,
    entry,
    targets:[target],
    quality,
    rules:[
      correction.valid?"X-A-B-C zigzag correction confirmed":"X-A-B-C flat correction confirmed",
      "Wave C completed after the prior Wave 5",
      triggered?"Price reclaimed/crossed the Wave B trigger":"Waiting for Wave B trigger break",
      "Stop invalidates the correction at Wave C"
    ],
    strict:true
  };
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
  let closedEnd=c.length-1;
  while(closedEnd>=0&&c[closedEnd].closed===false)closedEnd--;
  if(closedEnd<29)return EMPTY("Insufficient closed-candle history");
  const data=c.slice(0,closedEnd+1);
  const ps=alternatePivots(swingPivots(data,2));
  const corrections=correctionCandidates(data);
  const action:WaveCount[]=[
    ...[true,false].flatMap(bull=>{
      const out:WaveCount[]=[];
      for(let i=0;i<=ps.length-6;i++){
        const q=ps.slice(i,i+6),types=bull?["L","H","L","H","L","H"]:["H","L","H","L","H","L"];
        if(q.some((p,j)=>p.type!==types[j]))continue;
        const candidate=impulseCandidate(data,q,bull);
        if(candidate)out.push(candidate);
      }
      return out;
    }),
    ...diagonalCandidates(data,true),...diagonalCandidates(data,false)
  ];
  const ranked=action
    .sort((a,b)=>{
      const ageA=(data.length-1)-(a.points.at(-1)?.index??-1);
      const ageB=(data.length-1)-(b.points.at(-1)?.index??-1);
      const recentA=ageA<=MAX_PRIMARY_AGE_BARS?8*(1-ageA/MAX_PRIMARY_AGE_BARS):0;
      const recentB=ageB<=MAX_PRIMARY_AGE_BARS?8*(1-ageB/MAX_PRIMARY_AGE_BARS):0;
      return (b.quality+recentB)-(a.quality+recentA)
        ||((b.points.at(-1)?.index??-1)-(a.points.at(-1)?.index??-1));
    })
    .filter((x,i,a)=>i===a.findIndex(y=>y.points.map(p=>p.index).join(",")===x.points.map(p=>p.index).join(",")));
  const recentRanked=ranked.filter(x=>((data.length-1)-(x.points.at(-1)?.index??-1))<=MAX_PRIMARY_AGE_BARS);
  const primary=recentRanked.find(x=>x.quality>=60)??null;
  const alternative=ranked.find(x=>x!==primary&&x.quality>=55)??null;
  const correction=corrections[0]??null;

  if(!primary){
    const r=EMPTY(correction?"No recent complete 1–5 count; correction candidate is the strongest completed structure":"No recent qualified Elliott count");
    r.alternative=alternative;
    r.correction=correction;
    r.candidateCount=action.length;
    r.correctionCandidates=corrections.length;
    r.phase=correction ? correction.pattern + " correction candidate" : "No recent qualified Elliott count";
    r.pattern=correction?.pattern??"Correction";
    r.correctionPattern=(correction?.pattern==="Zigzag"||correction?.pattern==="Flat"||correction?.pattern==="Expanded Flat"||correction?.pattern==="Running Flat"||correction?.pattern==="Double Zigzag"||correction?.pattern==="Triangle")?correction.pattern:"None";
    r.activeWave=correction ? (String(correction.points.at(-1)?.label||"C") as AdvancedElliottResult["activeWave"]) : "None";
    return r;
  }

  const prices=primary.points.map(p=>p.price);
  const w1=abs(prices[1]-prices[0]),w2=abs(prices[2]-prices[1]),w3=abs(prices[3]-prices[2]),w4=abs(prices[4]-prices[3]),w5=abs(prices[5]-prices[4]);
  const fibLevels=buildFib(prices,primary.direction==="bullish");
  const nested3=internalEvidence(data,primary.points[2].index,primary.points[3].index,primary.direction==="bullish");
  const nested5=internalEvidence(data,primary.points[4].index,primary.points[5].index,primary.direction==="bullish");
  nested3.wave="3"; nested5.wave="5";
  const nested=[nested3,nested5];
  const degree=inferDegree((primary.points.at(-1)?.index??0)-(primary.points[0]?.index??0),data.length);
  const lastClose=data.at(-1)?.close??prices[5];
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
    : "Completed count is historical; live entry requires a confirmed ABC correction and Wave B trigger";
  const liveSetup=invalidated?null:buildLiveContinuationSetup(data,primary);
  const liveActiveWave=liveSetup
    ? ((liveSetup.points.at(-1)?.label==="A"?"A":liveSetup.points.at(-1)?.label==="B"?"B":"C") as AdvancedElliottResult["activeWave"])
    : "Wave 5";
  return{
    primary,alternative,correction,
    fib:{
      w2:+safeRatio(w2,w1).toFixed(3),
      w3:+safeRatio(w3,w1).toFixed(3),
      w4:+safeRatio(w4,w3).toFixed(3),
      w5:+safeRatio(w5,w1).toFixed(3)
    },
    fibLevels,channel,phase,score:primary.quality,confidence,setupState,
    setupReason,pattern,degree,countState:setupState,activeWave:liveActiveWave,liveSetup,
    candidateCount:action.length,correctionCandidates:corrections.length,nested,
    correctionPattern:(correction?.pattern==="Zigzag"||correction?.pattern==="Flat"||correction?.pattern==="Expanded Flat"||correction?.pattern==="Running Flat"||correction?.pattern==="Double Zigzag"||correction?.pattern==="Triangle")?correction.pattern:"None",engine:"ADVANCED_ELLIOTT_V2"
  };
}
