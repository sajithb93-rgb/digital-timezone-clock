import { analyzeSMC, Candle } from "./engine";
import { normalizeCandleSeries } from "./candles";

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
  contractSize?:number;
  inverseContract?:boolean;
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
  // Realtime feeds can arrive out of order or contain duplicate/malformed bars.
  // Normalize them before cumulative/order-flow calculations so the result is
  // causal and independent of transport ordering.
  const closed=normalizeCandleSeries(c,true);
  if(!closed.length)return{buyVolume:0,sellVolume:0,delta:0,deltaRatio:0,cumulativeDelta:0,volumeRatio:0,pressure:"BALANCED"};
  let buy=0,sell=0,cum=0;
  const recent=closed.slice(-20);
  const recentTimes=new Set(recent.map(x=>x.time));
  for(const x of closed){
    // Binance klines expose taker-buy base-asset volume. When present, use it
    // directly and derive taker-sell volume as total volume minus taker buys.
    let b:number,s:number;
    if(Number.isFinite(x.takerBuyVolume)&&x.takerBuyVolume!>=0&&x.takerBuyVolume!<=x.volume){
      b=x.takerBuyVolume!;
      s=x.volume-b;
    }else{
      // Fallback for Candle inputs that do not include exchange taker-buy data.
      const range=Math.max(x.high-x.low,1e-12);
      const bodyBias=Math.max(-1,Math.min(1,(x.close-x.open)/range));
      const buyShare=.5+bodyBias*.25;
      b=x.volume*buyShare;s=x.volume-b;
    }
    cum+=b-s;
    // "Window delta" and pressure describe the latest 20 closed candles;
    // cumulativeDelta intentionally retains the full normalized history.
    if(recentTimes.has(x.time)){buy+=b;sell+=s;}
  }
  const last=recent.at(-1)!;
  const prior=recent.slice(0,-1);
  const base=prior.length?prior.reduce((s,x)=>s+x.volume,0)/prior.length:0;
  const delta=buy-sell, total=buy+sell;
  const ratio=delta/Math.max(total,1e-12);
  // A volume ratio needs a meaningful reference sample. With fewer than five
  // prior closed bars, returning a ratio would over-weight one noisy candle.
  const volumeRatio=prior.length>=5?last.volume/Math.max(base,1e-12):0;
  return{buyVolume:buy,sellVolume:sell,delta,deltaRatio:ratio,cumulativeDelta:cum,volumeRatio,pressure:ratio>.08?"BUYERS":ratio<-.08?"SELLERS":"BALANCED"};
}

export function detectRegime(c:Candle[]):Regime{
  // Regime classification must use the same normalized, closed-candle stream
  // as flowSnapshot; otherwise feed ordering can change ATR and slope.
  const closed=normalizeCandleSeries(c,true);
  if(closed.length<20)return{regime:"TRANSITION",strength:0,atr:0,rangePercent:0};
  const n=14;
  const tr=closed.slice(-n).map((x,i,a)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-a[i-1].close),Math.abs(x.low-a[i-1].close)));
  const atr=tr.reduce((a,b)=>a+b,0)/tr.length;
  const q=closed.slice(-60),hi=Math.max(...q.map(x=>x.high)),lo=Math.min(...q.map(x=>x.low));
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
  const lastIndex=Math.max(0,s.asOf??0);
  const recent=(index:number)=>index>=Math.max(0,lastIndex-20);
  const structure=s.events.some((x:any)=>recent(x.index))?15:0;
  const liquidity=s.sweeps.some((x:any)=>recent(x.index))?15:0;
  const zones=(s.fvgs.some((x:any)=>!x.filled&&!x.partial&&recent(x.to))?7:0)+(s.orderBlocks.some((x:any)=>!x.mitigated&&recent(x.index))?8:0);
  const location=(s.premiumDiscount!=="Equilibrium"?10:3);
  const momentum=s.displacement>=.7?15:5;
  const volume=Math.min(10,Math.round(Math.max(0,flow.volumeRatio-0.7)*6));
  const total=Math.max(0,Math.min(100,structure+liquidity+zones+location+momentum+volume+(regime.regime.startsWith("TRENDING")?10:0)));
  return{structure,liquidity,zones,location,momentum,volume,total};
}

function floorToStep(value:number,step:number){
  if(!Number.isFinite(value)||!Number.isFinite(step)||step<=0)return 0;
  let decimals=0,scaled=step;
  while(decimals<12&&Math.abs(Math.round(scaled)-scaled)>1e-10){scaled*=10;decimals+=1;}
  const floored=Math.floor(value/step+1e-12)*step;
  return Number(floored.toFixed(decimals));
}

export function backtestCostR(entryExecution:number,exitExecution:number,riskDistance:number,feeBps:number,riskR=1):number{
  if(!Number.isFinite(entryExecution)||!Number.isFinite(exitExecution)||!Number.isFinite(riskDistance)||riskDistance<=0
    ||!Number.isFinite(feeBps)||feeBps<0||!Number.isFinite(riskR)||riskR<=0)return 0;
  const feeRate=feeBps/10000;
  return ((Math.abs(entryExecution)+Math.abs(exitExecution))*feeRate/riskDistance)*riskR;
}

