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
const MIN_TARGET_RR = Number(process.env.MIN_TARGET_RR ?? 1.5);
const MAX_ENTRY_DEVIATION_ATR = Number(process.env.MAX_ENTRY_DEVIATION_ATR ?? 0.5);
const ELLIOTT_MAX_AGE_BARS = Number(process.env.ELLIOTT_MAX_AGE_BARS ?? 144);
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
  plannedEntry: number;
  entry: number;
  stop: number;
  target: number;
  entryDeviationAtr: number;
  qty: number;
  riskAmount: number;
  grossPnl: number;
  fees: number;
  pnl: number;
  r: number;
  reason: string;
};

function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
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

function trueRange(c: Candle[], i: number): number {
  if (i <= 0) return c[i].high - c[i].low;
  return Math.max(
    c[i].high - c[i].low,
    Math.abs(c[i].high - c[i - 1].close),
    Math.abs(c[i].low - c[i - 1].close)
  );
}

function atrAt(c: Candle[], end: number, n = 14): number {
  if (!c.length || end < 0) return 0;
  const e = Math.min(end, c.length - 1);
  const start = Math.max(0, e - n + 1);
  const total = c.slice(start, e + 1).reduce((sum, _, offset) => sum + trueRange(c, start + offset), 0);
  return total / Math.max(1, e - start + 1);
}

function applySlippage(price: number, side: "BUY" | "SELL"): number {
  return price * (side === "BUY" ? 1 + SLIPPAGE : 1 - SLIPPAGE);
}

function isFavorableTarget(side: "LONG" | "SHORT", entry: number, target: number): boolean {
  return side === "LONG" ? target > entry : target < entry;
}

