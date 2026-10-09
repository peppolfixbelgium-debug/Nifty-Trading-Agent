# Nifty Trading Agent

A standalone, rule-based Nifty/NSE scanner. This project is intentionally separate from [Life-OS](https://github.com/peppolfixbelgium-debug/Life-OS).

## Features

- Scans a fixed 25-stock NSE watch universe plus Nifty 50 and India VIX context.
- Computes SMA 20/50/200, RSI(14), ATR(14), and current volume versus the prior 20 sessions.
- Flags a setup only when the trend is aligned, the 5-session breakout level is cleared, relative volume is at least 1.1x, RSI is in range, and Nifty's regime is bullish.
- Blocks new long triggers in a bearish Nifty regime.
- Calculates a theoretical quantity with a 1% of capital risk ceiling and a 10% position-value ceiling.
- Offers search, status filters, reason strings and CSV export.
- Includes read-only scan and historical backtest API routes, a protected weekday scheduled-scan endpoint, unit tests and a GitHub Actions verify workflow.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

The `dev` command downloads and runs the current Vercel CLI so the frontend and `/api/*` functions work together. Open the local URL printed by Vercel. To work on only the static UI, use `npm run dev:ui`; scanner API requests require Vercel Dev or a deployment.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

Or run all three with `npm run verify`.

## Deploy on Vercel

1. Import this repository into Vercel.
2. Keep the Vite framework preset, build command `npm run build`, and output directory `dist`.
3. Deploy. The `/api/scan` and `/api/cron` routes are Vercel Node functions.
4. To enable the scheduled scan, set a strong `CRON_SECRET` environment variable in Vercel and redeploy. The cron endpoint rejects requests until that secret is configured and checks the standard `Authorization: Bearer <CRON_SECRET>` header.

The cron schedule is weekdays at 03:00 UTC (08:30 India Standard Time). It calculates a scan from the latest candles available from the provider; it does not place trades or send notifications. Vercel plan limits may affect cron availability.

## API

- `GET /api/scan` runs or returns a short-lived cached scan.
- `GET /api/scan?capital=100000&risk=1000&refresh=1` requests a fresh scan with INR sizing inputs. Repeated forced refreshes within 30 seconds reuse the recent result to limit upstream requests.
- `GET /api/cron` is the scheduled scan endpoint. It requires `CRON_SECRET` and the matching Bearer authorization header.
- `GET /api/backtest?years=5&capital=100000&risk=1000&costBps=15` simulates the strategy on 3 or 5 years of completed daily candles. The `costBps` parameter is an estimated all-in cost on each side and accepts `0` for a gross/no-cost comparison.
- `GET /api/opportunities?years=5&capital=100000&risk=1000&costBps=15&minTrades=30&universe=all&strategy=all&direction=both&timeframe=daily` runs the Market Opportunity Scanner. Supported strategy IDs are `trend-following`, `breakout-volume`, `trend-pullback`, and `mean-reversion`; `strategy=all` evaluates all four. The initial supported universe is the 25-stock registry in `src/lib/universe.ts`.

Responses include a generated timestamp, market regime, India VIX context, per-stock indicator values, a reason per result, and sizing details. Provider failures are represented as warnings or per-symbol errors rather than being silently treated as buy signals.

## Screening rules

A `TRIGGERED` label requires all of the following on the latest daily candle:

1. Close > SMA(20) > SMA(50) > SMA(200).
2. Nifty regime is bullish: Nifty close > SMA(50) > SMA(200).
3. Close >= prior 5-session high + 0.1 × ATR(14).
4. Latest volume / mean prior 20 session volumes >= 1.1.
5. RSI(14) is between 50 and 70.

The theoretical stop is 1.5 × ATR below the trigger and the theoretical target is 2R above it. Quantity is limited by both the selected INR risk ceiling and 10% of stated capital. These are simple rules, not a validated profitable strategy.

## Historical backtest

The Backtest section replays completed daily candles using the same trend/breakout/volume/RSI and bullish-Nifty filters as the scanner. The API reports both the requested calendar window and actual Nifty history window; the simulated trading period may start later because of indicator warm-up, so these dates must not be confused. Indicators are calculated only from candles available as of each signal close.

- Signals are evaluated at the completed daily close; entry is simulated at the next trading session open.
- Initial stop distance is 1.5 × ATR(14); target is 2R; positions are closed at stop, target, after 20 sessions, or at the end of the test window.
- When OHLC data shows both stop and target touched in one candle and their order is unknowable, the simulator assumes the stop was hit first.
- Only one open position at a time is allowed. Quantity is capped by 1% of starting capital risk per trade, 10% position value, and available cash.
- When a stock candle is missing, an open position remains marked to its last observed close; a missing bar never makes the position disappear from equity. If the final candle is missing, an end-of-data exit uses the latest actually observed close.
- The API reports requested-versus-actual history coverage, full-window stock counts, trade-P&L versus ending-equity reconciliation, and explicit ranking eligibility. Ranking stays blocked if market history is incomplete, any loaded stock lacks comparable window coverage, data warnings exist, accounting fails, fewer than 30 closed trades are available, or the holdout has fewer than 10 trades.
- Trading costs are a configurable estimated basis-point rate charged on each side. They are not a broker-specific tax/fee model.
- The latest Indian calendar day's candle is excluded to reduce partial-session/look-ahead risk.
- Full-period statistics are accompanied by a separately simulated holdout covering the latest 25% of the post-warm-up timeline. It reuses the earlier prices only for indicator warm-up and starts with fresh capital.

Yahoo Finance's chart endpoint is unofficial, history can be incomplete, and the model omits dividend reinvestment, corporate-action adjustments beyond provider-adjusted prices, portfolio concurrency, order-book fills, and exact taxes. Treat all outputs as research estimates, not proof of profitability.

## Data and risk notes

- The app queries Yahoo Finance's chart endpoint. This is an unofficial data interface and may rate-limit, change, omit candles or be unavailable. The UI surfaces errors instead of inventing values.
- Daily candles can be delayed or incomplete during a live session. Signals use the most recent candle returned by the provider; they do not guarantee an end-of-day close.
- A trigger is a screen result, not a recommendation, order, or promise of returns. Check data, corporate actions, liquidity, gaps, slippage, brokerage, taxes and your own circumstances before considering a trade.
- No broker credentials, exchange order APIs, automatic trade execution, personalized financial advice or profit guarantees are included.
- Do not add API keys or secrets to the repository. Use the deployment provider's environment-variable settings.

## Repository scope

All app code, API routes, CI and scheduled-scan configuration in this repository belong to Nifty Trading Agent. No Life-OS files or workflows are referenced by the build.


## Market Opportunity Scanner readiness

The desired scanner defaults are: all data-supported instruments, all validated strategies, both directions, daily timeframe, and at least 30 completed trades before a candidate is eligible for ranking. These defaults do not mean every market type or strategy is implemented. The current historical simulator remains a single long breakout-with-volume model and uses a fixed 25-stock NSE watchlist with Nifty 50 context. Broad/sector-index trading, futures roll handling, short-side execution, options-premium history and multi-strategy ranking must remain unavailable until their data and execution assumptions are implemented and tested.

A minimum of 30 trades is an eligibility floor, not proof of statistical significance. Holdout results must be reviewed independently; a zero-trade holdout is insufficient evidence of a strategy edge. Do not tune rules to make historical results look better.


### Market Opportunity Scanner

The scanner compares four fixed entry-rule families: trend following, breakout with volume, trend pullback, and mean reversion. Long and short price-direction hypotheses can be selected. These are pre-registered rules with fixed thresholds, not an optimized parameter sweep.

- The time series is divided chronologically after the 200-bar indicator warm-up: 60% training, 20% validation, and 20% final test. Candidates must have at least the selected minimum trade count (never below 30) in training, at least 10 trades in validation, at least 10 in final test, and reconciled accounting for all three windows.
- Candidates are sorted by **validation-period net expectancy in R per trade**, with validation return and validation drawdown as tie-breakers. Final-test performance is displayed separately and is not used to sort the ranking.
- Incomplete symbols are excluded with reasons instead of silently shortening the backtest. The scan may return a limited but valid candidate subset if some symbols lack full requested history. If no instrument passes the history checks, the scan returns no ranking.
- Ranking is an independent single-instrument/strategy simulation; every row starts with the configured capital. It is not a multi-position portfolio simulation and does not show that all rows can be held together.
- Short rows are theoretical underlying-price simulations only. They do not include stock borrow availability/cost, derivative contracts, expiry/roll, margin, settlement or short-specific execution assumptions and are not executable-trade recommendations.
- The initial `all` universe means all currently registered NSE stocks. Broad/sector indices, futures and options are not silently substituted into this universe: they need a verified market-data adapter and their own contract/roll/expiry execution model.
- Because many symbol/strategy/direction combinations are compared, validation-period selection can still create multiple-comparison bias. Do not tune thresholds to improve the final test; after selecting a candidate, confirm it on a later untouched period.

## Mobile usability

- A short guide at the top of the page explains the position calculator, daily watchlist and opportunity scanner, including what "Avoid" and an empty shortlist mean.
- The universe, strategy, direction, timeframe and historical-period controls use a compact in-app dropdown instead of the browser's native mobile selector, with readable option descriptions and disabled states for unsupported markets.
- "Recommended setups to review" is a separate shortlist of current daily signals that also have positive validation expectancy and validation profit factor of at least 1.0. It is kept separate from the full qualified research list, and the final-test return is shown for transparency but does not select the shortlist.
- The shortlist is not a trade instruction. A blank shortlist is an acceptable outcome; there is no fallback that fabricates picks just to populate it.