export function riskPlan(account:number,riskPercent:number,entry:number|null,stop:number|null,constraints:RiskConstraints={},direction:"BUY"|"SELL"|"WAIT"="WAIT") {
  const validAccount=Number.isFinite(account)&&account>0;
  const validRisk=Number.isFinite(riskPercent)&&riskPercent>0&&riskPercent<=10;
  const validEntry=typeof entry==="number"&&Number.isFinite(entry)&&entry>0;
  const validStop=typeof stop==="number"&&Number.isFinite(stop)&&stop>0;
  const riskAmount=validAccount&&validRisk?account*riskPercent/100:0;
  if(direction==="WAIT"){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance:0,valid:false,reason:"Trade direction is WAIT"};
  }
  if(!validAccount||!validRisk||!validEntry||!validStop||entry===stop){
    const reason=!validAccount
      ?"Invalid account"
      :!validRisk
        ?"Risk percent must be > 0 and <= 10"
        :!validEntry
          ?"Invalid entry"
          :!validStop
            ?"Invalid stop"
            :"Entry and stop cannot be equal";
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance:0,valid:false,reason};
  }
  if((direction==="BUY"&&stop>=entry)||(direction==="SELL"&&stop<=entry)){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance:0,valid:false,reason:"Stop is on the wrong side of entry"};
  }

  const stopDistance=Math.abs(entry-stop);
  if(!Number.isFinite(stopDistance)||stopDistance<=0){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance:0,valid:false,reason:"Invalid stop distance"};
  }

  // COIN-M contracts are inverse instruments. Quantity is contracts, so one
  // contract does not represent one base-asset unit. Use contractSize to
  // convert the stop distance into quote-denominated risk per contract.
  const inverse=constraints.inverseContract===true;
  const contractSize=typeof constraints.contractSize==="number"&&Number.isFinite(constraints.contractSize)&&constraints.contractSize>0
    ?constraints.contractSize:1;
  const riskPerUnit=inverse?contractSize*(stopDistance/entry):stopDistance;
  if(!Number.isFinite(riskPerUnit)||riskPerUnit<=0){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance,valid:false,reason:"Invalid per-unit contract risk"};
  }

  const desiredPositionSize=riskAmount/riskPerUnit;
  if(!Number.isFinite(desiredPositionSize)||desiredPositionSize<=0){
    return{riskAmount,desiredPositionSize:0,positionSize:0,stopDistance,valid:false,reason:"Position size is zero"};
  }

  let positionSize=desiredPositionSize;
  const rawMinQty=constraints.minQty;
  const rawMaxQty=constraints.maxQty;
  const rawStepSize=constraints.stepSize;
  const rawMinNotional=constraints.minNotional;
  const rawMaxNotional=constraints.maxNotional;
  const minQty=typeof rawMinQty==="number"&&Number.isFinite(rawMinQty)&&rawMinQty>=0?rawMinQty:0;
  const maxQty=typeof rawMaxQty==="number"&&Number.isFinite(rawMaxQty)&&rawMaxQty>0?rawMaxQty:Infinity;
  const stepSize=typeof rawStepSize==="number"&&Number.isFinite(rawStepSize)&&rawStepSize>0?rawStepSize:0;
  const minNotional=typeof rawMinNotional==="number"&&Number.isFinite(rawMinNotional)&&rawMinNotional>=0?rawMinNotional:0;
  const maxNotional=typeof rawMaxNotional==="number"&&Number.isFinite(rawMaxNotional)&&rawMaxNotional>0?rawMaxNotional:Infinity;
  if(Number.isFinite(maxQty)&&maxQty>0)positionSize=Math.min(positionSize,maxQty);
  if(Number.isFinite(stepSize)&&stepSize>0)positionSize=floorToStep(positionSize,stepSize);
  if(positionSize<Math.max(0,minQty)){
    return{riskAmount,desiredPositionSize,positionSize:0,stopDistance,valid:false,reason:"Below exchange minimum quantity"};
  }

  const notional=entry*positionSize;
  if(Number.isFinite(minNotional)&&minNotional>0&&notional<minNotional){
    return{riskAmount,desiredPositionSize,positionSize:0,stopDistance,valid:false,reason:"Below exchange minimum notional"};
  }
  if(Number.isFinite(maxNotional)&&maxNotional>0&&notional>maxNotional){
    positionSize=Math.min(positionSize,maxNotional/entry);
    if(Number.isFinite(stepSize)&&stepSize>0)positionSize=floorToStep(positionSize,stepSize);
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
  if(!Array.isArray(c)||!Number.isFinite(riskR)||riskR<=0||!Number.isFinite(maxHoldingCandles)||maxHoldingCandles<1||!Number.isFinite(feeBps)||feeBps<0||feeBps>10000||!Number.isFinite(slippageBps)||slippageBps<0||slippageBps>10000){
    return{trades,wins,losses,winRate:0,totalR,grossR,costR,maxDrawdownR:maxDD,profitFactor:0,expired,notTriggered,openAtEnd};
  }

  // Backtests must never inspect an unfinished candle. The analysis window ends
  // before the signal bar, and the signal can only execute on later closed bars.
  // Backtest input may come from a realtime feed where candles are not guaranteed
  // to arrive sorted or uniquely. Normalize it before assigning positional indexes;
  // otherwise an out-of-order candle can become artificial lookahead data.
  const closedCandles=normalizeCandleSeries(c,true);
  if(closedCandles.length<81){
    return{trades,wins,losses,winRate:0,totalR,grossR,costR,maxDrawdownR:maxDD,profitFactor:0,expired,notTriggered,openAtEnd};
  }

  const seenSignals=new Set<string>();
  let cursor=80;
  const maxBars=Math.max(1,Math.floor(maxHoldingCandles));

  while(cursor<closedCandles.length){
    const analysisWindow=closedCandles.slice(0,cursor);
    const s=analyzeSMC(analysisWindow);
    if(s.setup.direction==="WAIT"||s.setup.entry==null||s.stop==null){
      cursor++;
      continue;
    }

    const entry=s.setup.entry,stop=s.stop,target=s.targets[0];
    if(target==null||![entry,stop,target].every(Number.isFinite)||entry<=0||stop<=0||target<=0){
      cursor++;
      continue;
    }

    const isBuy=s.setup.direction==="BUY";
    if((isBuy&&(stop>=entry||target<=entry))||(!isBuy&&(stop<=entry||target>=entry))){
      cursor++;
      continue;
    }

    const eventIndex=s.events.at(-1)?.index??-1;
    const signalKey=[eventIndex,s.setup.direction,entry.toPrecision(12),stop.toPrecision(12)].join("|");
    if(seenSignals.has(signalKey)){
      cursor++;
      continue;
    }
    seenSignals.add(signalKey);

    const riskDistance=Math.abs(entry-stop);
    const rewardR=Math.abs(target-entry)/riskDistance;
    if(!Number.isFinite(rewardR)||rewardR<=0){
      cursor++;
      continue;
    }

    // Pending entry expires after the same holding horizon used for the position.
    const entryEnd=Math.min(closedCandles.length,cursor+maxBars);
    let entryBar=-1;
    for(let j=cursor;j<entryEnd;j++){
      if(closedCandles[j].low<=entry&&closedCandles[j].high>=entry){entryBar=j;break;}
    }
    if(entryBar<0){
      notTriggered++;
      cursor++;
      continue;
    }

    let result=0,exitPrice=entry,closed=false,exitIndex=-1;
    // Entry-touch sequencing is unknowable from OHLC alone. Do not let the
    // entry candle itself also manufacture a TP win/SL loss; manage the
    // position only from the next closed candle.
    const manageStart=entryBar+1;
    const tradeEnd=Math.min(closedCandles.length,manageStart+maxBars-1);
    for(let j=manageStart;j<tradeEnd;j++){
      const x=closedCandles[j];
      const stopHit=isBuy?x.low<=stop:x.high>=stop;
      const targetHit=isBuy?x.high>=target:x.low<=target;
      // With OHLC-only data, same-candle stop+target ordering is unknowable.
      // Use the conservative stop-first rule consistently.
      if(stopHit){
        result=-riskR;exitPrice=stop;closed=true;exitIndex=j;break;
      }
      if(targetHit){
        result=rewardR*riskR;exitPrice=target;closed=true;exitIndex=j;break;
      }
    }

    if(!closed){
      if(tradeEnd>=closedCandles.length){
        openAtEnd++;
        break;
      }
      exitIndex=tradeEnd-1;
      if(exitIndex<manageStart){
        cursor++;
        continue;
      }
      exitPrice=closedCandles[exitIndex].close;
      const moveR=(isBuy?exitPrice-entry:entry-exitPrice)/riskDistance;
      result=moveR*riskR;
      expired++;
    }

    // No overlap: once an actual position starts, the next signal is considered
    // only after this trade exits or the dataset ends.
    cursor=Math.max(cursor+1,exitIndex+1);

    const side=isBuy?1:-1;
    const slip=Math.max(0,slippageBps)/10000;
    const entryExec=entry*(1+side*slip);
    const exitExec=Math.max(exitPrice,1e-12)*(1-side*slip);
    const tradeCostR=backtestCostR(entryExec,exitExec,riskDistance,feeBps,riskR);
    const netResult=(isBuy?exitExec-entryExec:entryExec-exitExec)/riskDistance*riskR-tradeCostR;

    grossR+=result;
    costR+=tradeCostR;
    totalR+=netResult;
    trades++;
    if(netResult>0)wins++;else losses++;
    if(result>0)grossWinR+=result;else if(result<0)grossLossR+=Math.abs(result);
    equity+=netResult;
    maxEquity=Math.max(maxEquity,equity);
    maxDD=Math.max(maxDD,maxEquity-equity);
  }

  return{
    trades,wins,losses,winRate:trades?wins/trades*100:0,totalR,grossR,costR,
    maxDrawdownR:maxDD,
    profitFactor:grossLossR?grossWinR/grossLossR:(grossWinR>0?Infinity:0),
    expired,notTriggered,openAtEnd
  };
}
