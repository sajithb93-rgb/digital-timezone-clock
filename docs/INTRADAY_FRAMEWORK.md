# Binance Futures Intraday Analysis Framework

## Scope

A decision-support framework for Binance USDⓈ-M Futures intraday analysis using 15m context and 5m setup/confirmation. It is not an execution bot and does not promise predictive accuracy or profitability. Preserve the existing independent SMC and Elliott Wave engines; this framework consumes their outputs rather than rewriting them.

## Analysis pipeline

1. **Market/data validation**
   - Confirm symbol, USDⓈ-M contract, interval, timestamp freshness, and candle completeness.
   - Analyze closed candles only; never treat the currently forming candle as a confirmed signal.
   - Reject insufficient, stale, duplicated, or malformed OHLCV data.
2. **Regime and higher-timeframe context (1H + 15m)**
   - Classify trend/range/unclear using confirmed swing structure and volatility (ATR).
   - Record 1H and 15m bias independently; conflicting or neutral context reduces setup eligibility.
   - Mark recent swing highs/lows and prior session/day levels when data is available.
3. **SMC setup (15m → 5m)**
   - Detect BOS/CHoCH, equal highs/lows, liquidity sweeps, displacement, unmitigated OBs, and FVGs.
   - Prefer a 5m trigger aligned with 15m context: sweep → reclaim/structure shift → displacement/close confirmation.
   - A zone alone is not an entry; require price interaction and a closed-candle trigger.
4. **Volume/derivatives confirmation (supporting evidence only)**
   - Compare volume with a rolling baseline; optionally include taker-buy volume/CVD, open interest change, funding rate, and book imbalance when reliable data is available.
   - Do not infer direction from OI or funding alone. Missing data must be labeled unavailable, not treated as zero or bullish/bearish.
   - Binance futures data is venue-specific; do not label it a complete market-wide footprint.
5. **Risk and trade qualification**
   - Define invalidation from structure, then calculate stop distance and candidate targets from opposing liquidity/structure.
   - Compute R:R after estimated fees and slippage when configured. Enforce user-defined max risk, minimum R:R, and max leverage constraints.
   - Return WAIT if the stop is undefined, data is stale, context conflicts materially, risk limits fail, or no valid trigger exists.
6. **Output and monitoring**
   - Return BUY / SELL / WAIT, context, trigger reason, entry zone (not a guaranteed fill), invalidation/SL, target levels, estimated R:R, evidence list, missing-data flags, and timestamp.
   - Invalidate a setup when its structure/zone is broken or its signal expires. Recompute only on new closed candles.

## Suggested confluence scoring (initial heuristic; must be calibrated)

Use a transparent 0–100 evidence score, not a win probability:

- 25 points: 1H/15m context alignment
- 25 points: 5m confirmed structure shift and displacement
- 20 points: liquidity sweep/reclaim
- 15 points: OB/FVG location quality
- 10 points: volume confirmation
- 5 points: derivatives context (only if fresh/available)

Apply hard gates before scoring: valid closed-candle data, defined invalidation, risk checks passed, and a confirmed trigger. Suggested initial display states: <50 WAIT, 50–69 WATCH, ≥70 QUALIFIED; thresholds are configurable and require historical validation. Score is confluence strength only—not a calibrated probability or recommendation to trade.

## Non-repainting and testing requirements

- Use pivot confirmation time; never backdate a signal to the pivot candle before it was knowable.
- Exclude the forming candle from signal generation and avoid look-ahead in target/zone selection.
- Backtest with chronological splits and realistic taker/maker fees, funding, spread, slippage, and liquidation assumptions.
- Report trade count, win rate, expectancy in R, profit factor, max drawdown, average hold time, and results by symbol/regime. Include out-of-sample and forward-paper testing before live use.
- Do not expose the confluence score as “accuracy %” unless calibrated and validated on unseen data.

## Binance data integration notes

Use public USDⓈ-M Futures market-data endpoints/WebSocket streams for klines and optional aggregate trades, mark price/funding, open interest statistics, and order-book snapshots. Keep API keys out of client code; public market data should not require trading permissions. Respect rate limits and reconnect/resubscribe safely. Use exchange metadata for symbol precision and contract filters.

## UI proposal

Add an **Intraday Confluence** panel alongside existing SMC, Elliott Wave, and Combined Analysis views:

- Symbol + 15m/5m selection
- Regime / 1H & 15m bias
- Setup stage checklist
- BUY / SELL / WAIT state with evidence and timestamp
- Entry zone, SL/invalidation, TP1–TP3, estimated R:R
- Confluence score with explicit “not win probability” label
- Data freshness and unavailable-feed warnings
- Configurable risk and scoring thresholds

## Delivery phases

1. Add pure, deterministic framework module consuming existing `Candle`, `SMCResult`, `ElliottResult`, and MTF outputs.
2. Unit-test closed-candle behavior, conflicting bias, missing data, risk gates, and no-lookahead constraints.
3. Wire into dashboard as a separate panel without changing existing SMC/Elliott outputs.
4. Add optional derivatives feeds and historical validation after core behavior is tested.
