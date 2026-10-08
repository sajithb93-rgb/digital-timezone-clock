"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateSMCSignal, type SMCSignal } from "../../src/analysis/smcSignalEngine";
import type { Candle } from "../../src/analysis/engine";

const intervals = ["5m", "15m", "1h", "4h"] as const;
const refreshIntervals: Record<(typeof intervals)[number], number> = {
  "5m": 60_000,
  "15m": 120_000,
  "1h": 180_000,
  "4h": 300_000,
};
const SCAN_CONCURRENCY = 6;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 700;
const KLINE_LIMIT = 160;

type PairSignal = SMCSignal & { symbol: string; lastPrice: number };
type ScanState = "idle" | "loading" | "done";

function toCandles(rows: unknown[]): Candle[] {
  const lastIndex = rows.length - 1;
  return rows
    .map((r: any, index) => ({
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closed: index !== lastIndex,
    }))
    .filter(c => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite));
}

async function fetchJson(url: string, attempt = 0, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { cache: "no-store", signal });
  const data = await res.json();
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 5000)
      : RETRY_BASE_MS * (attempt + 1);
    await new Promise(resolve => window.setTimeout(resolve, delay));
    return fetchJson(url, attempt + 1, signal);
  }
  if (!res.ok) {
    const error = new Error(data?.error || "Binance request failed");
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return data;
}

