import { writeFile } from "node:fs/promises";
import { analyzeSMC, analyzeElliott, type Candle } from "../src/analysis/engine";

const BASE = "https://fapi.binance.com/fapi/v1/klines";
const SYMBOL = process.env.SYMBOL ?? "BTCUSDT";
const INTERVAL = "5m";
const DAYS = Number(process.env.DAYS ?? 90);
const INITIAL_EQUITY = Number(process.env.INITIAL_EQUITY ?? 10_000);
const RISK_FRACTION = Number(process.env.RISK_FRACTION ?? 0.01);
const FEE_RATE = Number(process.env.FEE_RATE ?? 0.0005); // per side; configure to your tier
const SLIPPAGE = Number(process.env.SLIPPAGE ?? 0.0002); // adverse fraction per fill
const WARMUP = 500;
const LIMIT = 1500;

type BinanceKline = [
  number, string, string, string, string, string,
  number, string, string, string, string, string
];

type Trade = { side: "LONG" | "SHORT"; entryTime: number; exitTime: number; entry: number; exit: number; stop: number; target: number; qty: number; pnl: number; r: number; reason: string };

async function fetchCandles(): Promise<Candle[]> {
  const end = Date.now();
  const start = end - DAYS * 24 * 60 * 60 * 1000;
  const all: Candle[] = [];
  for (let cursor = start; cursor < end;) {
    const url = new URL(BASE);
    url.searchParams.set("symbol", SYMBOL);
    url.searchParams.set("interval", INTERVAL);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(end));
    url.searchParams.set("limit", String(LIMIT));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance klines HTTP ${response.status}: ${await response.text()}`);
    const rows = await response.json() as BinanceKline[];
    if (!rows.length) break;
    for (const r of rows) all.push({ time: r[0], open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]), takerBuyVolume: Number(r[9]), closed: r[6] < end });
    const next = rows[rows.length - 1][0] + 5 * 60_000;
    if (next <= cursor) throw new Error("Binance pagination did not advance");
    cursor = next;
    if (rows.length < LIMIT) break;
  }
  const dedup = [...new Map(all.map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
  return dedup.filter(c => c.closed && c.time < end);
}

function applySlippage(price: number, side: "BUY" | "SELL"): number {
  return price * (side === "BUY" ? 1 + SLIPPAGE : 1 - SLIPPAGE);
}

async function main() {
  if (!(DAYS > 0 && INITIAL_EQUITY > 0 && RISK_FRACTION > 0 && RISK_FRACTION <= 0.1)) throw new Error("Invalid DAYS, INITIAL_EQUITY, or RISK_FRACTION");
  const candles = await fetchCandles();
  if (candles.length <= WARMUP + 2) throw new Error(`Not enough candles: ${candles.length}`);
  let equity = INITIAL_EQUITY;
  let peak = equity;
  let maxDrawdown = 0;
  let active: Omit<Trade, "exitTime" | "exit" | "pnl" | "r" | "reason"> | null = null;
  const trades: Trade[] = [];
  const signals: unknown[] = [];

  // Signal at candle close; earliest fill is the next candle open. Each analyzer sees history only.
  for (let i = WARMUP; i < candles.length - 1; i++) {
    const window = candles.slice(Math.max(0, i - 500), i + 1);
    const signalCandle = candles[i];
    const next = candles[i + 1];
    if (active) {
      const bar = signalCandle;
      const long = active.side === "LONG";
      const stopHit = long ? bar.low <= active.stop : bar.high >= active.stop;
      const targetHit = long ? bar.high >= active.target : bar.low <= active.target;
      // Conservative intrabar assumption: if stop and target both touched, stop wins.
      if (stopHit || targetHit) {
        const rawExit = stopHit ? active.stop : active.target;
        const exit = applySlippage(rawExit, long ? "SELL" : "BUY");
        const gross = (exit - active.entry) * active.qty * (long ? 1 : -1);
        const fees = (active.entry * active.qty + exit * active.qty) * FEE_RATE;
        const pnl = gross - fees;
        equity += pnl;
        trades.push({ ...active, exitTime: bar.time, exit, pnl, r: pnl / Math.max(active.entry * active.qty * RISK_FRACTION, 1e-9), reason: stopHit ? "STOP (stop-first if ambiguous)" : "TARGET" });
        active = null;
      }
    }
    if (!active) {
      const smc = analyzeSMC(window);
      const elliott = analyzeElliott(window);
      const setup = smc.setup;
      const wave = elliott.primary;
      const smcSide = setup.direction === "BUY" ? "LONG" : setup.direction === "SELL" ? "SHORT" : null;
      const waveAligned = !!wave && ((smcSide === "LONG" && wave.direction === "bullish") || (smcSide === "SHORT" && wave.direction === "bearish"));
      signals.push({ time: signalCandle.time, smc: setup.direction, status: setup.status, smcScore: smc.score, waveDirection: wave?.direction ?? null, waveQuality: wave?.quality ?? null, waveAligned });
      // EliteWave acts as a direction/quality confirmation; no unconfirmed/no-trade wave is treated as alignment.
      if (smcSide && setup.status === "ACTIVE" && waveAligned && wave && wave.quality >= 50 && setup.entry !== null && setup.stop !== null) {
        const side = smcSide;
        const rawEntry = next.open;
        const entry = applySlippage(rawEntry, side === "LONG" ? "BUY" : "SELL");
        const stop = setup.stop;
        const target = setup.targets.find(t => side === "LONG" ? t > entry : t < entry);
        const perUnitRisk = Math.abs(entry - stop);
        if (target !== undefined && perUnitRisk > 0 && (side === "LONG" ? stop < entry : stop > entry)) {
          const riskBudget = equity * RISK_FRACTION;
          const qty = riskBudget / perUnitRisk;
          active = { side, entryTime: next.time, entry, stop, target, qty };
        }
      }
    }
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }
  const wins = trades.filter(t => t.pnl > 0).length;
  const net = equity - INITIAL_EQUITY;
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const report = {
    disclaimer: "Research backtest only; not a performance guarantee. Verify model semantics and execution assumptions before live use.",
    config: { symbol: SYMBOL, market: "Binance USDT-M perpetual", interval: INTERVAL, days: DAYS, initialEquity: INITIAL_EQUITY, riskFraction: RISK_FRACTION, feeRatePerSide: FEE_RATE, slippageFractionPerFill: SLIPPAGE, warmupCandles: WARMUP, strategy: "SMC ACTIVE setup + aligned EliteWave primary count (quality >= 50)", execution: "signal on close; next candle open entry; stop-first on same-candle stop/target ambiguity; no overlapping positions" },
    data: { candles: candles.length, firstOpenTime: candles[0].time, lastOpenTime: candles[candles.length - 1].time },
    summary: { initialEquity: INITIAL_EQUITY, finalEquity: equity, netPnl: net, returnPct: net / INITIAL_EQUITY * 100, trades: trades.length, wins, losses: trades.length - wins, winRatePct: trades.length ? wins / trades.length * 100 : 0, profitFactor: grossLoss ? grossProfit / grossLoss : null, maxDrawdownPct: maxDrawdown * 100, openPositionAtEnd: !!active },
    trades,
    signals
  };
  const out = `backtest-${SYMBOL}-${INTERVAL}-${DAYS}d-${Date.now()}.json`;
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output: out, ...report.summary, candles: candles.length }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
