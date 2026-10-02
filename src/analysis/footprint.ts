import type { Candle } from "./engine";
import { normalizeCandleSeries } from "./candles";

export type AggTrade = {
  id: number;
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean;
};

export type FootprintLevel = {
  price: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  totalVolume: number;
  buyTrades: number;
  sellTrades: number;
};

export type FootprintSnapshot = {
  candleTime: number;
  intervalMs: number;
  confirmed: boolean;
  levels: FootprintLevel[];
  buyVolume: number;
  sellVolume: number;
  delta: number;
  deltaRatio: number;
  poc: number | null;
  stackedBuyImbalances: number;
  stackedSellImbalances: number;
  maxBuyImbalanceRatio: number;
  maxSellImbalanceRatio: number;
  maxPositiveDelta: number;
  maxNegativeDelta: number;
  absorption: "BUYER" | "SELLER" | "NONE";
  absorptionStrength: number;
};

export function normalizeAggTrade(raw: any): AggTrade | null {
  const id = Number(raw?.a);
  const price = Number(raw?.p);
  const quantity = Number(raw?.q);
  const time = Number(raw?.T);
  const rawMaker = raw?.m;
  let isBuyerMaker:boolean;
  if(typeof rawMaker==="boolean") isBuyerMaker=rawMaker;
  else if(typeof rawMaker==="string"){
    const normalized=rawMaker.trim().toLowerCase();
    if(normalized==="true"||normalized==="1")isBuyerMaker=true;
    else if(normalized==="false"||normalized==="0")isBuyerMaker=false;
    else return null;
  }else if(typeof rawMaker==="number"&&(rawMaker===0||rawMaker===1)){
    isBuyerMaker=rawMaker===1;
  }else return null;
  if (!Number.isFinite(id) || !Number.isInteger(id) || !Number.isFinite(price) || !Number.isFinite(quantity) || !Number.isFinite(time) || !Number.isInteger(time)) return null;
  if (price <= 0 || quantity <= 0 || time <= 0) return null;
  return { id, price, quantity, time, isBuyerMaker };
}

function priceKey(price: number, tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return price;
  // Derive decimal precision from the tick itself. A log10-based estimate
  // breaks fractional ticks such as 0.25 (which need two decimals).
  let decimals = 0;
  let scaled = tickSize;
  while (decimals < 12 && Math.abs(Math.round(scaled) - scaled) > 1e-10) {
    scaled *= 10;
    decimals += 1;
  }
  const steps = Math.round(price / tickSize);
  return Number((steps * tickSize).toFixed(decimals));
}

function bucketStart(time: number, intervalMs: number): number {
  return Math.floor(time / intervalMs) * intervalMs;
}

type MutableLevel = {
  price: number;
  buyVolume: number;
  sellVolume: number;
  buyTrades: number;
  sellTrades: number;
};

type MutableBar = {
  candleTime: number;
  levels: Map<number, MutableLevel>;
  buyVolume: number;
  sellVolume: number;
  ids: Set<number>;
};