export default function SMCSignalPage() {
  const [interval, setInterval] = useState<(typeof intervals)[number]>("5m");
  const [signals, setSignals] = useState<PairSignal[]>([]);
  const [pairCount, setPairCount] = useState(0);
  const [scannedCount, setScannedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [error, setError] = useState("");
  const [scannedAt, setScannedAt] = useState("");
  const [selected, setSelected] = useState<PairSignal | null>(null);
  const requestInFlight = useRef(false);
  const scanAbortRef = useRef<AbortController | null>(null);\n  const scanGenerationRef = useRef(0);

  const scanAllPairs = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const generation = ++scanGenerationRef.current;
    const controller = new AbortController();
    scanAbortRef.current = controller;
    setScanState("loading");
    setError("");
    setSignals([]);
    setSelected(null);
    setScannedCount(0);
    setFailedCount(0);

    try {
      const info = await fetchJson("/api/binance?market=usdm&path=/exchangeInfo", 0, controller.signal);
      const symbols = Array.isArray(info?.symbols)
        ? info.symbols
            .filter((x: any) =>
              x?.status === "TRADING" &&
              x?.contractType === "PERPETUAL" &&
              x?.quoteAsset === "USDT"
            )
            .map((x: any) => String(x.symbol).toUpperCase())
            .filter((x: string) => /^[A-Z0-9]+$/.test(x))
        : [];

      const uniqueSymbols = [...new Set(symbols)];
      if (!uniqueSymbols.length) throw new Error("No active Binance USDⓈ-M USDT perpetual pairs returned");

      setPairCount(uniqueSymbols.length);

      const found: PairSignal[] = [];
      let cursor = 0;

      const worker = async () => {
        while (true) {
          if (generation !== scanGenerationRef.current || controller.signal.aborted) return;
          const index = cursor++;
          if (index >= uniqueSymbols.length) return;
          const symbol = uniqueSymbols[index];

          try {
            const q = new URLSearchParams({
              market: "usdm",
              path: "/klines",
              symbol,
              interval,
              limit: String(KLINE_LIMIT),
            });
            const data = await fetchJson("/api/binance?" + q.toString(), 0, controller.signal);
            if (!Array.isArray(data)) throw new Error("Invalid kline response");

            const candles = toCandles(data);
            if (candles.length < 60) throw new Error("Insufficient candle history");

            const signal = generateSMCSignal(candles, candles.length - 1, interval);
            if (signal) {
              found.push({
                ...signal,
                symbol,
                lastPrice: candles[candles.length - 2]?.close ?? candles[candles.length - 1]?.close ?? 0,
              });
            }
          } catch {
            if (controller.signal.aborted || generation !== scanGenerationRef.current) return;
            setFailedCount(n => n + 1);
          } finally {
            if (generation === scanGenerationRef.current) setScannedCount(n => n + 1);
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(SCAN_CONCURRENCY, uniqueSymbols.length) },
          () => worker(),
        ),
      );

      if (generation !== scanGenerationRef.current || controller.signal.aborted) return;

      const deduped = [...new Map(found.map(signal => [signal.symbol, signal])).values()];
      deduped.sort((a, b) => b.confidence - a.confidence || b.rr - a.rr);
      setSignals(deduped);
      setSelected(deduped[0] ?? null);
      setScannedAt(new Date().toLocaleTimeString());
      setScanState("done");
    } catch (e) {
      if (generation !== scanGenerationRef.current || controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to scan Binance Futures pairs");
      setScanState("idle");
    } finally {
      if (scanAbortRef.current === controller) scanAbortRef.current = null;
      requestInFlight.current = false;
    }
  }, [interval]);

  useEffect(() => {
    void scanAllPairs();
    const timer = window.setInterval(() => void scanAllPairs(), refreshIntervals[interval]);
    return () => {
      window.clearInterval(timer);
      scanGenerationRef.current += 1;
      scanAbortRef.current?.abort();
    };
  }, [scanAllPairs, interval]);

  return (
    <main style={{ minHeight: "100vh", padding: 24, fontFamily: "system-ui", background: "#0b0d10", color: "#f5f7fa" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h1 style={{ marginBottom: 6 }}>SMC Signal Generator — Binance Futures Scanner</h1>
        <p style={{ opacity: 0.7, marginTop: 0 }}>
          Scans all active Binance USDⓈ-M USDT perpetual pairs and returns confirmed SMC setups only.
        </p>

        <section style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "22px 0" }}>
          <select value={interval} onChange={e => setInterval(e.target.value as (typeof intervals)[number])} style={controlStyle}>
            {intervals.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <button onClick={() => void scanAllPairs()} disabled={scanState === "loading"} style={buttonStyle}>
            {scanState === "loading" ? "Scanning all pairs…" : "Scan All Binance Pairs"}
          </button>
          <span style={{ alignSelf: "center", opacity: 0.65, fontSize: 13 }}>
            {pairCount ? `${scannedCount}/${pairCount} pairs` : "Loading pair list…"}{failedCount ? ` · ${failedCount} failed` : ""} · Auto scan {Math.round(refreshIntervals[interval] / 1000)}s
          </span>
        </section>

        {error && <div style={{ padding: 14, borderRadius: 10, background: "#351719", marginBottom: 16 }}>⚠ {error}</div>}

        <section style={{ padding: 18, borderRadius: 12, background: "#12161d", border: "1px solid #252b35", marginBottom: 18 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Confirmed setups</h2>
          {scanState === "loading" && <div style={{ opacity: 0.7 }}>Scanning {pairCount || "Binance"} pairs… pending setups are hidden.</div>}
          {scanState !== "loading" && !signals.length && <div style={{ opacity: 0.7 }}>WAIT — No confirmed SMC setup found in the scanned pairs.</div>}
          {signals.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead><tr>{["Pair", "Signal", "Entry", "SL", "TP1", "RR", "Confidence", "Zone"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {signals.map(s => (
                    <tr key={s.symbol} onClick={() => setSelected(s)} style={{ cursor: "pointer" }}>
                      <td style={tdStyle}><strong>{s.symbol}</strong></td>
                      <td style={{ ...tdStyle, fontWeight: 800 }}>{s.direction}</td>
                      <td style={tdStyle}>{formatPrice(s.entry)}</td>
                      <td style={tdStyle}>{formatPrice(s.stop)}</td>
                      <td style={tdStyle}>{formatPrice(s.targets[0])}</td>
                      <td style={tdStyle}>{s.rr.toFixed(2)}R</td>
                      <td style={tdStyle}>{s.confidence}%</td>
                      <td style={tdStyle}>{s.zoneType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selected && (
          <section style={{ padding: 18, borderRadius: 12, background: "#12161d", border: "1px solid #252b35" }}>
            <h2 style={{ marginTop: 0 }}>{selected.symbol} · {selected.direction} · ACTIVE / CONFIRMED</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
              <Card title="Last confirmed close" value={formatPrice(selected.lastPrice)} />
              <Card title="Entry" value={formatPrice(selected.entry)} />
              <Card title="Stop Loss" value={formatPrice(selected.stop)} />
              <Card title="TP1" value={formatPrice(selected.targets[0])} />
              <Card title="TP2" value={formatPrice(selected.targets[1])} />
              <Card title="RR" value={selected.rr.toFixed(2) + "R"} />
              <Card title="Confidence" value={selected.confidence + "%"} />
              <Card title="Zone / Location" value={selected.zoneType + " / " + selected.premiumDiscount} />
            </div>
            <div style={{ marginTop: 14, opacity: 0.8 }}>
              <strong>Confirmations:</strong> {selected.confirmations.join(" · ")}
            </div>
            <div style={{ marginTop: 8, opacity: 0.55, fontSize: 13 }}>
              Causal sweep → structure → internal confirmation: {selected.sweepIndex} → {selected.structureIndex} → confirmed candle {selected.asOf}
            </div>
          </section>
        )}

        <p style={{ marginTop: 24, opacity: 0.55, fontSize: 13 }}>
          Technical analysis only; no signal guarantees future price movement. Only closed/confirmed candles are eligible.
        </p>
      </div>
    </main>
  );
}

function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value >= 1000 ? value.toFixed(2) : value >= 1 ? value.toFixed(4) : value.toPrecision(6);
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ padding: 14, borderRadius: 10, background: "#0f1319", border: "1px solid #252b35" }}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{title}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 6 }}>{value}</div>
    </div>
  );
}

const controlStyle = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid #333",
  background: "#151922",
  color: "inherit",
} as const;

const buttonStyle = {
  padding: "12px 18px",
  borderRadius: 8,
  border: 0,
  cursor: "pointer",
  fontWeight: 700,
} as const;

const thStyle = {
  textAlign: "left" as const,
  padding: "10px 8px",
  borderBottom: "1px solid #2b313b",
  fontSize: 12,
  opacity: 0.7,
} as const;

const tdStyle = {
  padding: "11px 8px",
  borderBottom: "1px solid #20252d",
  fontSize: 13,
} as const;
