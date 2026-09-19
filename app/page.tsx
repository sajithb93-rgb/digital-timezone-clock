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
              <ChartAnnotations chart={chartObj.current} host={chartRef.current} candles={candles} smc={smc} elliott={elliott} mode={mode} tick={chartViewportTick} />
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

function ChartAnnotations({ chart, host, candles, smc, elliott, mode, tick }: { chart: any; host: HTMLElement | null; candles: Candle[]; smc: any; elliott: any; mode: Mode; tick: number }) {
  const width = host?.clientWidth || 0;
  const height = host?.clientHeight || 0;
  if (!chart || candles.length < 2 || !width || !height) return null;

  const ts = chart.timeScale();
  const series = chart.priceScale("right");
  const xOf = (index: number) => index >= 0 && index < candles.length ? ts.timeToCoordinate(Math.floor(candles[index].time / 1000) as any) : null;
  const yOf = (price: number) => series.priceToCoordinate(price);
  const lastIndex = candles.length - 1;
  const xLast = xOf(lastIndex) ?? width;
  const x0 = Math.max(0, xOf(0) ?? 0);

  const label = (x: number | null, y: number | null, text: string, cls: string) =>
    x == null || y == null ? null : <g>
      <rect x={x - 4} y={y - 14} width={Math.max(34, text.length * 6.2 + 10)} height="18" rx="4" className={cls}/>
      <text x={x + 1} y={y - 2} className="chart-label">{text}</text>
    </g>;

  const zone = (low: number, high: number, start: number | undefined, end: number | undefined, cls: string, title: string) => {
    const a = Math.max(0, Math.min(lastIndex, start ?? Math.max(0, lastIndex - 40)));
    const b = Math.max(a, Math.min(lastIndex, end ?? lastIndex));
    const xa = xOf(a) ?? x0, xb = xOf(b) ?? xLast;
    const y1 = yOf(high), y2 = yOf(low);
    if (y1 == null || y2 == null) return null;
    const left = Math.min(xa, xb), top = Math.min(y1, y2);
    return <g>
      <rect x={left} y={top} width={Math.max(2, Math.abs(xb-xa))} height={Math.max(2, Math.abs(y2-y1))} className={cls}/>
      {label(left + 6, top + 18, title, cls + "-label")}
    </g>;
  };

  const smcVisible = mode !== "elliott";
  const eventLines = smcVisible ? smc.events.slice(-8).map((e: any, i: number) => {
    const idx = e.index;
    const x = xOf(idx), y = yOf(e.price);
    if (x == null || y == null) return null;
    const bullish = e.direction === "bullish";
    const cls = e.type === "CHOCH" ? "choch-line" : "bos-line";
    const arrowY = bullish ? Math.max(22, y - 26) : Math.min(height - 24, y + 26);
    const d = bullish
      ? `M ${x-7} ${arrowY+7} L ${x} ${arrowY} L ${x+7} ${arrowY+7}`
      : `M ${x-7} ${arrowY-7} L ${x} ${arrowY} L ${x+7} ${arrowY-7}`;
    return <g key={"event"+i}>
      <line x1={x} x2={x} y1={Math.min(y,arrowY)} y2={Math.max(y,arrowY)} className={cls}/>
      <path d={d} className={e.type === "CHOCH" ? "choch-arrow" : "bos-arrow"}/>
      {label(x + 9, arrowY, `${e.type} · ${bullish ? "BULL" : "BEAR"}`, e.type === "CHOCH" ? "choch-label" : "bos-label")}
    </g>;
  }) : null;

  const pivotLabels = smcVisible ? smc.pivots.slice(-12).map((p: any, i: number) => {
    const x = xOf(p.index), y = yOf(p.price);
    return x == null || y == null ? null : <g key={"pivot"+i}>{label(x, y, p.label, "pivot-label")}</g>;
  }) : null;

  const obZones = smcVisible ? smc.orderBlocks.slice(-5).map((o: any, i: number) =>
    zone(o.low, o.high, o.index, lastIndex, o.type === "bullish" ? "ob-bull" : "ob-bear", o.type === "bullish" ? "BULL OB" : "BEAR OB")
  ) : null;

  const fvgZones = smcVisible ? smc.fvgs.slice(-6).map((z: any, i: number) =>
    zone(z.low, z.high, z.from, z.to ?? lastIndex, z.type === "bullish" ? "fvg-bull" : "fvg-bear", z.filled ? "FVG ✓" : "FVG")
  ) : null;

  const liq = smcVisible ? [
    ...smc.liquidityHighs.slice(-4).map((p: any) => ({...p, t:"LQ HIGH"})),
    ...smc.liquidityLows.slice(-4).map((p: any) => ({...p, t:"LQ LOW"}))
  ].map((p: any, i: number) => {
    const x1 = xOf(p.index ?? Math.max(0,lastIndex-80)) ?? x0;
    const y = yOf(p.price);
    return y == null ? null : <g key={"liq"+i}>
      <line x1={x1} x2={xLast} y1={y} y2={y} className="liquidity-line"/>
      {label(x1 + 6, y, p.t, "liquidity-label")}
    </g>;
  }) : null;

  const sweeps = smcVisible ? smc.sweeps.slice(-8).map((s: any, i: number) => {
    const x=xOf(s.index), y=yOf(s.price);
    if(x==null||y==null)return null;
    const high = s.type === "high";
    const tipY = high ? y - 22 : y + 22;
    const d = high
      ? `M ${x-8} ${tipY-7} L ${x} ${tipY} L ${x+8} ${tipY-7}`
      : `M ${x-8} ${tipY+7} L ${x} ${tipY} L ${x+8} ${tipY+7}`;
    return <g key={"sweep"+i}>
      <line x1={x} x2={x} y1={y} y2={tipY} className="sweep-mark"/>
      <path d={d} className="sweep-arrow"/>
      {label(x + 9, tipY, high ? "HIGH SWEEP" : "LOW SWEEP", "sweep-label")}
    </g>;
  }) : null;

  const tradeLevels = smcVisible ? (() => {
    const out:any[]=[];
    if (smc.entryZone) out.push(zone(smc.entryZone.low, smc.entryZone.high, Math.max(0,lastIndex-20), lastIndex, "entry-zone", "ENTRY ZONE"));
    if (smc.stop != null) {
      const y=yOf(smc.stop);
      if(y!=null) out.push(<g key="sl"><line x1={x0} x2={xLast} y1={y} y2={y} className="sl-line"/>{label(xLast-55,y,`SL ${smc.stop.toFixed(2)}`,"sl-label")}</g>);
    }
    (smc.targets||[]).slice(0,4).forEach((p:number,i:number)=>{
      const y=yOf(p); if(y!=null) out.push(<g key={"tp"+i}><line x1={xLast-120} x2={xLast} y1={y} y2={y} className="tp-line"/>{label(xLast-92,y,`TP${i+1} ${p.toFixed(2)}`,"tp-label")}</g>);
    });
    return out;
  })() : null;

  const wave = mode !== "smc" && elliott.primary?.points?.map((p:any,i:number) => {
    const x=xOf(p.index), y=yOf(p.price); if(x==null||y==null)return null;
    const next=elliott.primary.points[i+1]; const nx=next?xOf(next.index):null, ny=next?yOf(next.price):null;
    return <g key={"wave"+i}>{nx!=null&&ny!=null?<line x1={x} y1={y} x2={nx} y2={ny} className="wave-line"/>:null}{label(x,y,p.label,"wave-label")}</g>;
  });

  const direction = smc.trend;
  const setup = smc.entryZone && smc.stop != null && smc.targets?.length
    ? (direction === "Bullish" ? "BUY" : direction === "Bearish" ? "SELL" : "WAIT")
    : "WAIT";
  const entryMid = smc.entryZone ? (smc.entryZone.low + smc.entryZone.high) / 2 : null;
  const rr = entryMid != null && smc.stop != null && smc.targets?.[0] != null
    ? Math.abs(smc.targets[0]-entryMid)/Math.abs(entryMid-smc.stop) : null;

  return <div className="chart-overlay-wrap">
    <svg key={tick} className="chart-overlay" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {fvgZones}{obZones}{fibOverlay(chart,candles,elliott,mode,xOf,yOf,x0,xLast,label)}{liq}{eventLines}{pivotLabels}{sweeps}{tradeLevels}{wave}
    </svg>
    {smcVisible && <div className={`setup-panel ${setup.toLowerCase()}`}>
      <div className="setup-head"><span>SMC SETUP</span><strong>{setup}</strong></div>
      <div className="setup-grid">
        <span>Trend<b>{smc.trend}</b></span>
        <span>Score<b>{smc.score}/100</b></span>
        <span>Entry<b>{entryMid != null ? entryMid.toFixed(4) : "—"}</b></span>
        <span>SL<b>{smc.stop != null ? smc.stop.toFixed(4) : "—"}</b></span>
        <span>TP1<b>{smc.targets?.[0]?.toFixed(4) || "—"}</b></span>
        <span>R:R<b>{rr ? rr.toFixed(2)+":1" : "—"}</b></span>
      </div>
      <div className="setup-foot">{smc.events.at(-1)?.type || "NO STRUCTURE"} · {smc.sweeps.length ? "LIQUIDITY SWEPT" : "NO SWEEP"}</div>
    </div>}
  </div>;
}

