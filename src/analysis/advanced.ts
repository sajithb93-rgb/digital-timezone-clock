import { analyzeSMC, Candle } from "./engine";

export type FlowSnapshot = {
  buyVolume:number;
  sellVolume:number;
  delta:number;
  deltaRatio:number;
  cumulativeDelta:number;
  volumeRatio:number;
  pressure:"BUYERS"|"SELLERS"|"BALANCED";
};

export type Regime = {
  regime:"TRENDING UP"|"TRENDING DOWN"|"RANGING"|"HIGH VOLATILITY"|"TRANSITION";
  strength:number;
  atr:number;
  rangePercent:number;
};

export type ConfluenceBreakdown = {
  structure:number;
  liquidity:number;
  zones:number;
  location:number;
  momentum:number;
  volume:number;
  total:number;
};

export function flowSnapshot(c:Candle[]):FlowSnapshot{
  if(!c.length)return{buyVolume:0,sellVolume:0,delta:0,deltaRatio:0,cumulativeDelta:0,volumeRatio:0,pressure:"BALANCED"};
  let buy=0,sell=0,cum=0;
  for(const x of c){
    const range=Math.max(x.high-x.low,1e-12);
    // Candle-body-derived estimate only; this is not exchange aggressor-side volume.
    const bodyBias=Math.max(-1,Math.min(1,(x.close-x.open)/range));
    const buyShare=.5+bodyBias*.25;
    const b=x.volume*buyShare,s=x.volume-b;
    buy+=b;sell+=s;cum+=b-s;
  }
  const last=c.at(-1)!;
  const recent=c.slice(-20);
  const base=recent.slice(0,-1).reduce((s,x)=>s+x.volume,0)/Math.max(1,recent.length-1);
  const delta=buy-sell, total=buy+sell;
  const ratio=delta/Math.max(total,1e-12);
  return{buyVolume:buy,sellVolume:sell,delta,deltaRatio:ratio,cumulativeDelta:cum,volumeRatio:last.volume/Math.max(base,1e-12),pressure:ratio>.08?"BUYERS":ratio<-.08?"SELLERS":"BALANCED"};
}

export function detectRegime(c:Candle[]):Regime{
  if(c.length<20)return{regime:"TRANSITION",strength:0,atr:0,rangePercent:0};
  const n=14;
  const tr=c.slice(-n).map((x,i,a)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-a[i-1].close),Math.abs(x.low-a[i-1].close)));
  const atr=tr.reduce((a,b)=>a+b,0)/tr.length;
  const q=c.slice(-60),hi=Math.max(...q.map(x=>x.high)),lo=Math.min(...q.map(x=>x.low));
  const rangePercent=(hi-lo)/Math.max(q.at(-1)!.close,1e-12)*100;
  const first=q[0].close,last=q.at(-1)!.close;
  const slope=(last-first)/Math.max(first,1e-12)*100;
  const strength=Math.min(100,Math.round(Math.abs(slope)/(Math.max(atr/Math.max(last,1e-12)*100,.01))*3));
  const atrPct=atr/Math.max(last,1e-12)*100;
  if(atrPct>2.5)return{regime:"HIGH VOLATILITY",strength:Math.min(100,Math.round(atrPct*20)),atr,rangePercent};
  if(Math.abs(slope)>rangePercent*.28)return{regime:slope>0?"TRENDING UP":"TRENDING DOWN",strength,atr,rangePercent};
  if(rangePercent<3)return{regime:"RANGING",strength:Math.max(20,100-Math.round(rangePercent*20)),atr,rangePercent};
  return{regime:"TRANSITION",strength:45,atr,rangePercent};
}

export function confluence(s:any,flow:FlowSnapshot,regime:Regime):ConfluenceBreakdown{
  const structure=s.events.at(-1)?15:0;
  const liquidity=s.sweeps.length?15:0;
  const zones=(s.fvgs.some((x:any)=>!x.filled)?7:0)+(s.orderBlocks.some((x:any)=>!x.mitigated)?8:0);
  const location=(s.premiumDiscount!=="Equilibrium"?10:3);
  const momentum=s.displacement>=.7?15:5;
  const volume=Math.min(10,Math.round(Math.max(0,flow.volumeRatio-0.7)*6));
  const total=Math.max(0,Math.min(100,structure+liquidity+zones+location+momentum+volume+(regime.regime.startsWith("TRENDING")?10:0)));
  return{structure,liquidity,zones,location,momentum,volume,total};
}

