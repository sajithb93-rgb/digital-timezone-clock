"use client";

import { useEffect, useState } from "react";
import { generateSMCSignal, type SMCSignal } from "../../src/analysis/smcSignalEngine";
import type { Candle } from "../../src/analysis/engine";

const intervals = ["5m", "15m", "1h", "4h"] as const;
const markets = [{ value: "usdm", label: "Binance USDⓈ-M Futures" }] as const;

function toCandles(rows: unknown[]): Candle[] {
  return rows
    .map((r: any) => ({
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closed: true,
    }))
    .filter(c => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite));
}

export default function SMCSignalPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<(typeof intervals)[number]>("5m");
  const [signal, setSignal] = useState<SMCSignal | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scannedAt, setScannedAt] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        market: "usdm",
        path: "/klines",
        symbol: symbol.trim().toUpperCase(),
        interval,
        limit: "300",
      });
      const res = await fetch("/api/binance?" + q.toString(), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Binance request failed");
      if (!Array.isArray(data)) throw new Error("Unexpected Binance kline response");

      const candles = toCandles(data);
      if (candles.length < 60) throw new Error("Not enough Binance Futures candle history");

      // Binance returns the currently forming candle last. The engine itself
      // also enforces closed-candle causality, but we explicitly anchor the
      // signal to the latest confirmed candle here.
      const end = candles.length - 2;
      const confirmed = generateSMCSignal(candles, end, interval);

      setSignal(confirmed);
      setPrice(candles[end]?.close ?? null);
      setScannedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setSignal(null);
      setPrice(null);
      setError(e instanceof Error ? e.message : "Failed to load market data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [symbol, interval]);

  return (
    <main style={{ minHeight: "100vh", padding: 24, fontFamily: "system-ui", background: "#0b0d10", color: "#f5f7fa" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <h1 style={{ marginBottom: 6 }}>SMC Signal Engine</h1>
        <p style={{ opacity: 0.7, marginTop: 0 }}>
          Confirmed Binance Futures SMC setups only — closed candles, causal confirmation, minimum 1.5R.
        </p>

        <section style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "22px 0" }}>
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            style={{ padding: 12, borderRadius: 8, border: "1px solid #333", background: "#151922", color: "inherit", width: 150 }}
          />
          <select value={interval} onChange={e => setInterval(e.target.value as (typeof intervals)[number])} style={{ padding: 12, borderRadius: 8, border: "1px solid #333", background: "#151922", color: "inherit" }}>
            {intervals.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <button onClick={() => void load()} disabled={loading} style={{ padding: "12px 18px", borderRadius: 8, border: 0, cursor: "pointer" }}>
            {loading ? "Scanning…" : "Scan Now"}
          </button>
        </section>

        {error && <div style={{ padding: 14, borderRadius: 10, background: "#351719", marginBottom: 16 }}>⚠ {error}</div>}

        {!error && !signal && !loading && (
          <div style={{ padding: 18, borderRadius: 12, background: "#12161d", border: "1px solid #252b35" }}>
            <strong>WAIT — No confirmed SMC setup.</strong>
            <div style={{ opacity: 0.65, marginTop: 6 }}>Pending / incomplete structures are intentionally hidden.</div>
          </div>
        )}

        {signal && (
          <>
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
              <Card title="Signal" value={signal.direction} />
              <Card title="Status" value="ACTIVE / CONFIRMED" />
              <Card title="Last confirmed close" value={price?.toString() ?? "—"} />
              <Card title="Confidence" value={signal.confidence + "%"} />
              <Card title="Entry" value={signal.entry.toFixed(6)} />
              <Card title="Stop Loss" value={signal.stop.toFixed(6)} />
              <Card title="TP1" value={signal.targets[0].toFixed(6)} />
              <Card title="TP2" value={signal.targets[1].toFixed(6)} />
              <Card title="RR (TP1)" value={signal.rr.toFixed(2) + "R"} />
            </section>

            <section style={{ marginTop: 18, padding: 18, borderRadius: 12, background: "#12161d", border: "1px solid #252b35" }}>
              <h2 style={{ fontSize: 18 }}>SMC Confirmations</h2>
              <ul>{signal.confirmations.map(x => <li key={x} style={{ margin: "7px 0" }}>{x}</li>)}</ul>
              <div style={{ opacity: 0.8 }}>
                Zone: {signal.zoneType} · {signal.entryZone.low.toFixed(6)} — {signal.entryZone.high.toFixed(6)} · Location: {signal.premiumDiscount}
              </div>
              <div style={{ opacity: 0.55, fontSize: 13, marginTop: 10 }}>
                Scanned: {scannedAt} · Confirmed candle index: {signal.asOf}
              </div>
            </section>
          </>
        )}

        <p style={{ marginTop: 24, opacity: 0.55, fontSize: 13 }}>
          Technical analysis only; no signal guarantees future price movement.
        </p>
      </div>
    </main>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 12, background: "#12161d", border: "1px solid #252b35" }}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 7 }}>{value}</div>
    </div>
  );
}