export function analyzeFootprintSnapshot(
  snapshot: Omit<FootprintSnapshot, "absorption" | "absorptionStrength" | "stackedBuyImbalances" | "stackedSellImbalances" | "maxBuyImbalanceRatio" | "maxSellImbalanceRatio" | "maxPositiveDelta" | "maxNegativeDelta">,
  candle: Candle | undefined,
  tickSize: number,
): FootprintSnapshot {
  const levels = [...snapshot.levels].sort((a, b) => a.price - b.price);
  const ratio = (a: number, b: number) => a > 0 && b > 0 ? a / b : 0;
  const isAdjacent=(a:number,b:number)=>{
    // Without a valid exchange tick size we cannot establish true
    // price-level adjacency; never manufacture a stacked imbalance from
    // arbitrary neighboring prices.
    if(!Number.isFinite(tickSize)||tickSize<=0)return false;
    return Math.abs(Math.abs(a-b)/tickSize-1)<=1e-6;
  };
  let stackedBuyImbalances = 0;
  let stackedSellImbalances = 0;
  let maxBuyImbalanceRatio = 0;
  let maxSellImbalanceRatio = 0;
  let buyRun = 0;
  let sellRun = 0;
  for (let i = 0; i < levels.length; i += 1) {
    const cur = levels[i];
    const below = levels[i - 1];
    const above = levels[i + 1];

    if (below && isAdjacent(cur.price,below.price) && cur.buyVolume>0 && below.sellVolume>0) {
      const r = ratio(cur.buyVolume, below.sellVolume);
      maxBuyImbalanceRatio = Math.max(maxBuyImbalanceRatio, r);
      if (r >= 3) {
        buyRun += 1;
        stackedBuyImbalances = Math.max(stackedBuyImbalances, buyRun);
      } else {
        buyRun = 0;
      }
    } else {
      buyRun = 0;
    }

    if (above && isAdjacent(cur.price,above.price) && cur.sellVolume>0 && above.buyVolume>0) {
      const r = ratio(cur.sellVolume, above.buyVolume);
      maxSellImbalanceRatio = Math.max(maxSellImbalanceRatio, r);
      if (r >= 3) {
        sellRun += 1;
        stackedSellImbalances = Math.max(stackedSellImbalances, sellRun);
      } else {
        sellRun = 0;
      }
    } else {
      sellRun = 0;
    }
  }

  const maxPositiveDelta = levels.reduce((m, x) => Math.max(m, x.delta), 0);
  const maxNegativeDelta = levels.reduce((m, x) => Math.min(m, x.delta), 0);

  let absorption: FootprintSnapshot["absorption"] = "NONE";
  let absorptionStrength = 0;
  if (candle && levels.length) {
    const range = Math.max(candle.high - candle.low, tickSize > 0 ? tickSize : 1e-12);
    // Keep the edge bands disjoint even on very small one-tick candles.
    // Overlapping bands would let the same footprint level contribute to both
    // buyer and seller absorption and make a directional classification arbitrary.
    const edgeBand = Math.min(Math.max(tickSize * 2, range * 0.18), range * 0.45);
    const lowBand = candle.low + edgeBand;
    const highBand = candle.high - edgeBand;
    const low = levels.filter(x => x.price <= lowBand);
    const high = levels.filter(x => x.price >= highBand);
    const lowSell = low.reduce((s, x) => s + x.sellVolume, 0);
    const lowBuy = low.reduce((s, x) => s + x.buyVolume, 0);
    const highBuy = high.reduce((s, x) => s + x.buyVolume, 0);
    const highSell = high.reduce((s, x) => s + x.sellVolume, 0);
    const closeLocation = (candle.close - candle.low) / range;
    const upperLocation = (candle.high - candle.close) / range;
    // Absorption requires meaningful flow on both sides. A zero passive/aggressive
    // side must never be interpreted as absorption merely because division would
    // otherwise produce an infinite ratio.
    const buyerAbsorb = lowSell > 0 && lowBuy > 0 && lowSell / lowBuy >= 1.5 && closeLocation >= 0.55;
    const sellerAbsorb = highBuy > 0 && highSell > 0 && highBuy / highSell >= 1.5 && upperLocation >= 0.55;
    if (buyerAbsorb && !sellerAbsorb) {
      absorption = "BUYER";
      absorptionStrength = Math.max(0, Math.min(100, Math.round((lowSell / Math.max(lowBuy, 1e-12)) * 25 + closeLocation * 35)));
    } else if (sellerAbsorb && !buyerAbsorb) {
      absorption = "SELLER";
      absorptionStrength = Math.max(0, Math.min(100, Math.round((highBuy / Math.max(highSell, 1e-12)) * 25 + upperLocation * 35)));
    }
  }

  return {
    ...snapshot,
    levels,
    stackedBuyImbalances,
    stackedSellImbalances,
    maxBuyImbalanceRatio,
    maxSellImbalanceRatio,
    maxPositiveDelta,
    maxNegativeDelta,
    absorption,
    absorptionStrength,
  };
}

export class FootprintBook {
  readonly intervalMs: number;
  readonly tickSize: number;
  private bars = new Map<number, MutableBar>();
  private seen = new Set<number>();
  private maxBars = 36;
  private frozen = new Set<number>();
  private readonly finalizationDelayMs = 1500;

  constructor(intervalMs: number, tickSize: number, maxBars = 36) {
    this.intervalMs = intervalMs;
    this.tickSize = tickSize;
    this.maxBars = Math.max(12, maxBars);
  }

