# BTCUSDT SMC + EliteWave backtest runner

The runner downloads Binance USD-M Futures klines and writes a JSON report containing the candle window, signal audit trail, closed trades, and summary metrics.

## Run

```bash
npm install
npm run backtest
```

Defaults: `BTCUSDT`, 5m, trailing 90 days, 10,000 USDT starting equity, 1% equity risk per trade, 0.05% fee per side, and 0.02% adverse slippage per fill. Override with environment variables:

```bash
DAYS=90 INITIAL_EQUITY=10000 RISK_FRACTION=0.01 FEE_RATE=0.0005 SLIPPAGE=0.0002 npm run backtest
```

## Execution model

- SMC and Elliott/EliteWave analysis use only the candle history available at each signal close (500-candle rolling window after a 500-candle warmup).
- Entry is at the next candle open with adverse slippage.
- Position sizing targets 1% of current equity at the entry-to-stop distance; quantity is a linear-contract approximation and does not model exchange lot-size/min-notional filters or funding.
- Stop/target checks occur on subsequent candles. If both are touched in one candle, stop is assumed first.
- One position at a time; no pyramiding. Fees are charged on entry and exit notional; exit slippage is adverse.
- EliteWave confirmation is operationalized as an aligned `primary` Elliott count with quality >= 50. This is a configurable research proxy, not a claim that every UI EliteWave interpretation is identical.

## Important limitations

This is a research runner, not a production execution simulator. Before relying on results, validate analyzer look-ahead behavior and the EliteWave mapping, add Binance quantity/price precision, funding, liquidation/margin, partial fills, and realistic order-trigger rules. The current report leaves any open end-of-window position unclosed and reports it separately; do not treat it as a realized trade. Run `npm run typecheck` and `npm test` after installing dependencies. No performance result is asserted until the runner has been executed against downloaded market data.