async function main() {
  if (
    !(DAYS > 0 && INITIAL_EQUITY > 0 && RISK_FRACTION > 0 && RISK_FRACTION <= 0.1) ||
    !(MIN_TARGET_RR > 0 && MIN_TARGET_RR <= 10) ||
    !(MAX_ENTRY_DEVIATION_ATR >= 0 && MAX_ENTRY_DEVIATION_ATR <= 5) ||
    !(Number.isInteger(ELLIOTT_MAX_AGE_BARS) && ELLIOTT_MAX_AGE_BARS >= 1 && ELLIOTT_MAX_AGE_BARS <= 1000)
  ) {
    throw new Error("Invalid backtest configuration");
  }

  const candles = await fetchCandles();

  if (candles.length <= WARMUP + 2) {
    throw new Error(`Not enough candles: ${candles.length}`);
  }

  let equity = INITIAL_EQUITY;
  let peak = equity;
  let maxDrawdown = 0;
  let active: Omit<Trade, "exitTime" | "grossPnl" | "fees" | "pnl" | "r" | "reason"> | null = null;

  const trades: Trade[] = [];
  const signals: unknown[] = [];
  const seenSignals = new Set<string>();
  const rejections = {
    staleElliott: 0,
    invalidatedElliott: 0,
    duplicateSetup: 0,
    entryDeviation: 0,
    invalidEntrySide: 0,
    insufficientRR: 0
  };

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
        const grossPnl = (exit - active.entry) * active.qty * (long ? 1 : -1);
        const fees = (active.entry * active.qty + exit * active.qty) * FEE_RATE;
        const pnl = grossPnl - fees;

        equity += pnl;

        trades.push({
          ...active,
          exitTime: bar.time,
          grossPnl,
          fees,
          pnl,
          r: pnl / Math.max(active.riskAmount, 1e-9),
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
      const waveEndIndex = wave?.points.at(-1)?.index ?? -Infinity;
      const waveAge = Number.isFinite(waveEndIndex) ? i - waveEndIndex : Infinity;
      const waveFresh = !!wave && waveAge >= 0 && waveAge <= ELLIOTT_MAX_AGE_BARS;
      const waveValid = !!wave && elliott.setupState !== "INVALIDATED";

      signals.push({
        time: signalCandle.time,
        smc: setup.direction,
        status: setup.status,
        smcScore: smc.score,
        waveDirection: wave?.direction ?? null,
        waveQuality: wave?.quality ?? null,
        waveAligned: !!wave && waveValid && waveFresh && (
          (setup.direction === "BUY" && wave.direction === "bullish") ||
          (setup.direction === "SELL" && wave.direction === "bearish")
        ),
        waveAgeBars: Number.isFinite(waveAge) ? waveAge : null,
        waveState: elliott.setupState
      });

      if (elliott.setupState === "INVALIDATED") {
        rejections.invalidatedElliott++;
      }
      if (wave && !waveFresh) {
        rejections.staleElliott++;
      }

      const smcSide =
        setup.direction === "BUY"
          ? "LONG"
          : setup.direction === "SELL"
            ? "SHORT"
            : null;

      const waveAligned = !!wave &&
        waveValid &&
        waveFresh &&
        wave.quality >= 50 &&
        ((smcSide === "LONG" && wave.direction === "bullish") ||
          (smcSide === "SHORT" && wave.direction === "bearish"));

      if (
        smcSide &&
        setup.status === "ACTIVE" &&
        waveAligned &&
        setup.entry !== null &&
        setup.stop !== null
      ) {
        const side = smcSide;
        const plannedEntry = setup.entry;
        const rawEntry = next.open;
        const signalAtr = atrAt(window, window.length - 1, 14);
        const entryDeviationAtr = signalAtr > 0
          ? Math.abs(rawEntry - plannedEntry) / signalAtr
          : 0;

        if (entryDeviationAtr > MAX_ENTRY_DEVIATION_ATR) {
          rejections.entryDeviation++;
          continue;
        }

        const entry = applySlippage(rawEntry, side === "LONG" ? "BUY" : "SELL");
        const stop = setup.stop;

        if ((side === "LONG" && stop >= entry) || (side === "SHORT" && stop <= entry)) {
          rejections.invalidEntrySide++;
          continue;
        }

        const perUnitRisk = Math.abs(entry - stop);
        if (!(perUnitRisk > 0 && Number.isFinite(perUnitRisk))) {
          rejections.invalidEntrySide++;
          continue;
        }

        const target = setup.targets
          .filter(t => Number.isFinite(t) && t > 0 && isFavorableTarget(side, entry, t))
          .find(t => Math.abs(t - entry) / perUnitRisk >= MIN_TARGET_RR);

        if (target === undefined) {
          rejections.insufficientRR++;
          continue;
        }

        const actualRR = Math.abs(target - entry) / perUnitRisk;
        if (!(actualRR >= MIN_TARGET_RR && Number.isFinite(actualRR))) {
          rejections.insufficientRR++;
          continue;
        }

        const eventIndex = smc.events.at(-1)?.index ?? -1;
        const signalKey = [
          eventIndex,
          side,
          plannedEntry.toPrecision(12),
          stop.toPrecision(12),
          waveEndIndex
        ].join("|");

        if (seenSignals.has(signalKey)) {
          rejections.duplicateSetup++;
          continue;
        }
        seenSignals.add(signalKey);

        const riskBudget = equity * RISK_FRACTION;
        const slippageCostPerUnit = entry * SLIPPAGE + stop * SLIPPAGE;
        const feeCostPerUnit = (entry + stop) * FEE_RATE;
        const effectiveRiskPerUnit = perUnitRisk + slippageCostPerUnit + feeCostPerUnit;
        const qty = riskBudget / effectiveRiskPerUnit;
        const riskAmount = perUnitRisk * qty;

        if (!(qty > 0 && Number.isFinite(qty) && riskAmount > 0 && Number.isFinite(riskAmount))) {
          rejections.invalidEntrySide++;
          continue;
        }

        active = {
          side,
          entryTime: next.time,
          plannedEntry,
          entry,
          stop,
          target,
          entryDeviationAtr,
          qty,
          riskAmount
        };
      }
    }

    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / Math.max(peak, 1e-9));
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
      minTargetRR: MIN_TARGET_RR,
      maxEntryDeviationATR: MAX_ENTRY_DEVIATION_ATR,
      elliottMaxAgeBars: ELLIOTT_MAX_AGE_BARS,
      strategy: "SMC ACTIVE setup + current aligned EliteWave primary count (quality >= 50)",
      execution:
        "signal on close; next candle open entry only when close-to-plan deviation is within the ATR guard; stop-first on same-candle stop/target ambiguity; no overlapping positions",
      positionSizing:
        "risk budget includes estimated stop slippage and round-trip fees so worst-case stop loss is closer to the configured equity risk",
      rBasis: "PnL divided by price-stop risk amount (entry-stop distance x quantity)",
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
      openPositionAtEnd: !!active,
      rejections
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
