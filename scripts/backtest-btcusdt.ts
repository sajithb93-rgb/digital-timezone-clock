import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeSMC, analyzeElliott, type Candle } from "../src/analysis/engine";

const ARCHIVE_BASE = "https://data.binance.vision/data/futures/um/daily/klines";
const SYMBOL = process.env.SYMBOL ?? "BTCUSDT";
const INTERVAL = "5m";
const DAYS = Number(process.env.DAYS ?? 90);
const INITIAL_EQUITY = Number(process.env.INITIAL_EQUITY ?? 10_000);
const RISK_FRACTION = Number(process.env.RISK_FRACTION ?? 0.01);
const FEE_RATE = Number(process.env.FEE_RATE ?? 0.0005);
const SLIPPAGE = Number(process.env.SLIPPAGE ?? 0.0002);
const WARMUP = 500;
const CONCURRENCY = 6;
const ARCHIVE_LAG_DAYS = Number(process.env.ARCHIVE_LAG_DAYS ?? 2);
const execFileAsync = promisify(execFile);

type ArchiveRow = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number;
};

type Trade = {
  side: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  stop: number;
  target: number;
  qty: number;
  pnl: number;
  r: number;
  reason: string;
};

function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addUtcDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000;
}

function parseCsv(content: string, source: string): ArchiveRow[] {
  const rows: ArchiveRow[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = line.split(",");
    const openTime = Number(cols[0]);
    if (!Number.isFinite(openTime)) continue;
    const open = Number(cols[1]);
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    const volume = Number(cols[5]);
    const takerBuyVolume = Number(cols[9]);
    if (![open, high, low, close, volume, takerBuyVolume].every(Number.isFinite)) {
      throw new Error(`Invalid kline row in ${source}`);
    }
    rows.push({ openTime, open, high, low, close, volume, takerBuyVolume });
  }
  return rows;
}

