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

export type RiskConstraints = {
  minQty?:number;
  maxQty?:number;
  stepSize?:number;
  minNotional?:number;
  maxNotional?:number;
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
    // Binance klines expose taker-buy base-asset volume. When present, use it
    // directly and derive taker-sell volume as total volume minus taker buys.
    if(Number.isFinite(x.takerBuyVolume)){
      const b=Math.max(0,Math.min(x.volume,x.takerBuyVolume!));
      const s=Math.max(0,x.volume-b);
      buy+=b;sell+=s;cum+=b-s;
      continue;
    }
    // Fallback for Candle inputs that do not include exchange taker-buy data.
    const range=Math.max(x.high-x.low,1e-12);
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
  const lastIndex=Math.max(0,s.pivots?.at(-1)?.index??0);
  const recent=(index:number)=>index>=Math.max(0,lastIndex-20);
  const structure=s.events.some((x:any)=>recent(x.index))?15:0;
  const liquidity=s.sweeps.some((x:any)=>recent(x.index))?15:0;
  const zones=(s.fvgs.some((x:any)=>!x.filled&&recent(x.to))?7:0)+(s.orderBlocks.some((x:any)=>!x.mitigated&&recent(x.index))?8:0);
  const location=(s.premiumDiscount!=="Equilibrium"?10:3);
  const momentum=s.displacement>=.7?15:5;
  const volume=Math.min(10,Math.round(Math.max(0,flow.volumeRatio-0.7)*6));
  const total=Math.max(0,Math.min(100,structure+liquidity+zones+location+momentum+volume+(regime.regime.startsWith("TRENDING")?10:0)));
  return{structure,liquidity,zones,location,momentum,volume,total};
}

export function riskPlan(account:number,riskPercent:number,entry:number|null,stop:number|null,constraints:RiskConstraints={},direction:"BUY"|"SELL"|"WAIT"="WAIT") {
  const validAccount=Number.isFinite(account)&&account>0;
  const validRisk=Number.isFinite(riskPercent)&&riskPercent>0;
  const validEntry=typeof entry==="number"&&Number.isFinite(entry)&&entry>0;
  const validStop=typeof stop==="number"&&Number.isFinite(stop)&&stop>0;
  const boundedRisk=validRisk?Math.min(riskPercent,10):0;
  const riskAmount=validAccount?account*boundedRisk/100:0;
  if(!validAccount||!validRisk||!validEntry||!validStop||entry===stop){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance:0,valid:false,reason:"Invalid account, risk, entry or stop"};
  }
  if((direction==="BUY"&&stop>=entry)||(direction==="SELL"&&stop<=entry)){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance:0,valid:false,reason:"Stop is on the wrong side of entry"};
  }

  const stopDistance=Math.abs(entry-stop);
  if(!Number.isFinite(stopDistance)||stopDistance<=0){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance:0,valid:false,reason:"Invalid stop distance"};
  }

  const desiredPositionSize=riskAmount/stopDistance;
  if(!Number.isFinite(desiredPositionSize)||desiredPositionSize<=0){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance,valid:false,reason:"Position size is zero"};
  }

  let positionSize=desiredPositionSize;
  const {minQty=0,maxQty=Infinity,stepSize=0,minNotional=0,maxNotional=Infinity}=constraints;
  if(Number.isFinite(maxQty)&&maxQty>0)positionSize=Math.min(positionSize,maxQty);
  if(Number.isFinite(stepSize)&&stepSize>0)positionSize=Math.floor((positionSize/stepSize)+1e-12)*stepSize;
  if(positionSize<Math.max(0,minQty)){
    return{riskAmount,desiredPositionSize,positionSize:0,stopDistance,valid:false,reason:"Below exchange minimum quantity"};
  }

  const notional=entry*positionSize;
  if(Number.isFinite(minNotional)&&minNotional>0&&notional<minNotional){
    return{riskAmount,desiredPositionSize,positionSize:0,stopDistance,valid:false,reason:"Below exchange minimum notional"};
  }
  if(Number.isFinite(maxNotional)&&maxNotional>0&&notional>maxNotional){
    positionSize=Math.min(positionSize,maxNotional/entry);
    if(Number.isFinite(stepSize)&&stepSize>0)positionSize=Math.floor((positionSize/stepSize)+1e-12)*stepSize;
  }
  const finalNotional=entry*positionSize;
  if(positionSize<Math.max(0,minQty)){
    return{riskAmount,desiredPositionSize,positionSize:0,stopDistance,valid:false,reason:"Maximum notional cap leaves quantity below exchange minimum"};
  }
  if(Number.isFinite(minNotional)&&minNotional>0&&finalNotional<minNotional){
    return{riskAmount,desiredPositionSize,positionSize:0,stopDistance,valid:false,reason:"Maximum notional cap leaves notional below exchange minimum"};
  }
  if(positionSize<=0||!Number.isFinite(positionSize)){
    return{riskAmount,desiredPositionSize,positionSize:0,stopDistance,valid:false,reason:"Exchange size constraints leave no valid quantity"};
  }

  return{riskAmount,desiredPositionSize,positionSize,stopDistance,valid:true,reason:"OK"};
}

