# Nifty Trading Agent

A standalone, rule-based Nifty/NSE scanner. This project is intentionally separate from [Life-OS](https://github.com/peppolfixbelgium-debug/Life-OS).

## Features

- Scans a fixed 25-stock NSE watch universe plus Nifty 50 and India VIX context.
- Computes SMA 20/50/200, RSI(14), ATR(14), and current volume versus the prior 20 sessions.
- Flags a setup only when the trend is aligned, the 5-session breakout level is cleared, relative volume is at least 1.1x, RSI is in range, and Nifty's regime is bullish.
- Blocks new long triggers in a bearish Nifty regime.
- Calculates a theoretical quantity with a 1% of capital risk ceiling and a 10% position-value ceiling.
- Offers search, status filters, reason strings and CSV export.
- Includes read-only API routes, a protected weekday scheduled-scan endpoint, unit tests and a GitHub Actions verify workflow.

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

Responses include a generated timestamp, market regime, India VIX context, per-stock indicator values, a reason per result, and sizing details. Provider failures are represented as warnings or per-symbol errors rather than being silently treated as buy signals.

## Screening rules

A `TRIGGERED` label requires all of the following on the latest daily candle:

1. Close > SMA(20) > SMA(50) > SMA(200).
2. Nifty regime is bullish: Nifty close > SMA(50) > SMA(200).
3. Close >= prior 5-session high + 0.1 × ATR(14).
4. Latest volume / mean prior 20 session volumes >= 1.1.
5. RSI(14) is between 50 and 70.

The theoretical stop is 1.5 × ATR below the trigger and the theoretical target is 2R above it. Quantity is limited by both the selected INR risk ceiling and 10% of stated capital. These are simple rules, not a validated profitable strategy.

## Data and risk notes

- The app queries Yahoo Finance's chart endpoint. This is an unofficial data interface and may rate-limit, change, omit candles or be unavailable. The UI surfaces errors instead of inventing values.
- Daily candles can be delayed or incomplete during a live session. Signals use the most recent candle returned by the provider; they do not guarantee an end-of-day close.
- A trigger is a screen result, not a recommendation, order, or promise of returns. Check data, corporate actions, liquidity, gaps, slippage, brokerage, taxes and your own circumstances before considering a trade.
- No broker credentials, exchange order APIs, automatic trade execution, personalized financial advice or profit guarantees are included.
- Do not add API keys or secrets to the repository. Use the deployment provider's environment-variable settings.

## Repository scope

All app code, API routes, CI and scheduled-scan configuration in this repository belong to Nifty Trading Agent. No Life-OS files or workflows are referenced by the build.
