import type { Candle } from "./engine";

export type OrderFlowPressure = "BUYERS" | "SELLERS" | "BALANCED";
export type OrderFlowDirection = "BUY" | "SELL" | "WAIT";
export type OrderFlowAbsorption = "BUYER" | "SELLER" | "NONE";
export type LiquiditySweep = "HIGH" | "LOW" | "NONE";
export type MicroStructure = "BULLISH" | "BEARISH" | "NEUTRAL";
export type OrderFlowDataSource = "BINANCE_TAKER_FLOW" | "CANDLE_ESTIMATE_FALLBACK";

export type OrderFlowBar = {
  index:number; time:number; buyVolume:number; sellVolume:number; delta:number; deltaRatio:number;
  buyerPressure:number; sellerPressure:number; imbalanceRatio:number;
  imbalance:"BUY"|"SELL"|"NONE"; absorption:OrderFlowAbsorption; absorptionStrength:number;
  liquiditySweep:LiquiditySweep; sweepPrice:number|null; microStructure:MicroStructure;
};

export type OrderFlowResult = {
  source:OrderFlowDataSource; buyVolume:number; sellVolume:number; delta:number; deltaRatio:number;
  cumulativeDelta:number; buyerPressure:number; sellerPressure:number; pressure:OrderFlowPressure;
  pressureTrend:string; imbalance:"BUY"|"SELL"|"NONE"; imbalanceRatio:number;
  absorption:OrderFlowAbsorption; absorptionStrength:number; liquiditySweep:LiquiditySweep;
  liquiditySweepPrice:number|null; microStructure:MicroStructure; direction:OrderFlowDirection;
  signal:string; confidence:number; confirmations:string[]; entry:number|null; stop:number|null;
  targets:number[]; recentBars:OrderFlowBar[];
};

function clamp(n:number,lo=0,hi=100){return Math.max(lo,Math.min(hi,Math.round(n)))}
function safe(n:number){return Number.isFinite(n)?n:0}
function barRange(c:Candle){return Math.max(c.high-c.low,1e-12)}
function avg(v:number[]){return v.length?v.reduce((a,b)=>a+b,0)/v.length:0}

function volumeSplit(c:Candle){
  if(Number.isFinite(c.takerBuyVolume)){
    const buy=Math.max(0,Math.min(c.volume,c.takerBuyVolume!));
    return {buy,sell:Math.max(0,c.volume-buy),exact:true};
  }
  const range=barRange(c);
  const bodyBias=Math.max(-1,Math.min(1,(c.close-c.open)/range));
  const buy=c.volume*(0.5+bodyBias*0.25);
  return {buy,sell:Math.max(0,c.volume-buy),exact:false};
}

function analyzeBar(candles:Candle[],i:number,buy:number,sell:number):OrderFlowBar{
  const c=candles[i],total=Math.max(buy+sell,1e-12),delta=buy-sell,deltaRatio=delta/total;
  const buyerPressure=buy/total*100,sellerPressure=sell/total*100;
  const imbalanceRatio=Math.max(buy,sell)/Math.max(Math.min(buy,sell),1e-12);
  const imbalance:OrderFlowBar["imbalance"]=buy>sell&&imbalanceRatio>=1.6?"BUY":sell>buy&&imbalanceRatio>=1.6?"SELL":"NONE";
  const range=barRange(c),body=Math.abs(c.close-c.open);
  const upperWick=c.high-Math.max(c.open,c.close),lowerWick=Math.min(c.open,c.close)-c.low;
  const closeLocation=(c.close-c.low)/range;

  const sellerAbsorbed=buy/total>=0.60&&(upperWick>=range*0.25||closeLocation<=0.42)&&(c.close<=c.open||upperWick>=Math.max(body,range*0.1));
  const buyerAbsorbed=sell/total>=0.60&&(lowerWick>=range*0.25||closeLocation>=0.58)&&(c.close>=c.open||lowerWick>=Math.max(body,range*0.1));
  let absorption:OrderFlowAbsorption="NONE",absorptionStrength=0;
  if(sellerAbsorbed&&!buyerAbsorbed){absorption="SELLER";absorptionStrength=clamp(buyerPressure+Math.min(25,upperWick/range*100)-45)}
  else if(buyerAbsorbed&&!sellerAbsorbed){absorption="BUYER";absorptionStrength=clamp(sellerPressure+Math.min(25,lowerWick/range*100)-45)}

  let liquiditySweep:LiquiditySweep="NONE",sweepPrice:number|null=null;
  const lookbackStart=Math.max(0,i-10),history=candles.slice(lookbackStart,i);
  if(history.length>=3){
    const previousHigh=Math.max(...history.map(x=>x.high)),previousLow=Math.min(...history.map(x=>x.low));
    if(c.high>previousHigh&&c.close<previousHigh){liquiditySweep="HIGH";sweepPrice=previousHigh}
    else if(c.low<previousLow&&c.close>previousLow){liquiditySweep="LOW";sweepPrice=previousLow}
  }

  const structure=candles.slice(Math.max(0,i-3),i);
  let microStructure:MicroStructure="NEUTRAL";
  if(structure.length>=2){
    const previousHigh=Math.max(...structure.map(x=>x.high)),previousLow=Math.min(...structure.map(x=>x.low));
    if(c.close>previousHigh)microStructure="BULLISH";
    else if(c.close<previousLow)microStructure="BEARISH";
  }
  return {index:i,time:c.time,buyVolume:buy,sellVolume:sell,delta,deltaRatio,buyerPressure,sellerPressure,
    imbalanceRatio:Number.isFinite(imbalanceRatio)?imbalanceRatio:0,imbalance,absorption,absorptionStrength,
    liquiditySweep,sweepPrice,microStructure};
}