function fibOverlay(chart:any,candles:Candle[],elliott:any,mode:Mode,xOf:any,yOf:any,x0:number,xLast:number,label:any) {
  if (mode === "smc") return null;
  const pts = elliott.primary?.points || [];
  if (pts.length < 2) return null;
  const a=pts[0], b=pts[pts.length-1], hi=Math.max(a.price,b.price), lo=Math.min(a.price,b.price), range=hi-lo;
  if(!range)return null;
  const levels=[0,.236,.382,.5,.618,.786,1], exts=[1.272,1.618,2,2.618];
  const x1=xOf(Math.max(0,Math.min(a.index,b.index)))??x0;
  return <g>
    {levels.map((r:number)=><g key={"fib"+r}>{(()=>{const price=b.price+(a.price-b.price)*r,y=yOf(price);return y==null?null:<><line x1={x1} x2={xLast} y1={y} y2={y} className="fib-line"/>{label(xLast-70,y,`${(r*100).toFixed(1)}% ${price.toFixed(2)}`,"fib-label")}</>})()}</g>)}
    {exts.map((r:number)=><g key={"ext"+r}>{(()=>{const price=b.price+(a.price-b.price)*r,y=yOf(price);return y==null?null:<><line x1={x1} x2={xLast} y1={y} y2={y} className="fib-ext-line"/>{label(xLast-78,y,`${r.toFixed(3)} EXT ${price.toFixed(2)}`,"fib-ext-label")}</>})()}</g>)}
    <rect x={x1} y={Math.min(yOf(hi-range*.5)??0,yOf(hi-range*.618)??0)} width={Math.max(0,xLast-x1)} height={Math.abs((yOf(hi-range*.5)??0)-(yOf(hi-range*.618)??0))} className="fib-golden-zone"/>
  </g>;
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
