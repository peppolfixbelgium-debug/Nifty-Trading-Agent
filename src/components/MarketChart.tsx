import { useEffect, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import { INDEX_UNIVERSE } from "../lib/index-universe.js";
import { UNIVERSE } from "../lib/universe.js";
import type { Candle } from "../lib/types.js";
import PremiumSelect from "./PremiumSelect.js";

type ChartRange = "1D" | "5D" | "1M" | "6M" | "1Y" | "5Y";
type ChartResponse = {
  symbol: string; name: string; range: ChartRange; interval: string;
  dataSource: string; freshness: string; generatedAt: string; candles: Candle[];
};
type Props = { symbol?: string; onSelectSymbol?: (symbol: string) => void };

const ranges: ChartRange[] = ["1D", "5D", "1M", "6M", "1Y", "5Y"];
const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const pct = (value: number) => (value > 0 ? "+" : "") + value.toFixed(2) + "%";

function smaSeries(values: number[], period: number): Array<number | null> {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    return slice.every(Number.isFinite) ? slice.reduce((sum, value) => sum + value, 0) / period : null;
  });
}
function rsiSeries(values: number[], period = 14): Array<number | null> {
  return values.map((_, index) => {
    if (index < period) return null;
    let gains = 0;
    let losses = 0;
    for (let i = index - period + 1; i <= index; i += 1) {
      const previous = values[i - 1];
      const current = values[i];
      if (previous === undefined || current === undefined) return null;
      const move = current - previous;
      if (move > 0) gains += move;
      else losses -= move;
    }
    const averageGain = gains / period;
    const averageLoss = losses / period;
    if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
    return 100 - 100 / (1 + averageGain / averageLoss);
  });
}
function formatTime(timestamp: number, range: ChartRange): string {
  return new Date(timestamp).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(range === "1D" || range === "5D" || range === "1M"
      ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "2-digit" })
  });
}
function formatAxisTime(timestamp: number, range: ChartRange): string {
  return new Date(timestamp).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(range === "1D" || range === "5D" ? { hour: "2-digit", minute: "2-digit" } : { month: "short", year: "2-digit" })
  });
}