  clear(): void {
    this.bars.clear();
    this.seen.clear();
    this.frozen.clear();
  }

  add(trade: AggTrade): boolean {
    // Keep the class safe even when a caller bypasses normalizeAggTrade at
    // runtime. A typed AggTrade is not a runtime guarantee.
    if(!Number.isInteger(trade.id)||trade.id<=0||!Number.isFinite(trade.price)||trade.price<=0
      ||!Number.isFinite(trade.quantity)||trade.quantity<=0||!Number.isInteger(trade.time)||trade.time<=0
      ||typeof trade.isBuyerMaker!=="boolean")return false;
    if (this.seen.has(trade.id)) return false;
    this.seen.add(trade.id);
    const time = bucketStart(trade.time, this.intervalMs);
    if(this.frozen.has(time)) return false;
    let bar = this.bars.get(time);
    if (!bar) {
      bar = { candleTime: time, levels: new Map(), buyVolume: 0, sellVolume: 0, ids: new Set() };
      this.bars.set(time, bar);
    }
    const price = priceKey(trade.price, this.tickSize);
    let level = bar.levels.get(price);
    if (!level) {
      level = { price, buyVolume: 0, sellVolume: 0, buyTrades: 0, sellTrades: 0 };
      bar.levels.set(price, level);
    }

    // Binance aggTrade's m=true means buyer was the maker, so the aggressive
    // taker was the seller. m=false therefore represents aggressive buy flow.
    bar.ids.add(trade.id);
    if (trade.isBuyerMaker) {
      level.sellVolume += trade.quantity;
      level.sellTrades += 1;
      bar.sellVolume += trade.quantity;
    } else {
      level.buyVolume += trade.quantity;
      level.buyTrades += 1;
      bar.buyVolume += trade.quantity;
    }

    this.prune();
    return true;
  }

  load(trades: AggTrade[]): void {
    // Do not mutate the caller's trade array while normalizing stream order.
    for (const trade of [...trades].sort((a, b) => a.time - b.time || a.id - b.id)) this.add(trade);
  }

  private prune(): void {
    if (this.bars.size <= this.maxBars) return;
    const times = [...this.bars.keys()].sort((a, b) => a - b);
    while (times.length > this.maxBars) {
      const old = times.shift();
      if (old === undefined) break;
      const oldBar=this.bars.get(old);
      if(oldBar)for(const id of oldBar.ids)this.seen.delete(id);
      this.bars.delete(old);
      this.frozen.delete(old);
    }
  }

  snapshot(candleTime: number, candle?: Candle, now = Date.now()): FootprintSnapshot | null {
    const bar = this.bars.get(candleTime);
    if (!bar) return null;
    const levels = [...bar.levels.values()].map(x => ({
      price: x.price,
      buyVolume: x.buyVolume,
      sellVolume: x.sellVolume,
      delta: x.buyVolume - x.sellVolume,
      totalVolume: x.buyVolume + x.sellVolume,
      buyTrades: x.buyTrades,
      sellTrades: x.sellTrades,
    })).sort((a, b) => a.price - b.price);
    const total = Math.max(bar.buyVolume + bar.sellVolume, 1e-12);
    const poc = levels.length ? levels.reduce((a, b) => a.totalVolume > b.totalVolume ? a : b).price : null;
    const confirmed=now>=candleTime+this.intervalMs+this.finalizationDelayMs;
    if(confirmed)this.frozen.add(candleTime);
    const base = {
      candleTime,
      intervalMs: this.intervalMs,
      confirmed,
      levels,
      buyVolume: bar.buyVolume,
      sellVolume: bar.sellVolume,
      delta: bar.buyVolume - bar.sellVolume,
      deltaRatio: (bar.buyVolume - bar.sellVolume) / total,
      poc,
    };
    return analyzeFootprintSnapshot(base, candle, this.tickSize);
  }

  snapshots(candles: Candle[], now = Date.now()): FootprintSnapshot[] {
    const closed=normalizeCandleSeries(candles,true);
    return closed
      .slice(-this.maxBars)
      .map(c => this.snapshot(c.time, c, now))
      .filter((x): x is FootprintSnapshot => !!x)
      .filter(x => x.confirmed);
  }
}