async function downloadDailyArchive(dateKey: string, tempDir: string): Promise<ArchiveRow[]> {
  const filename = `${SYMBOL}-${INTERVAL}-${dateKey}.zip`;
  const url = `${ARCHIVE_BASE}/${SYMBOL}/${INTERVAL}/${filename}`;
  const zipPath = join(tempDir, filename);

  const response = await fetch(url, {
    headers: { "User-Agent": "crypto-trading-analysis-dashboard/backtest" }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Binance Data Vision HTTP ${response.status} for ${dateKey}: ${body.slice(0, 300)}`
    );
  }

  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));

  try {
    const { stdout } = await execFileAsync("unzip", ["-p", zipPath], {
      maxBuffer: 16 * 1024 * 1024
    });
    return parseCsv(stdout, filename);
  } finally {
    await rm(zipPath, { force: true });
  }
}

async function fetchCandles(): Promise<Candle[]> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (!(ARCHIVE_LAG_DAYS >= 1 && ARCHIVE_LAG_DAYS <= 7)) {
    throw new Error("ARCHIVE_LAG_DAYS must be between 1 and 7");
  }

  const currentUtcDay = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate()
  );

  // Binance Vision daily archives can lag behind the UTC calendar.
  // Use a small publication lag and then take exactly DAYS complete UTC days.
  const end = currentUtcDay - (ARCHIVE_LAG_DAYS - 1) * dayMs;
  const start = end - DAYS * dayMs;

  const dates: string[] = [];
  for (let day = start; day < end; day += dayMs) {
    dates.push(utcDateKey(day));
  }

  if (!dates.length) {
    throw new Error("No complete UTC day available for the requested lookback");
  }

  const tempDir = await mkdtemp(join(process.cwd(), ".backtest-"));

  try {
    const all: ArchiveRow[] = [];
    let nextIndex = 0;

    async function worker() {
      while (true) {
        const index = nextIndex++;
        if (index >= dates.length) return;

        const dateKey = dates[index];
        const rows = await downloadDailyArchive(dateKey, tempDir);
        all.push(...rows);
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, dates.length) },
        () => worker()
      )
    );

    const dedup = [...new Map(all.map(r => [r.openTime, r])).values()]
      .sort((a, b) => a.openTime - b.openTime)
      .filter(r => r.openTime >= start && r.openTime < end);

    return dedup.map(r => ({
      time: r.openTime,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      takerBuyVolume: r.takerBuyVolume,
      closed: true
    }));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function applySlippage(price: number, side: "BUY" | "SELL"): number {
  return price * (side === "BUY" ? 1 + SLIPPAGE : 1 - SLIPPAGE);
}

async function main() {
  if (!(DAYS > 0 && INITIAL_EQUITY > 0 && RISK_FRACTION > 0 && RISK_FRACTION <= 0.1)) {
    throw new Error("Invalid DAYS, INITIAL_EQUITY, or RISK_FRACTION");
  }

  const candles = await fetchCandles();

  if (candles.length <= WARMUP + 2) {
    throw new Error(`Not enough candles: ${candles.length}`);
  }

  let equity = INITIAL_EQUITY;
  let peak = equity;
  let maxDrawdown = 0;
  let active:
    Omit<Trade, "exitTime" | "exit" | "pnl" | "r" | "reason"> | null = null;

  const trades: Trade[] = [];
  const signals: unknown[] = [];

  for (let i = WARMUP; i < candles.length - 1; i++) {
    const window = candles.slice(Math.max(0, i - 500), i + 1);
    const signalCandle = candles[i];
    const next = candles[i + 1];

    if (active) {
      const bar = signalCandle;
      const long = active.side === "LONG";
      const stopHit = long ? bar.low <= active.stop : bar.high >= active.stop;
      const targetHit = long ? bar.high >= active.target : bar.low <= active.target;

      if (stopHit || targetHit) {
        const rawExit = stopHit ? active.stop : active.target;
        const exit = applySlippage(rawExit, long ? "SELL" : "BUY");
        const gross = (exit - active.entry) * active.qty * (long ? 1 : -1);
        const fees = (active.entry * active.qty + exit * active.qty) * FEE_RATE;
        const pnl = gross - fees;

        equity += pnl;

        trades.push({
          ...active,
          exitTime: bar.time,
          exit,
          pnl,
          r: pnl / Math.max(active.entry * active.qty * RISK_FRACTION, 1e-9),
          reason: stopHit ? "STOP (stop-first if ambiguous)" : "TARGET"
        });

        active = null;
      }
    }

    if (!active) {
      const smc = analyzeSMC(window);
      const elliott = analyzeElliott(window);
      const setup = smc.setup;
      const wave = elliott.primary;

      const smcSide =
        setup.direction === "BUY"
          ? "LONG"
          : setup.direction === "SELL"
            ? "SHORT"
            : null;

      const waveAligned = !!wave && (
        (smcSide === "LONG" && wave.direction === "bullish") ||
        (smcSide === "SHORT" && wave.direction === "bearish")
      );

      signals.push({
        time: signalCandle.time,
        smc: setup.direction,
        status: setup.status,
        smcScore: smc.score,
        waveDirection: wave?.direction ?? null,
        waveQuality: wave?.quality ?? null,
        waveAligned
      });

      if (
        smcSide &&
        setup.status === "ACTIVE" &&
        waveAligned &&
        wave &&
        wave.quality >= 50 &&
        setup.entry !== null &&
        setup.stop !== null
      ) {
        const side = smcSide;
        const rawEntry = next.open;
        const entry = applySlippage(rawEntry, side === "LONG" ? "BUY" : "SELL");
        const stop = setup.stop;
        const target = setup.targets.find(
          t => side === "LONG" ? t > entry : t < entry
        );
        const perUnitRisk = Math.abs(entry - stop);

        if (
          target !== undefined &&
          perUnitRisk > 0 &&
          (side === "LONG" ? stop < entry : stop > entry)
        ) {
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
  const grossProfit = trades
    .filter(t => t.pnl > 0)
    .reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(
    trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0)
  );

  const report = {
    disclaimer:
      "Research backtest only; not a performance guarantee. Verify model semantics and execution assumptions before live use.",
    config: {
      symbol: SYMBOL,
      market: "Binance USDT-M perpetual",
      interval: INTERVAL,
      days: DAYS,
      initialEquity: INITIAL_EQUITY,
      riskFraction: RISK_FRACTION,
      feeRatePerSide: FEE_RATE,
      slippageFractionPerFill: SLIPPAGE,
      warmupCandles: WARMUP,
      strategy: "SMC ACTIVE setup + aligned EliteWave primary count (quality >= 50)",
      execution:
        "signal on close; next candle open entry; stop-first on same-candle stop/target ambiguity; no overlapping positions",
      dataSource: "Binance Vision USD-M Futures daily kline archives",
      archiveLagDays: ARCHIVE_LAG_DAYS,
      archiveWindow:
        "exactly DAYS complete UTC calendar days, ending ARCHIVE_LAG_DAYS-1 days before the current UTC day"
    },
    data: {
      candles: candles.length,
      firstOpenTime: candles[0].time,
      lastOpenTime: candles[candles.length - 1].time
    },
    summary: {
      initialEquity: INITIAL_EQUITY,
      finalEquity: equity,
      netPnl: net,
      returnPct: net / INITIAL_EQUITY * 100,
      trades: trades.length,
      wins,
      losses: trades.length - wins,
      winRatePct: trades.length ? wins / trades.length * 100 : 0,
      profitFactor: grossLoss ? grossProfit / grossLoss : null,
      maxDrawdownPct: maxDrawdown * 100,
      openPositionAtEnd: !!active
    },
    trades,
    signals
  };

  const out = `backtest-${SYMBOL}-${INTERVAL}-${DAYS}d-${Date.now()}.json`;
  await writeFile(out, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      { output: out, ...report.summary, candles: candles.length },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