/**
 * Conservative candle-based SMC backtest.
 * A setup is counted only after its entry price is touched. If stop and target
 * are both touched in one candle, stop is assumed first. Untriggered setups
 * are left pending, while positions that remain open at the end
 * of the dataset are reported separately. Fee/slippage basis points are optional.
 */
export function runSMCBacktest(c:Candle[],riskR=1,maxHoldingCandles=30,feeBps=0,slippageBps=0){
  let trades=0,wins=0,losses=0,totalR=0,grossR=0,costR=0,grossWinR=0,grossLossR=0,maxEquity=0,equity=0,maxDD=0,expired=0,notTriggered=0,openAtEnd=0;
  if(!Number.isFinite(riskR)||riskR<=0||!Number.isFinite(maxHoldingCandles)||maxHoldingCandles<1||!Number.isFinite(feeBps)||feeBps<0||!Number.isFinite(slippageBps)||slippageBps<0){
    return{trades,wins,losses,winRate:0,totalR,grossR,costR,maxDrawdownR:maxDD,profitFactor:0,expired,notTriggered,openAtEnd};
  }

  const seenSignals=new Set<string>();
  let nextAvailableIndex=80;
  for(let i=80;i<c.length-3;i++){
    const s=analyzeSMC(c.slice(0,i));
    if(s.setup.direction==="WAIT"||s.setup.entry==null||s.stop==null)continue;
    const entry=s.setup.entry,stop=s.stop,target=s.targets[0];
    if(target==null||![entry,stop,target].every(Number.isFinite)||entry<=0||stop<=0||target<=0)continue;
    const isBuy=s.setup.direction==="BUY";
    if((isBuy&&(stop>=entry||target<=entry))||(!isBuy&&(stop<=entry||target>=entry)))continue;

    // One trade per distinct generated setup; this removes the old every-3-bars sampling bias
    // without creating repeated entries while a setup remains unchanged.
    const eventIndex=s.events.at(-1)?.index??-1;
    const signalKey=[eventIndex,s.setup.direction,entry.toPrecision(12),stop.toPrecision(12),target.toPrecision(12)].join("|");
    if(seenSignals.has(signalKey)||i<nextAvailableIndex)continue;

    const riskDistance=Math.abs(entry-stop);
    const rewardR=Math.abs(target-entry)/riskDistance;
    if(!Number.isFinite(rewardR)||rewardR<=0)continue;

    // The setup is known only after bar i-1 closes, so entry can trigger from bar i onward.
    const maxBars=Math.max(1,Math.floor(maxHoldingCandles));
    const scanEnd=Math.min(c.length, i+maxBars+1);
    let entryBar=-1;
    for(let j=i;j<scanEnd;j++){
      if(c[j].low<=entry&&c[j].high>=entry){entryBar=j;break;}
    }
    if(entryBar<0){continue;}
    seenSignals.add(signalKey);

    let result=0,exitPrice=entry,closed=false,exitIndex=-1;
    const tradeEnd=Math.min(c.length,entryBar+maxBars+1);
    for(let j=entryBar;j<tradeEnd;j++){
      const x=c[j];
      const stopHit=isBuy?x.low<=stop:x.high>=stop;
      const targetHit=isBuy?x.high>=target:x.low<=target;
      // Conservative intrabar ordering when both are touched is stop first.
      if(stopHit){result=-riskR;exitPrice=stop;closed=true;exitIndex=j;break;}
      if(targetHit){result=rewardR*riskR;exitPrice=target;closed=true;exitIndex=j;break;}
    }

    if(!closed){
      // Do not mark an unfinished dataset tail as an expiry.
      if(tradeEnd>=c.length){openAtEnd++;nextAvailableIndex=c.length;continue;}
      exitIndex=tradeEnd-1;
      if(exitIndex<entryBar)continue;
      exitPrice=c[exitIndex].close;
      const moveR=(isBuy?exitPrice-entry:entry-exitPrice)/riskDistance;
      result=moveR*riskR;
      expired++;
    }
    nextAvailableIndex=Math.max(nextAvailableIndex,exitIndex+1);

    const side=isBuy?1:-1;
    const slip=Math.max(0,slippageBps)/10000;
    const entryExec=entry*(1+side*slip);
    const exitExec=Math.max(exitPrice,1e-12)*(1-side*slip);
    const grossMoveR=(isBuy?exitExec-entryExec:entryExec-exitExec)/riskDistance*riskR;
    const feeRate=Math.max(0,feeBps)/10000;
    const tradeCostR=((entryExec+exitExec)*feeRate)/riskDistance;
    const netResult=grossMoveR-tradeCostR;
    result=grossMoveR;
    grossR+=result;
    costR+=tradeCostR;
    totalR+=netResult;
    trades++;
    if(netResult>0){wins++;grossWinR+=netResult;}else{losses++;grossLossR+=Math.abs(netResult);}
    equity+=netResult;maxEquity=Math.max(maxEquity,equity);maxDD=Math.max(maxDD,maxEquity-equity);
  }

  return{
    trades,wins,losses,winRate:trades?wins/trades*100:0,totalR,grossR,costR,
    maxDrawdownR:maxDD,
    profitFactor:grossLossR?grossWinR/grossLossR:(grossWinR>0?Infinity:0),
    expired,notTriggered,openAtEnd
  };
}
