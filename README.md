# Nifty Trading Agent

A standalone, rule-based Nifty/NSE scanner. This project is intentionally separate from [Life-OS](https://github.com/peppolfixbelgium-debug/Life-OS).

## Features

- Scans a fixed 25-stock NSE watch universe plus Nifty 50 and India VIX context.
- Computes SMA 20/50/200, RSI(14), ATR(14), and current volume versus the prior 20 sessions.
- Flags a setup only when the trend is aligned, the 5-session breakout level is cleared, relative volume is at least 1.1x, RSI is in range, and Nifty's regime is bullish.
- Blocks new long triggers in a bearish Nifty regime.
- Calculates a theoretical quantity with a 1% of capital risk ceiling and a 10% position-value ceiling.
- Offers search, status filters, rule-specific reasons, stock/index chart navigation and CSV export.
- Includes an interactive OHLC chart terminal with 1D/5D/1M/6M/1Y/5Y ranges, SMA 20/50/200 overlays, volume and RSI.
- Includes an optional authenticated options workspace for current option-chain premiums, bid/ask, OI, IV/Greeks, per-contract intraday history and entitled expired-contract history.
- Includes read-only scan and historical backtest API routes, a protected weekday scheduled-scan endpoint, unit tests and a GitHub Actions verify workflow.
- Adds a dedicated long-term Stock Research tab with valuation/fundamental metrics, 1/3/5-year price returns, explainable Buy/Hold/Sell screening, and named analyst/broker rating history when the public data source provides it.
- Adds an Institutional Activity tab using NSE public bulk/block-deal disclosures, market-wide FII/FPI-DII net flows, and quarter-by-quarter promoter/public shareholding summaries with official filing links.

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
3. Deploy. Routes under `/api/*` are Vercel Node functions.
4. For option premiums, create/authorize an Upstox API app and add `UPSTOX_ACCESS_TOKEN` as a server-side Vercel environment variable (Production, and Preview if you need it there); redeploy. Do not place this token in the frontend, public repo, or client-side storage. Tokens may expire and must be refreshed securely. The current implementation expects a valid token to be supplied through that environment variable; it does not yet implement automated OAuth token refresh.
5. Expired-contract dates/history depend on Upstox's plan/API entitlement. If the provider returns a 403 or entitlement error, the app must show that error instead of fabricating past premiums.
4. To enable the scheduled scan, set a strong `CRON_SECRET` environment variable in Vercel and redeploy. The cron endpoint rejects requests until that secret is configured and checks the standard `Authorization: Bearer <CRON_SECRET>` header.

The cron schedule is weekdays at 03:00 UTC (08:30 India Standard Time). It calculates a scan from the latest candles available from the provider; it does not place trades or send notifications. Vercel plan limits may affect cron availability.

## API

- `GET /api/scan` runs or returns a short-lived cached scan.
- `GET /api/scan?capital=100000&risk=1000&refresh=1` requests a fresh scan with INR sizing inputs. Repeated forced refreshes within 30 seconds reuse the recent result to limit upstream requests.
- `GET /api/cron` is the scheduled scan endpoint. It requires `CRON_SECRET` and the matching Bearer authorization header.
- `GET /api/backtest?years=5&capital=100000&risk=1000&costBps=15` simulates the strategy on 3 or 5 years of completed daily candles. The `costBps` parameter is an estimated all-in cost on each side and accepts `0` for a gross/no-cost comparison.
- `GET /api/chart?symbol=^NSEI&range=1Y` returns chart candles for whitelisted stocks and indices. Ranges: `1D` (5-minute intraday), `5D` (15-minute), `1M` (30-minute), `6M`/`1Y` (daily), and `5Y` (weekly). Intraday Yahoo data is a best-effort unofficial provider snapshot, not a guaranteed real-time/exchange-certified feed.
- `GET /api/options?underlying=NIFTY50&expiry=current_week` returns provider-backed option-chain premiums when `UPSTOX_ACCESS_TOKEN` is configured.
- `GET /api/option-history?instrumentKey=...&range=1D` returns the selected option contract's history; supported ranges are `1D`, `5D`, `1M`, and `6M`, subject to current/expired data availability and provider permissions.
- `GET /api/option-expiries?underlying=NIFTY50` and `GET /api/expired-options?underlying=NIFTY50&expiry=YYYY-MM-DD` are for the authenticated provider's expired-contract archive and require the applicable entitlement.
- `GET /api/opportunities?years=5&capital=100000&risk=1000&costBps=15&minTrades=30&universe=all&strategy=all&direction=both&timeframe=daily` runs the Market Opportunity Scanner.
- `GET /api/stock-research?symbol=RELIANCE` returns completed daily history, available financial ratios, analyst-consensus data and an explainable long-term screening assessment. Accepts an NSE ticker with or without `.NS`.
- `GET /api/institutional-activity?days=30&symbol=RELIANCE` returns public NSE bulk/block deals and FII/FPI-DII flows. `days` accepts `7`, `30`, `60` or `90`. Supplying `symbol` adds quarterly promoter/public shareholding summaries and XBRL filing links. Supported strategy IDs are `trend-following`, `breakout-volume`, `trend-pullback`, and `mean-reversion`; `strategy=all` evaluates all four. `universe=stocks` scans the registered 25-stock NSE list; `universe=indices` scans the broad/sector index list in `src/lib/index-universe.ts`; `universe=all` combines both. Index histories are checked at runtime against the requested window and incomplete/unavailable symbols are excluded with reasons. Yahoo Finance symbols are an unofficial research data source; an index-price backtest is not a tradable futures/options backtest.

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

The opportunity scanner currently supports the registered NSE stock universe and configured broad/sector index price series, four fixed strategy families, and long/short underlying-price research hypotheses. Index histories are subject to runtime coverage gates. The separate options workspace uses an authenticated provider for premiums; it is not yet connected to the strategy-ranking engine, and the app does not place orders.

A minimum of 30 trades is an eligibility floor, not proof of statistical significance. Holdout results must be reviewed independently; a zero-trade holdout is insufficient evidence of a strategy edge. Do not tune rules to make historical results look better.


### Market Opportunity Scanner

The scanner compares four fixed entry-rule families: trend following, breakout with volume, trend pullback, and mean reversion. Long and short price-direction hypotheses can be selected. These are pre-registered rules with fixed thresholds, not an optimized parameter sweep.

- The time series is divided chronologically after the 200-bar indicator warm-up: 60% training, 20% validation, and 20% final test. Candidates must have at least the selected minimum trade count (never below 30) in training, at least 10 trades in validation, at least 10 in final test, and reconciled accounting for all three windows.
- Candidates are sorted by **validation-period net expectancy in R per trade**, with validation return and validation drawdown as tie-breakers. Final-test performance is displayed separately and is not used to sort the ranking.
- Incomplete symbols are excluded with reasons instead of silently shortening the backtest. The scan may return a limited but valid candidate subset if some symbols lack full requested history. If no instrument passes the history checks, the scan returns no ranking.
- Ranking is an independent single-instrument/strategy simulation; every row starts with the configured capital. It is not a multi-position portfolio simulation and does not show that all rows can be held together.
- Short rows are theoretical underlying-price simulations only. They do not include stock borrow availability/cost, derivative contracts, expiry/roll, margin, settlement or short-specific execution assumptions and are not executable-trade recommendations.
- `universe=all` combines the currently registered NSE stock list and configured broad/sector index symbols; `stocks` and `indices` can be selected separately. Every index is checked against the requested history window at runtime and may be excluded if its data is unavailable or incomplete. This is index-price-series research only, not a futures/options strategy. Futures/options require separate contract history, expiry/roll handling, realistic costs and execution assumptions.
- Because many symbol/strategy/direction combinations are compared, validation-period selection can still create multiple-comparison bias. Do not tune thresholds to improve the final test; after selecting a candidate, confirm it on a later untouched period.

## Mobile usability

- A short guide at the top of the page explains the position calculator, daily watchlist and opportunity scanner, including what "Avoid" and an empty shortlist mean.
- The universe, strategy, direction, timeframe and historical-period controls use a compact in-app dropdown instead of the browser's native mobile selector, with readable option descriptions and disabled states for unsupported markets.
- "Recommended setups to review" is a separate shortlist of current daily signals that also have positive validation expectancy and validation profit factor of at least 1.0. It is kept separate from the full qualified research list, and the final-test return is shown for transparency but does not select the shortlist.
- The shortlist is not a trade instruction. A blank shortlist is an acceptable outcome; there is no fallback that fabricates picks just to populate it.


## Premium market terminal

The chart terminal is intended to make the app usable even when there is no signal: pick a supported stock/index, inspect candlesticks, SMA 20/50/200, volume and RSI, then switch between intraday and longer history. Selecting **Open chart** from the watchlist jumps to that instrument's chart.

The Options Premium Terminal has two modes:
- **Live option chain:** provider-backed spot, strike-wise CALL/PUT premiums, bid/ask, volume/open interest and provider Greeks; PCR and OI-based max pain are descriptive context, not trade signals.
- **Expired contracts & history:** loads the provider's available expired expiries/contracts and plots actual contract-specific candles. Premiums from different strikes/expiries are never stitched together into a fake continuous series.

This UI is data-first, not a live feed bundled by default. Add the server-side `UPSTOX_ACCESS_TOKEN` in Vercel to use Upstox APIs. The token is not committed to Git. Expired options endpoints may require Upstox Plus. Check Upstox's current entitlement, token expiry, market-data and exchange permission requirements before relying on this workflow.

### Feed limitations (important)

The stock/index charts use Yahoo Finance chart data as an initial adapter because no licensed market-data key was supplied. Intraday candle freshness, completeness and availability are not guaranteed. For a professional launch, replace it with an entitled feed or add a first-party Upstox chart-data adapter for the underlying instrument keys. There is no automatic broker execution, and the app cannot guarantee a complete archive of every listed or expired premium.


## Long-term investor desk

The long-term investing desk has two dedicated tabs:

- **Stock Research**: searches NSE tickers, shows valuation and fundamental fields where available, long-range returns, 52-week context, drawdown, moving averages, an explainable score and the most recent named analyst/broker rating actions returned by the public source. Fields with no source value remain blank.
- **Institutional Activity**: shows NSE-disclosed bulk/block deal transactions by client and stock, aggregates disclosed buys/sells only within the selected window, reports market-wide FII/FPI and DII flows, and compares quarterly promoter/public shareholding summaries. An official XBRL filing link is shown where the exchange feed provides one.

### Assessment safeguards and data limits

- Buy/Hold/Sell is a simple, explainable screen using five domains: long-term price trend, 1-year/3-year performance, revenue/earnings growth, profitability, and leverage (leverage is not scored for financial-sector companies). The score is not a prediction, not personalised advice, and not a guarantee of returns.
- At least three independent domains must be available before the screen emits Buy/Hold/Sell. Otherwise, it returns **Not enough data** rather than inventing an assessment. The score intentionally does not use P/E as a universal buy/sell threshold because valuation ranges differ by sector.
- Financial ratios and broker/analyst records rely on public Yahoo Finance modules and may be incomplete, delayed or unavailable. Price-history data uses Yahoo Finance's unofficial chart endpoint. No paid market-data service or broker subscription is required by this code.
- Institutional Activity uses NSE public disclosure endpoints. NSE can rate-limit those endpoints, and data publication or revisions can lag. Bulk/block deals report disclosed transactions, not an investor's complete portfolio. “First buy observed in window” means the first buy visible in the selected lookback only; it is **not** proof of a new position. Market-wide FII/DII flows are not stock-specific.
- Quarterly public/promoter shareholding percentages are not a substitute for individual institution holdings. Use each company's detailed XBRL disclosure to verify mutual-fund, FPI, insurance and other categories and to confirm apparent new entries or reductions.
- This feature is India/NSE-first in this repository; it does not claim comprehensive coverage of European or US institution filings.