export default function MarketChart({ symbol: initialSymbol, onSelectSymbol }: Props) {
  const symbols = useMemo(() => [...INDEX_UNIVERSE, ...UNIVERSE], []);
  const [symbol, setSymbol] = useState(initialSymbol ?? "^NSEI");
  const [range, setRange] = useState<ChartRange>("1Y");
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => { if (initialSymbol && initialSymbol !== symbol) setSymbol(initialSymbol); }, [initialSymbol, symbol]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/chart?symbol=" + encodeURIComponent(symbol) + "&range=" + range + "&refresh=" + refreshKey, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ChartResponse & { detail?: string; error?: string };
        if (!response.ok) throw new Error(body.detail || body.error || "Chart request failed.");
        return body;
      })
      .then((body) => setData(body))
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Chart data could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [symbol, range, refreshKey]);

  const candles = data?.candles ?? [];
  const closes = useMemo(() => candles.map((candle) => candle.close), [candles]);
  const sma20 = useMemo(() => smaSeries(closes, 20), [closes]);
  const sma50 = useMemo(() => smaSeries(closes, 50), [closes]);
  const sma200 = useMemo(() => smaSeries(closes, 200), [closes]);
  const rsi = useMemo(() => rsiSeries(closes), [closes]);
  const latest = candles.at(-1) ?? null;
  const previous = candles.at(-2) ?? null;
  const change = latest && previous ? ((latest.close / previous.close) - 1) * 100 : null;
  const hovered = hoverIndex !== null ? candles[hoverIndex] ?? latest : latest;

  const drawing = useMemo(() => {
    if (!candles.length) return null;
    const width = 1000;
    const height = 510;
    const left = 12;
    const right = 930;
    const priceTop = 22;
    const priceBottom = 270;
    const volumeTop = 291;
    const volumeBottom = 354;
    const rsiTop = 386;
    const rsiBottom = 466;
    const high = Math.max(...candles.map((candle) => candle.high));
    const low = Math.min(...candles.map((candle) => candle.low));
    const pad = Math.max((high - low) * 0.08, high * 0.001);
    const minPrice = low - pad;
    const maxPrice = high + pad;
    const priceY = (value: number) => priceBottom - ((value - minPrice) / (maxPrice - minPrice)) * (priceBottom - priceTop);
    const x = (index: number) => left + ((index + 0.5) / candles.length) * (right - left);
    const candleWidth = Math.max(1.2, Math.min(7.5, (right - left) / candles.length * 0.62));
    const volumeMaximum = Math.max(1, ...candles.map((candle) => candle.volume ?? 0));
    const volY = (value: number) => volumeBottom - (value / volumeMaximum) * (volumeBottom - volumeTop);
    const rsiY = (value: number) => rsiBottom - (value / 100) * (rsiBottom - rsiTop);
    const makeLine = (values: Array<number | null>, y: (value: number) => number) =>
      values.map((value, index) => value === null ? null : x(index).toFixed(2) + "," + y(value).toFixed(2)).filter((value): value is string => value !== null).join(" ");
    return {
      width, height, left, right, priceTop, priceBottom, volumeTop, volumeBottom, rsiTop, rsiBottom,
      minPrice, maxPrice, high, low, priceY, x, candleWidth, volumeMaximum, volY, rsiY,
      sma20: makeLine(sma20, priceY), sma50: makeLine(sma50, priceY), sma200: makeLine(sma200, priceY),
      rsi: makeLine(rsi, rsiY),
      horizontal: Array.from({ length: 5 }, (_, index) => {
        const value = maxPrice - (index / 4) * (maxPrice - minPrice);
        return { value, y: priceY(value) };
      })
    };
  }, [candles, sma20, sma50, sma200, rsi]);

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drawing || !candles.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - box.left) / Math.max(1, box.width)) * drawing.width;
    if (svgX < drawing.left || svgX > drawing.right) return;
    const fraction = (svgX - drawing.left) / (drawing.right - drawing.left);
    setHoverIndex(Math.max(0, Math.min(candles.length - 1, Math.floor(fraction * candles.length))));
  }

  return <section id="market-chart" className="terminal-chart-section" aria-labelledby="terminal-chart-title">
    <div className="terminal-section-top">
      <div>
        <div className="section-kicker">MARKET TERMINAL / 01</div>
        <h2 id="terminal-chart-title">Price action, not just a signal</h2>
        <p>Interactive OHLC candles with moving averages, volume and RSI. Switch from intraday structure to multi-year context.</p>
      </div>
      <span className="terminal-data-badge"><i /> {data?.freshness === "intraday-provider-snapshot" ? "INTRADAY SNAPSHOT" : "HISTORICAL CANDLES"}</span>
    </div>
    <div className="terminal-chart-toolbar">
      <label className="chart-instrument-picker">
        <span>INSTRUMENT</span>
        <PremiumSelect
          value={symbol}
          onChange={(nextSymbol) => { setSymbol(nextSymbol); onSelectSymbol?.(nextSymbol); setHoverIndex(null); }}
          ariaLabel="Chart instrument"
          className="chart-premium-select"
          options={[
            ...INDEX_UNIVERSE.map((item) => ({ value: item.symbol, label: item.name, hint: "Index" })),
            ...UNIVERSE.map((item) => ({ value: item.symbol, label: item.name, hint: item.symbol.replace(".NS", "") }))
          ]}
        />
      </label>
      <div className="chart-range-tabs" role="tablist" aria-label="Chart timeframe">
        {ranges.map((item) => <button key={item} type="button" className={range === item ? "active" : ""} aria-selected={range === item} role="tab" onClick={() => { setRange(item); setHoverIndex(null); }}>{item}</button>)}
      </div>
      <button type="button" className="chart-refresh" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} aria-label="Refresh chart">↻</button>
    </div>
    <div className="terminal-chart-summary">
      <div><span>{data?.name ?? symbols.find((item) => item.symbol === symbol)?.name ?? symbol}</span><strong>{latest ? inr.format(latest.close) : "—"}</strong><small className={change !== null && change >= 0 ? "positive" : "negative"}>{change === null ? "Waiting for candles" : pct(change)} <b>previous candle</b></small></div>
      <div className="chart-summary-extra"><span>OPEN <b>{hovered ? inr.format(hovered.open) : "—"}</b></span><span>HIGH <b>{hovered ? inr.format(hovered.high) : "—"}</b></span><span>LOW <b>{hovered ? inr.format(hovered.low) : "—"}</b></span><span>CLOSE <b>{hovered ? inr.format(hovered.close) : "—"}</b></span><span>VOL <b>{hovered?.volume === null || !hovered ? "—" : number.format(hovered.volume)}</b></span></div>
    </div>
    <div className="terminal-chart-legend"><span><i className="legend-candle" /> OHLC</span><span><i className="legend-sma20" /> SMA 20</span><span><i className="legend-sma50" /> SMA 50</span><span><i className="legend-sma200" /> SMA 200</span><span><i className="legend-volume" /> Volume</span><span><i className="legend-rsi" /> RSI 14</span></div>
    {loading && <div className="chart-loading"><span className="spinner" /> Loading candles and calculating indicators…</div>}
    {error && <div className="error-banner"><strong>Chart unavailable</strong><span>{error}</span><button onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></div>}
    {!error && !loading && data && drawing && <div className="terminal-svg-wrap">
      <svg className="terminal-svg-chart" viewBox="0 0 1000 510" role="img" aria-label={data.name + " candlestick chart with moving averages, volume and RSI"} onPointerMove={pointerMove} onPointerLeave={() => setHoverIndex(null)}>
        {drawing.horizontal.map((line) => <g key={line.y}><line x1={drawing.left} x2={drawing.right} y1={line.y} y2={line.y} className="chart-grid-line" /><text x="944" y={line.y + 4} className="chart-axis-label">{inr.format(line.value)}</text></g>)}
        {[drawing.volumeTop, drawing.rsiTop - 8, drawing.rsiBottom].map((y) => <line key={y} x1={drawing.left} x2={drawing.right} y1={y} y2={y} className="chart-grid-line" />)}
        <line x1={drawing.left} x2={drawing.right} y1={drawing.rsiY(70)} y2={drawing.rsiY(70)} className="chart-rsi-threshold" />
        <line x1={drawing.left} x2={drawing.right} y1={drawing.rsiY(30)} y2={drawing.rsiY(30)} className="chart-rsi-threshold" />
        {candles.map((candle, index) => {
          const x = drawing.x(index);
          const up = candle.close >= candle.open;
          const colorClass = up ? "chart-up" : "chart-down";
          const top = drawing.priceY(Math.max(candle.open, candle.close));
          const bottom = drawing.priceY(Math.min(candle.open, candle.close));
          return <g key={candle.time} className={colorClass}>
            <line x1={x} x2={x} y1={drawing.priceY(candle.high)} y2={drawing.priceY(candle.low)} stroke="currentColor" strokeWidth="1" />
            <rect x={x - drawing.candleWidth / 2} y={top} width={drawing.candleWidth} height={Math.max(1, bottom - top)} fill="currentColor" rx=".5" />
            <rect x={x - drawing.candleWidth / 2} y={drawing.volY(candle.volume ?? 0)} width={drawing.candleWidth} height={drawing.volumeBottom - drawing.volY(candle.volume ?? 0)} fill="currentColor" opacity=".54" />
          </g>;
        })}
        {drawing.sma20 && <polyline points={drawing.sma20} className="chart-line-sma20" />}
        {drawing.sma50 && <polyline points={drawing.sma50} className="chart-line-sma50" />}
        {drawing.sma200 && <polyline points={drawing.sma200} className="chart-line-sma200" />}
        {drawing.rsi && <polyline points={drawing.rsi} className="chart-line-rsi" />}
        {hovered && hoverIndex !== null && <g><line x1={drawing.x(hoverIndex)} x2={drawing.x(hoverIndex)} y1={drawing.priceTop} y2={drawing.rsiBottom} className="chart-crosshair" /><circle cx={drawing.x(hoverIndex)} cy={drawing.priceY(hovered.close)} r="3" className="chart-hover-dot" /></g>}
        <text x="12" y="285" className="chart-pane-label">VOLUME</text>
        <text x="12" y="378" className="chart-pane-label">RSI 14</text>
        <text x="944" y={drawing.rsiY(70) - 5} className="chart-axis-label">70</text>
        <text x="944" y={drawing.rsiY(30) - 5} className="chart-axis-label">30</text>
        {[0, Math.floor((candles.length - 1) / 3), Math.floor((candles.length - 1) * 2 / 3), candles.length - 1].filter((value, index, array) => array.indexOf(value) === index).map((index) => <text key={index} x={drawing.x(index)} y="495" textAnchor={index === 0 ? "start" : index === candles.length - 1 ? "end" : "middle"} className="chart-time-label">{formatAxisTime(candles[index]!.time, range)}</text>)}
      </svg>
      <div className="chart-hover-caption">{hovered ? formatTime(hovered.time, range) + " IST · " + data.interval + " bars · provider snapshot" : "Move across the chart to inspect a candle"}</div>
    </div>}
    {!loading && !error && data && !candles.length && <div className="empty-state">The provider returned no candles for this timeframe.</div>}
    <div className="chart-source-note">Source: {data?.dataSource ?? "Yahoo Finance chart endpoint (unofficial)"}. Intraday values may be delayed or incomplete; they are not an exchange-certified real-time feed. Historical views use completed candles wherever available.</div>
  </section>;
}
