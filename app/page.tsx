"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
} from "lightweight-charts";
import { analyzeSMC, analyzeElliott, Candle } from "../src/analysis/engine";

type Mode = "smc" | "elliott" | "combined";
type BinanceSymbol = { symbol: string; baseAsset: string; quoteAsset: string };
const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export default function Home() {
  const [mode, setMode] = useState<Mode>("smc");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<(typeof intervals)[number]>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [pairs, setPairs] = useState<BinanceSymbol[]>([]);
  const [pairSearch, setPairSearch] = useState("");
  const [quoteFilter, setQuoteFilter] = useState("USDT");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const chartRef = useRef<HTMLDivElement>(null);
  const chartObj = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const overlayRef = useRef<any[]>([]);
  const waveSeriesRef = useRef<any[]>([]);
  const markersRef = useRef<any>(null);
  const [chartViewportTick, setChartViewportTick] = useState(0);

  const smc = useMemo(() => analyzeSMC(candles), [candles]);
  const elliott = useMemo(() => analyzeElliott(candles), [candles]);
  const combined = Math.round((smc.score + elliott.score) / 2);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const priceChange = last && previous ? ((last.close - previous.close) / previous.close) * 100 : 0;

  useEffect(() => {
    let stop = false;
    fetch("https://api.binance.com/api/v3/exchangeInfo")
      .then((r) => r.json())
      .then((d) => {
        if (stop) return;
        setPairs(
          (d.symbols || [])
            .filter((x: any) => x.status === "TRADING")
            .map((x: any) => ({
              symbol: x.symbol,
              baseAsset: x.baseAsset,
              quoteAsset: x.quoteAsset,
            }))
        );
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    let ws: WebSocket | undefined;
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setCandles([]);
    setConnected(false);
    setLoading(true);

    const load = async () => {
      try {
        setError("");
        const r = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=250`
        );
        if (!r.ok) throw Error("Unable to load Binance market data");
        const rows = await r.json();
        if (stop) return;

        setCandles(
          rows.map((x: any) => ({
            time: x[0],
            open: +x[1],
            high: +x[2],
            low: +x[3],
            close: +x[4],
            volume: +x[5],
          }))
        );
        setLoading(false);

        const connect = () => {
          if (stop) return;
          ws = new WebSocket(
            `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`
          );
          ws.onopen = () => setConnected(true);
          ws.onclose = () => {
            setConnected(false);
            if (!stop) retry = setTimeout(connect, 2500);
          };
          ws.onerror = () => setConnected(false);
          ws.onmessage = (e) => {
            const k = JSON.parse(e.data).k;
            if (!k) return;
            const c = {
              time: k.t,
              open: +k.o,
              high: +k.h,
              low: +k.l,
              close: +k.c,
              volume: +k.v,
            };
            setCandles((p) => {
              const a = [...p];
              const i = a.findIndex((x) => x.time === c.time);
              if (i >= 0) a[i] = c;
              else a.push(c);
              return a.slice(-250);
            });
          };
        };
        connect();
      } catch (e) {
        if (!stop) {
          setLoading(false);
          setError(e instanceof Error ? e.message : "Market data error");
        }
      }
    };

    load();
    return () => {
      stop = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [symbol, interval]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      autoSize: true,
      height: 500,
      layout: { background: { color: "#0b0f15" }, textColor: "#8792a5" },
      grid: {
        vertLines: { color: "#151b25" },
        horzLines: { color: "#151b25" },
      },
      rightPriceScale: { borderColor: "#26303f", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: "#26303f",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 8,
      },
      crosshair: { mode: 0 },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#36d399",
      downColor: "#f06b78",
      borderVisible: false,
      wickUpColor: "#36d399",
      wickDownColor: "#f06b78",
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartObj.current = chart;
    seriesRef.current = series;
    const onViewportChange = () => setChartViewportTick((v) => v + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onViewportChange);

    return () => {
      overlayRef.current.forEach((x) => {
        try {
          series.removePriceLine(x);
        } catch {}
      });
      waveSeriesRef.current.forEach((x) => {
        try {
          chart.removeSeries(x);
        } catch {}
      });
      overlayRef.current = [];
      waveSeriesRef.current = [];
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onViewportChange); } catch {}
      chart.remove();
      chartObj.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartObj.current;
    const series = seriesRef.current;
    if (!chart || !series || candles.length < 2) return;

    series.setData(
      candles.map((c) => ({
        time: Math.floor(c.time / 1000) as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    overlayRef.current.forEach((x) => {
      try {
        series.removePriceLine(x);
      } catch {}
    });
    overlayRef.current = [];

    waveSeriesRef.current.forEach((x) => {
      try {
        chart.removeSeries(x);
      } catch {}
    });
    waveSeriesRef.current = [];

    if (mode !== "elliott") {
      smc.events.slice(-6).forEach((e) =>
        overlayRef.current.push(
          series.createPriceLine({
            price: e.price,
            color: e.direction === "bullish" ? "#36d399" : "#f06b78",
            lineWidth: 1 as any,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: e.type,
          })
        )
      );

      smc.orderBlocks.slice(-4).forEach((o) => {
        overlayRef.current.push(
          series.createPriceLine({
            price: o.low,
            color: o.type === "bullish" ? "#36d399" : "#f06b78",
            lineWidth: 1 as any,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: "OB",
          })
        );
        overlayRef.current.push(
          series.createPriceLine({
            price: o.high,
            color: o.type === "bullish" ? "#36d399" : "#f06b78",
            lineWidth: 1 as any,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: "",
          })
        );
      });

      smc.fvgs.slice(-4).forEach((x) => {
        overlayRef.current.push(
          series.createPriceLine({
            price: x.low,
            color: "#5ea7ff",
            lineWidth: 1 as any,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: x.filled ? "FVG ✓" : "FVG",
          })
        );
        overlayRef.current.push(
          series.createPriceLine({
            price: x.high,
            color: "#5ea7ff",
            lineWidth: 1 as any,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: "",
          })
        );
      });

      smc.liquidityHighs.slice(-3).forEach((p) =>
        overlayRef.current.push(
          series.createPriceLine({
            price: p.price,
            color: "#e1b85a",
            lineWidth: 1 as any,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: "LQH",
          })
        )
      );

      smc.liquidityLows.slice(-3).forEach((p) =>
        overlayRef.current.push(
          series.createPriceLine({
            price: p.price,
            color: "#e1b85a",
            lineWidth: 1 as any,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: "LQL",
          })
        )
      );
    }

    if (mode !== "smc" && elliott.primary) {
      const ls = chart.addSeries(LineSeries, {
        lineWidth: 2,
        color: "#b77cff",
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const pts = elliott.primary.points.map((p) => ({
        time: Math.floor(candles[p.index].time / 1000) as any,
        value: p.price,
      }));
      ls.setData(pts);
      waveSeriesRef.current.push(ls);
    }

    if (markersRef.current) {
      try {
        markersRef.current.setMarkers([]);
      } catch {}
    }

    const markers = smc.sweeps
      .filter((s) => candles[s.index])
      .map((s) => ({
        time: Math.floor(candles[s.index].time / 1000) as any,
        position: s.type === "low" ? "belowBar" : "aboveBar",
        color: "#e1b85a",
        shape: s.type === "low" ? "arrowUp" : "arrowDown",
        text: "SWEEP",
      }));

    try {
      if (!markersRef.current) markersRef.current = createSeriesMarkers(series, markers as any);
      else markersRef.current.setMarkers(markers as any);
    } catch {}
  }, [candles, mode, smc, elliott]);

  useEffect(() => {
    if (chartObj.current && candles.length) chartObj.current.timeScale().fitContent();
  }, [symbol, interval]);

  const filtered = pairs
    .filter(
      (p) =>
        (quoteFilter === "ALL" || p.quoteAsset === quoteFilter) &&
        p.symbol.includes(pairSearch)
    )
    .slice(0, 500);

  const resetChart = () => chartObj.current?.timeScale().fitContent();

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">QUANT<span>STRUCTURE</span></div>
          <div className="subtitle">Institutional-style market structure workstation</div>
        </div>

        <div className="market-selector">
          <div className="selector-search">
            <span>⌕</span>
            <input
              value={pairSearch}
              onChange={(e) => setPairSearch(e.target.value.toUpperCase())}
              placeholder="Search symbol"
            />
          </div>
          <select value={quoteFilter} onChange={(e) => setQuoteFilter(e.target.value)}>
            <option value="USDT">USDT</option>
            <option value="USDC">USDC</option>
            <option value="BTC">BTC</option>
            <option value="FDUSD">FDUSD</option>
            <option value="ALL">ALL</option>
          </select>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {filtered.length ? (
              filtered.map((p) => <option key={p.symbol}>{p.symbol}</option>)
            ) : (
              <option value={symbol}>{symbol}</option>
            )}
          </select>
        </div>

        <div className="top-status">
          <span className="data-status"><i className={connected ? "pulse live-dot" : "live-dot"} />{connected ? "LIVE DATA" : "CONNECTING"}</span>
          <span className="source-badge">BINANCE</span>
        </div>
      </header>

      <section className="controlbar">
        <div className="instrument">
          <strong>{symbol}</strong>
          <span>{interval}</span>
          {last && <b>{last.close.toLocaleString(undefined, { maximumFractionDigits: 8 })}</b>}
          {last && <em className={priceChange >= 0 ? "positive" : "negative"}>{priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%</em>}
        </div>

        <div className="timeframes">
          {intervals.map((t) => (
            <button className={interval === t ? "active" : ""} onClick={() => setInterval(t)} key={t}>{t}</button>
          ))}
        </div>

        <div className="analysis-tabs">
          {([
            ["smc", "SMC"],
            ["elliott", "ELLIOTT WAVE"],
            ["combined", "COMBINED"],
          ] as const).map(([key, label]) => (
            <button className={mode === key ? "active" : ""} onClick={() => setMode(key)} key={key}>{label}</button>
          ))}
        </div>
      </section>

      {error && <div className="alert">{error}</div>}

      <section className="terminal-grid">
        <div className="chart-column">
          <div className="panel-card chart-card">
            <div className="panel-header">
              <div>
                <span className="eyebrow">PRICE ACTION</span>
                <h2>{symbol} <small>{interval}</small></h2>
              </div>
              <div className="chart-actions">
                <span>{candles.length} candles</span>
                <button onClick={resetChart}>RESET VIEW</button>
              </div>
            </div>
            <div className="chart-wrap">
              <div className="chartarea" ref={chartRef} />
              <ChartAnnotations chart={chartObj.current} candles={candles} smc={smc} elliott={elliott} mode={mode} tick={chartViewportTick} />
              {loading && <div className="chart-loading"><span />Loading market data…</div>}
            </div>
            <div className="chart-footer">
              <span><i className="legend-dot smc-dot" /> SMC structure</span>
              <span><i className="legend-dot wave-dot" /> Elliott path</span>
              <span><i className="legend-dot liq-dot" /> Liquidity</span>
              <span className="chart-tip">Wheel / pinch: zoom · drag: pan</span>
            </div>
          </div>

          <div className="metric-grid">
            <MetricCard title="MARKET STRUCTURE">
              <Row k="Trend" v={smc.trend} />
              <Row k="Latest structure" v={smc.pivots.at(-1)?.label || "—"} />
              <Row k="BOS / CHOCH" v={smc.events.at(-1)?.type || "None"} />
            </MetricCard>
            <MetricCard title="LIQUIDITY & ZONES">
              <Row k="Unfilled FVG" v={String(smc.fvgs.filter((x) => !x.filled).length)} />
              <Row k="Active OB" v={String(smc.orderBlocks.filter((x) => !x.mitigated).length)} />
              <Row k="Liquidity" v={`${smc.liquidityHighs.length}H / ${smc.liquidityLows.length}L`} />
            </MetricCard>
            <MetricCard title="MODEL SCORES">
              <ScoreRow label="SMC" value={smc.score} />
              <ScoreRow label="ELLIOTT" value={elliott.score} />
              <ScoreRow label="CONFLUENCE" value={combined} />
            </MetricCard>
          </div>
        </div>

        <aside className="analysis-column">
          <div className="panel-card analysis-card">
            <div className="panel-header compact">
              <div>
                <span className="eyebrow">ENGINE OUTPUT</span>
                <h2>{mode === "smc" ? "SMC ANALYSIS" : mode === "elliott" ? "ELLIOTT WAVE" : "COMBINED ANALYSIS"}</h2>
              </div>
              <span className="mode-badge">{mode.toUpperCase()}</span>
            </div>

            {(mode === "smc" || mode === "combined") && (
              <div className="section-block">
                <div className="section-title">SMART MONEY CONCEPT</div>
                <Row k="Trend" v={smc.trend} />
                <Row k="Premium / Discount" v={smc.premiumDiscount} />
                <Row k="Liquidity sweeps" v={String(smc.sweeps.length)} />
                {smc.entryZone && (
                  <>
                    <Row k="Entry zone" v={`${smc.entryZone.low.toFixed(2)} – ${smc.entryZone.high.toFixed(2)}`} />
                    <Row k="Stop loss" v={smc.stop?.toFixed(2) || "—"} />
                    <Row k="Targets" v={smc.targets.map((x) => x.toFixed(2)).join(" · ") || "—"} />
                  </>
                )}
              </div>
            )}

            {(mode === "elliott" || mode === "combined") && (
              <div className="section-block">
                <div className="section-title">ELLIOTT WAVE</div>
                <Row k="Current phase" v={elliott.phase} />
                <Row k="Primary count" v={elliott.primary ? elliott.primary.points.map((p) => p.label).join(" → ") : "No candidate"} />
                <Row k="Direction" v={elliott.primary?.direction || "—"} />
                <Row k="Alternative" v={elliott.alternative ? "Available" : "None"} />
                <Row k="ABC correction" v={elliott.correction ? "Candidate" : "None"} />
                <Row k="Invalidation" v={elliott.primary?.invalidation.toFixed(2) || "—"} />
              </div>
            )}

            {mode === "combined" && (
              <div className="confluence-box">
                <div><span>CONFLUENCE</span><strong>{combined}<small>/100</small></strong></div>
                <p>Independent SMC + Elliott scores shown together. This is analysis only.</p>
              </div>
            )}
          </div>

          <div className="panel-card feed-card">
            <div className="section-title">SYSTEM STATUS</div>
            <div className="status-line"><span>REST API</span><b className="positive">CONNECTED</b></div>
            <div className="status-line"><span>WebSocket</span><b className={connected ? "positive" : "negative"}>{connected ? "LIVE" : "RECONNECTING"}</b></div>
            <div className="status-line"><span>Engine</span><b className="positive">READY</b></div>
            <div className="status-line"><span>Execution</span><b>DISABLED</b></div>
          </div>
        </aside>
      </section>

      <footer className="footer">
        <span>QUANTSTRUCTURE · MARKET ANALYSIS WORKSTATION</span>
        <span>Binance market data · SMC and Elliott engines operate independently</span>
      </footer>
    </main>
  );
}

function ChartAnnotations({ chart, candles, smc, elliott, mode, tick }: { chart: any; candles: Candle[]; smc: any; elliott: any; mode: Mode; tick: number }) {
  const wrap = chart?.containerElement?.() as HTMLElement | undefined;
  const width = wrap?.clientWidth || 0;
  const height = wrap?.clientHeight || 0;
  if (!chart || !candles.length || !width || !height) return null;

  const ts = chart.timeScale();
  const series = chart.priceScale("right");
  const xOf = (index: number) => ts.timeToCoordinate(Math.floor(candles[index]?.time / 1000) as any);
  const yOf = (price: number) => series.priceToCoordinate(price);
  const lastIndex = candles.length - 1;
  const xLast = xOf(lastIndex) ?? width;
  const x0 = Math.max(0, xOf(0) ?? 0);

  const label = (x: number | null, y: number | null, text: string, cls: string) =>
    x == null || y == null ? null : <g><rect x={x - 4} y={y - 13} width={Math.max(30, text.length * 6 + 8)} height="16" rx="3" className={cls}/><text x={x} y={y - 2} className="chart-label">{text}</text></g>;

  const zone = (low: number, high: number, start: number | undefined, cls: string, title: string) => {
    const a = Math.max(0, start ?? Math.max(0, lastIndex - 40));
    const x1 = xOf(a) ?? x0;
    const x2 = xLast;
    const y1 = yOf(high), y2 = yOf(low);
    if (y1 == null || y2 == null) return null;
    return <g><rect x={Math.min(x1,x2)} y={Math.min(y1,y2)} width={Math.abs(x2-x1)} height={Math.abs(y2-y1)} className={cls}/>{label(Math.min(x1,x2)+6, Math.min(y1,y2)+18, title, cls+"-label")}</g>;
  };

  const eventLines = mode !== "elliott" ? smc.events.slice(-8).map((e: any, i: number) => {
    const idx = e.index ?? e.at ?? lastIndex;
    const x = xOf(idx);
    const y = yOf(e.price);
    if (x == null || y == null) return null;
    return <g key={"event"+i}><line x1={x} x2={x} y1={0} y2={height} className={e.type === "CHOCH" ? "choch-line" : "bos-line"}/>{label(x + 6, y, e.type, e.type === "CHOCH" ? "choch-label" : "bos-label")}</g>;
  }) : null;

  const pivotLabels = mode !== "elliott" ? smc.pivots.slice(-12).map((p: any, i: number) => {
    const x = xOf(p.index), y = yOf(p.price);
    return x == null || y == null ? null : <g key={"pivot"+i}>{label(x, y, p.label, "pivot-label")}</g>;
  }) : null;

  const obZones = mode !== "elliott" ? smc.orderBlocks.slice(-4).map((o: any, i: number) =>
    zone(o.low, o.high, o.index ?? o.startIndex, o.type === "bullish" ? "ob-bull" : "ob-bear", "OB")
  ) : null;

  const fvgZones = mode !== "elliott" ? smc.fvgs.slice(-5).map((z: any, i: number) =>
    zone(z.low, z.high, z.index ?? z.startIndex ?? z.createdAt, "fvg-zone", z.filled ? "FVG ✓" : "FVG")
  ) : null;

  const liq = mode !== "elliott" ? [
    ...smc.liquidityHighs.slice(-4).map((p: any) => ({...p, t:"EQH/LQH"})),
    ...smc.liquidityLows.slice(-4).map((p: any) => ({...p, t:"EQL/LQL"}))
  ].map((p: any, i: number) => {
    const x1 = xOf(p.index ?? Math.max(0,lastIndex-80)) ?? x0;
    const y = yOf(p.price);
    return y == null ? null : <g key={"liq"+i}><line x1={x1} x2={xLast} y1={y} y2={y} className="liquidity-line"/>{label(x1+6,y,p.t,"liquidity-label")}</g>;
  }) : null;

  const sweeps = mode !== "elliott" ? smc.sweeps.slice(-8).map((s: any, i: number) => {
    const x=xOf(s.index), y=yOf(s.price ?? (s.type==="low"?candles[s.index]?.low:candles[s.index]?.high));
    return x==null||y==null?null:<g key={"sweep"+i}><path d={s.type==="low" ? `M ${x-7} ${y+9} L ${x} ${y} L ${x+7} ${y+9}` : `M ${x-7} ${y-9} L ${x} ${y} L ${x+7} ${y-9}`} className="sweep-mark"/>{label(x+7,y,"SWEEP","sweep-label")}</g>;
  }) : null;

  const tradeLevels = mode !== "elliott" ? (() => {
    const out:any[]=[];
    if (smc.entryZone) {
      out.push(zone(smc.entryZone.low, smc.entryZone.high, Math.max(0,lastIndex-20), "entry-zone", "ENTRY"));
    }
    if (smc.stop != null) {
      const y=yOf(smc.stop); if(y!=null) out.push(<g key="sl"><line x1={x0} x2={xLast} y1={y} y2={y} className="sl-line"/>{label(xLast-52,y,"SL","sl-label")}</g>);
    }
    (smc.targets||[]).slice(0,4).forEach((p:number,i:number)=>{const y=yOf(p);if(y!=null)out.push(<g key={"tp"+i}><line x1={xLast-80} x2={xLast} y1={y} y2={y} className="tp-line"/>{label(xLast-42,y,`TP${i+1}`,"tp-label")}</g>)});
    return out;
  })() : null;

  const wave = mode !== "smc" && elliott.primary?.points?.map((p:any,i:number) => {
    const x=xOf(p.index), y=yOf(p.price); if(x==null||y==null)return null;
    const next=elliott.primary.points[i+1]; const nx=next?xOf(next.index):null, ny=next?yOf(next.price):null;
    return <g key={"wave"+i}>{nx!=null&&ny!=null?<line x1={x} y1={y} x2={nx} y2={ny} className="wave-line"/>:<></>}{label(x,y,p.label,"wave-label")}</g>;
  });

  return <svg key={tick} className="chart-overlay" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    {fvgZones}{obZones}{liq}{eventLines}{pivotLabels}{sweeps}{tradeLevels}{wave}
  </svg>;
}

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="panel-card metric-card"><div className="section-title">{title}</div>{children}</div>;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="data-row"><span>{k}</span><b>{v}</b></div>;
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-row">
      <div><span>{label}</span><b>{value}<small>/100</small></b></div>
      <div className="score-track"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}