function emptyResult():OrderFlowResult{
  return {source:"BINANCE_TAKER_FLOW",buyVolume:0,sellVolume:0,delta:0,deltaRatio:0,cumulativeDelta:0,
    buyerPressure:0,sellerPressure:0,pressure:"BALANCED",pressureTrend:"NEUTRAL",imbalance:"NONE",imbalanceRatio:0,
    absorption:"NONE",absorptionStrength:0,liquiditySweep:"NONE",liquiditySweepPrice:null,microStructure:"NEUTRAL",
    direction:"WAIT",signal:"WAIT — no confirmed closed-candle order-flow setup",confidence:0,confirmations:[],
    entry:null,stop:null,targets:[],recentBars:[]};
}

/**
 * Non-repainting Order Flow:
 * - only closed candles are eligible;
 * - fallback candle-volume estimates can never produce a confirmed signal;
 * - confirmation is evaluated only on the latest closed candle;
 * - historical bars are never modified by future candles.
 */
export function analyzeOrderFlow(candles:Candle[]):OrderFlowResult{
  // Normalize the feed so causal analysis cannot be broken by bad ordering,
  // duplicate timestamps, malformed OHLC, or impossible candles.
  const byTime=new Map<number,Candle>();
  for(const c of candles){
    if(!Number.isFinite(c.time)||!Number.isFinite(c.open)||!Number.isFinite(c.high)||!Number.isFinite(c.low)||!Number.isFinite(c.close)||!Number.isFinite(c.volume))continue;
    if(c.volume<0||c.high<c.low||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))continue;
    byTime.set(c.time,c);
  }
  const closed=[...byTime.values()].filter(c=>c.closed!==false).sort((x,y)=>x.time-y.time);
  if(!closed.length)return emptyResult();

  let cumulativeDelta=0,allExact=true;
  const bars:OrderFlowBar[]=[];
  for(let i=0;i<closed.length;i++){
    const split=volumeSplit(closed[i]);
    allExact=allExact&&split.exact;
    cumulativeDelta+=split.buy-split.sell;
    bars.push(analyzeBar(closed,i,split.buy,split.sell));
  }
  const last=bars.at(-1);
  if(!last)return emptyResult();

  const flowBars=bars.slice(-12);
  const buyVolume=flowBars.reduce((s,b)=>s+b.buyVolume,0);
  const sellVolume=flowBars.reduce((s,b)=>s+b.sellVolume,0);
  const total=Math.max(buyVolume+sellVolume,1e-12);
  const delta=buyVolume-sellVolume,deltaRatio=delta/total;
  const buyerPressure=buyVolume/total*100,sellerPressure=sellVolume/total*100;
  const pressure:OrderFlowPressure=deltaRatio>=0.08?"BUYERS":deltaRatio<=-0.08?"SELLERS":"BALANCED";

  const recent3=bars.slice(-3).map(b=>b.deltaRatio),prior3=bars.slice(-6,-3).map(b=>b.deltaRatio);
  const trendDelta=avg(recent3)-avg(prior3);
  const pressureTrend=trendDelta>=0.04?"BUYING PRESSURE INCREASING":trendDelta<=-0.04?"SELLING PRESSURE INCREASING":"PRESSURE STABLE";

  const recentBars=bars.slice(-12);
  // Use the latest qualifying event, not the oldest one in the lookback window.
  const sweepLow=recentBars.filter(b=>b.liquiditySweep==="LOW").at(-1);
  const sweepHigh=recentBars.filter(b=>b.liquiditySweep==="HIGH").at(-1);
  const buyerAbsorption=recentBars.filter(b=>b.absorption==="BUYER").at(-1);
  const sellerAbsorption=recentBars.filter(b=>b.absorption==="SELLER").at(-1);

  // A confirmation must form in causal order: liquidity event -> absorption -> current closed-bar break.
  const longContext=!!sweepLow&&!!buyerAbsorption&&buyerAbsorption.index>=sweepLow.index&&last.index-buyerAbsorption.index<=5;
  const shortContext=!!sweepHigh&&!!sellerAbsorption&&sellerAbsorption.index>=sweepHigh.index&&last.index-sellerAbsorption.index<=5;

  const longConfirmed=allExact&&longContext&&pressure==="BUYERS"&&last.deltaRatio>=0.08&&last.imbalance==="BUY"&&last.microStructure==="BULLISH";
  const shortConfirmed=allExact&&shortContext&&pressure==="SELLERS"&&last.deltaRatio<=-0.08&&last.imbalance==="SELL"&&last.microStructure==="BEARISH";

  let direction:OrderFlowDirection="WAIT";
  if(longConfirmed&&!shortConfirmed)direction="BUY";
  else if(shortConfirmed&&!longConfirmed)direction="SELL";

  const confirmations:string[]=[];
  if(direction==="BUY"){
    confirmations.push("Closed-candle confirmation","Binance taker flow","Sell-side liquidity sweep","Buyer absorption","12-bar buyer pressure","Positive delta","Buy imbalance ≥ 1.6×","Bullish micro-structure break");
  }else if(direction==="SELL"){
    confirmations.push("Closed-candle confirmation","Binance taker flow","Buy-side liquidity sweep","Seller absorption","12-bar seller pressure","Negative delta","Sell imbalance ≥ 1.6×","Bearish micro-structure break");
  }

  let entry:number|null=null,stop:number|null=null,targets:number[]=[];
  if(direction!=="WAIT"){
    entry=closed.at(-1)!.close;
    const buffer=avg(closed.slice(-5).map(c=>barRange(c)))*0.10;
    if(direction==="BUY"){
      const base=sweepLow?.sweepPrice??Math.min(...closed.slice(-5).map(c=>c.low));
      stop=Math.max(0,base-buffer);
    }else{
      const base=sweepHigh?.sweepPrice??Math.max(...closed.slice(-5).map(c=>c.high));
      stop=base+buffer;
    }
    if(entry!=null&&stop!=null&&entry!==stop){
      const risk=Math.abs(entry-stop);
      targets=direction==="BUY"?[entry+risk*1.5,entry+risk*2,entry+risk*3]:[entry-risk*1.5,entry-risk*2,entry-risk*3];
    }else{entry=null;stop=null;targets=[];direction="WAIT"}
  }

  const signal=direction==="BUY"?"BUY CONFIRMED — CLOSED CANDLE":direction==="SELL"?"SELL CONFIRMED — CLOSED CANDLE":"WAIT — no confirmed closed-candle order-flow setup";
  const lastTotal=Math.max(last.buyVolume+last.sellVolume,1e-12);
  const lastImbalanceRatio=Math.max(last.buyVolume,last.sellVolume)/Math.max(Math.min(last.buyVolume,last.sellVolume),1e-12);

  return {
    source:allExact?"BINANCE_TAKER_FLOW":"CANDLE_ESTIMATE_FALLBACK",
    buyVolume,sellVolume,delta:safe(delta),deltaRatio:safe(deltaRatio),cumulativeDelta:safe(cumulativeDelta),
    buyerPressure:clamp(buyerPressure),sellerPressure:clamp(sellerPressure),pressure,pressureTrend,
    imbalance:last.imbalance,imbalanceRatio:safe(lastImbalanceRatio),absorption:last.absorption,
    absorptionStrength:last.absorptionStrength,liquiditySweep:direction==="BUY"?(sweepLow?.liquiditySweep??"NONE"):direction==="SELL"?(sweepHigh?.liquiditySweep??"NONE"):"NONE",
    liquiditySweepPrice:direction==="BUY"?(sweepLow?.sweepPrice??null):direction==="SELL"?(sweepHigh?.sweepPrice??null):null,
    microStructure:last.microStructure,direction,signal,confidence:direction==="WAIT"?0:100,confirmations,
    entry,stop,targets,recentBars
  };
}
