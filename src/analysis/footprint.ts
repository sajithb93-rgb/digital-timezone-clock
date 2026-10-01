import type { Candle } from "./engine";

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
  const isBuyerMaker = Boolean(raw?.m);
  if (!Number.isFinite(id) || !Number.isFinite(price) || !Number.isFinite(quantity) || !Number.isFinite(time)) return null;
  if (price <= 0 || quantity <= 0 || time <= 0) return null;
  return { id, price, quantity, time, isBuyerMaker };
}

function priceKey(price: number, tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return price;
  const decimals = Math.max(0, Math.min(12, Math.ceil(-Math.log10(tickSize))));
  return Number((Math.round(price / tickSize) * tickSize).toFixed(decimals));
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
  snapshot: Omit<FootprintSnapshot, "absorption" | "absorptionStrength" | "stackedBuyImbalances" | "stackedSellImbalances" | "maxPositiveDelta" | "maxNegativeDelta">,
  candle: Candle | undefined,
  tickSize: number,
): FootprintSnapshot {
  const levels = [...snapshot.levels].sort((a, b) => a.price - b.price);
  const ratio = (a: number, b: number) => a / Math.max(b, 1e-12);
  let stackedBuyImbalances = 0;
  let stackedSellImbalances = 0;
  let maxBuyImbalanceRatio = 0;
  let maxSellImbalanceRatio = 0;
  for (let i = 0; i < levels.length; i += 1) {
    const cur = levels[i];
    const below = levels[i - 1];
    const above = levels[i + 1];
    if (below) {
      const r = ratio(cur.buyVolume, below.sellVolume);
      maxBuyImbalanceRatio = Math.max(maxBuyImbalanceRatio, r);
      if (r >= 3) stackedBuyImbalances += 1;
    }
    if (above) {
      const r = ratio(cur.sellVolume, above.buyVolume);
      maxSellImbalanceRatio = Math.max(maxSellImbalanceRatio, r);
      if (r >= 3) stackedSellImbalances += 1;
    }
  }

  const maxPositiveDelta = levels.reduce((m, x) => Math.max(m, x.delta), 0);
  const maxNegativeDelta = levels.reduce((m, x) => Math.min(m, x.delta), 0);

  let absorption: FootprintSnapshot["absorption"] = "NONE";
  let absorptionStrength = 0;
  if (candle && levels.length) {
    const range = Math.max(candle.high - candle.low, tickSize > 0 ? tickSize : 1e-12);
    const lowBand = candle.low + Math.max(tickSize * 2, range * 0.18);
    const highBand = candle.high - Math.max(tickSize * 2, range * 0.18);
    const low = levels.filter(x => x.price <= lowBand);
    const high = levels.filter(x => x.price >= highBand);
    const lowSell = low.reduce((s, x) => s + x.sellVolume, 0);
    const lowBuy = low.reduce((s, x) => s + x.buyVolume, 0);
    const highBuy = high.reduce((s, x) => s + x.buyVolume, 0);
    const highSell = high.reduce((s, x) => s + x.sellVolume, 0);
    const closeLocation = (candle.close - candle.low) / range;
    const upperLocation = (candle.high - candle.close) / range;
    const buyerAbsorb = lowSell > lowBuy * 1.5 && closeLocation >= 0.55;
    const sellerAbsorb = highBuy > highSell * 1.5 && upperLocation >= 0.55;
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

  constructor(intervalMs: number, tickSize: number, maxBars = 36) {
    this.intervalMs = intervalMs;
    this.tickSize = tickSize;
    this.maxBars = Math.max(12, maxBars);
  }

  clear(): void {
    this.bars.clear();
    this.seen.clear();
  }

  add(trade: AggTrade): boolean {
    if (this.seen.has(trade.id)) return false;
    this.seen.add(trade.id);
    const time = bucketStart(trade.time, this.intervalMs);
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
    for (const trade of trades.sort((a, b) => a.time - b.time || a.id - b.id)) this.add(trade);
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
    const base = {
      candleTime,
      intervalMs: this.intervalMs,
      confirmed: now >= candleTime + this.intervalMs,
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
    return candles
      .filter(c => c.closed !== false)
      .slice(-this.maxBars)
      .map(c => this.snapshot(c.time, c, now))
      .filter((x): x is FootprintSnapshot => !!x)
      .filter(x => x.confirmed);
  }
}