export function riskPlan(account:number,riskPercent:number,entry:number|null,stop:number|null){
  const validAccount=Number.isFinite(account)&&account>0;
  const validRisk=Number.isFinite(riskPercent)&&riskPercent>0;
  const validEntry=typeof entry==="number"&&Number.isFinite(entry)&&entry>0;
  const validStop=typeof stop==="number"&&Number.isFinite(stop)&&stop>0;
  // Enforce a hard 10% ceiling even if the UI input constraints are bypassed.
  const boundedRisk=validRisk?Math.min(riskPercent,10):0;
  const riskAmount=validAccount?account*boundedRisk/100:0;
  if(!validAccount||!validRisk||!validEntry||!validStop||entry===stop){
    return{riskAmount,positionSize:0,stopDistance:0};
  }
  const stopDistance=Math.abs(entry-stop);
  if(!Number.isFinite(stopDistance)||stopDistance<=0)return{riskAmount,positionSize:0,stopDistance:0};
  return{riskAmount,positionSize:riskAmount/stopDistance,stopDistance};
}

/**
 * Conservative candle-based SMC backtest.
 * A setup is counted only after its entry price is touched. If stop and target
 * are both touched in one candle, stop is assumed first. Untouched/expired
 * setups are excluded. Fees/slippage are not modeled; results are gross R.
 */
export function runSMCBacktest(c:Candle[],riskR=1,maxHoldingCandles=30){
  let trades=0,wins=0,losses=0,totalR=0,grossWinR=0,grossLossR=0,maxEquity=0,equity=0,maxDD=0,expired=0,notTriggered=0;
  if(!Number.isFinite(riskR)||riskR<=0||!Number.isFinite(maxHoldingCandles)||maxHoldingCandles<1){
    return{trades,wins,losses,winRate:0,totalR,maxDrawdownR:maxDD,profitFactor:0,expired,notTriggered};
  }
  for(let i=80;i<c.length-3;i+=3){
    const s=analyzeSMC(c.slice(0,i));
    if(s.setup.direction==="WAIT"||s.setup.entry==null||s.stop==null)continue;
    const entry=s.setup.entry,stop=s.stop,target=s.targets[0];
    if(target==null||![entry,stop,target].every(Number.isFinite)||entry<=0||stop<=0||target<=0)continue;
    const isBuy=s.setup.direction==="BUY";
    // Reject geometrically invalid setups instead of silently testing them.
    if((isBuy&&(stop>=entry||target<=entry))||(!isBuy&&(stop<=entry||target>=entry)))continue;
    const riskDistance=Math.abs(entry-stop);
    const rewardR=Math.abs(target-entry)/riskDistance;
    if(!Number.isFinite(rewardR)||rewardR<=0)continue;

    let entryBar=-1;
    const horizon=Math.min(c.length,i+maxHoldingCandles);
    for(let j=i;j<horizon;j++){
      if(c[j].low<=entry&&c[j].high>=entry){entryBar=j;break;}
    }
    if(entryBar<0){notTriggered++;continue;}

    let result=0,closed=false;
    for(let j=entryBar;j<horizon;j++){
      const x=c[j];
      const stopHit=isBuy?x.low<=stop:x.high>=stop;
      const targetHit=isBuy?x.high>=target:x.low<=target;
      // Conservative ordering, including entry candle ambiguity.
      if(stopHit){result=-riskR;closed=true;break;}
      if(targetHit){result=rewardR*riskR;closed=true;break;}
    }
    if(!closed){expired++;continue;}
    trades++;
    if(result>0){wins++;grossWinR+=result;}else{losses++;grossLossR+=Math.abs(result);}
    totalR+=result;equity+=result;maxEquity=Math.max(maxEquity,equity);maxDD=Math.max(maxDD,maxEquity-equity);
  }
  return{trades,wins,losses,winRate:trades?wins/trades*100:0,totalR,maxDrawdownR:maxDD,profitFactor:grossLossR?grossWinR/grossLossR:(grossWinR>0?Infinity:0),expired,notTriggered};
}
