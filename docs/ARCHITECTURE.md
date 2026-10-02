# QuantStructure — Analysis Architecture

SMC, Elliott Wave, Order Flow, and Reversal are independent analysis engines. They share normalized closed-candle market data, but one engine does not rewrite another engine's output.

## Data and normalization
- Binance Spot, USDⓈ-M Futures, and COIN-M Futures provide the live kline stream.
- Realtime candles are normalized by timestamp, malformed/duplicate data is rejected, and analysis stops at the first forming candle.
- Binance aggregate trades feed the footprint engine. Footprint confirmation is separate from kline taker-buy flow.

## Analysis modules
- **SMC:** HH/HL/LH/LL pivots, BOS/CHOCH, liquidity pools/equal highs/lows, liquidity sweeps, FVG, order blocks, breakers, premium/discount, causal entry zones, stop/targets, and closed-candle confirmation.
- **Elliott / EliteWave:** impulse and diagonal validation, zigzag/flat/double-zigzag/triangle correction candidates, primary/alternative counts, Fibonacci relationships, nested-wave evidence, invalidation, and live ABC continuation setup.
- **Order Flow:** Binance taker flow, footprint delta, stacked imbalances, absorption, liquidity sweeps, microstructure, target/geometry gates, and diagnostics.
- **Reversal Engine:** sweep → opposite CHOCH → directional displacement → zone → order-flow confluence, with optional structural-MTF mode.
- **MTF:** 4h/1h/15m/5m context for SMC/Elliott and 15m/5m/1h reversal context.
- **Risk / Backtest:** exchange-aware sizing for linear/inverse contracts and conservative closed-candle SMC backtesting with fee/slippage controls.
- **News Filter:** server-side calendar proxy with fail-closed behavior when the calendar is unavailable.

## UI and chart
1. SMC Analysis
2. Elliott Wave
3. Combined Analysis
4. Order Flow Analysis

The chart uses Lightweight Charts for price candles and an SVG annotation layer for auto-drawn structure, zones, liquidity, Elliott waves, order-flow footprint markers, and reversal markers. Analysis overlays use closed-candle timestamps rather than positional assumptions.

## Safety gates
Confirmed outputs require closed candles and valid geometry. Historical Elliott counts are labeled separately from live entry setups. Order Flow confirmation requires complete validated Binance footprint coverage. Execution is disabled; the dashboard is an analysis workstation, not an order executor.
