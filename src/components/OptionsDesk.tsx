import { useEffect, useMemo, useState } from "react";
import type { Candle } from "../lib/types.js";

type OptionSide = {
  instrumentKey: string | null; ltp: number | null; close: number | null;
  volume: number | null; oi: number | null; bid: number | null; ask: number | null;
  iv: number | null; delta: number | null; theta: number | null; gamma: number | null;
};
type ChainRow = { expiry: string; pcr: number | null; strike: number | null; spot: number | null; call: OptionSide | null; put: OptionSide | null };
type ChainResponse = { configured?: boolean; source?: string; generatedAt?: string; underlying?: string; expiry?: string; spot?: number | null; rows?: ChainRow[]; error?: string; detail?: string };
type ArchiveContract = { name: string; instrumentKey: string; tradingSymbol: string; expiry: string; strike: number; type: string; lotSize: number | null };
type ArchiveResponse = { configured?: boolean; dates?: string[]; contracts?: ArchiveContract[]; error?: string; detail?: string };
type PremiumResponse = { configured?: boolean; source?: string; instrumentKey?: string; range?: string; generatedAt?: string; candles?: Candle[]; note?: string; error?: string; detail?: string };
type Mode = "live" | "archive";
type Range = "1D" | "5D" | "1M" | "6M";
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const price = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UNDERLYINGS = [
  { value: "NIFTY50", label: "NIFTY 50" },
  { value: "BANKNIFTY", label: "NIFTY BANK" },
  { value: "FINNIFTY", label: "NIFTY FINANCIAL SERVICES" },
  { value: "MIDCPNIFTY", label: "NIFTY MIDCAP SELECT" },
  { value: "SENSEX", label: "SENSEX" }
];
const EXPIRIES = [
  { value: "current_week", label: "Current week" },
  { value: "next_week", label: "Next week" },
  { value: "far_week", label: "Far week" },
  { value: "current_month", label: "Current month" },
  { value: "next_month", label: "Next month" },
  { value: "far_month", label: "Far month" }
];
const RANGES: Range[] = ["1D", "5D", "1M", "6M"];

export default function OptionsDesk() {
  const [mode, setMode] = useState<Mode>("live");
  const [underlying, setUnderlying] = useState("NIFTY50");
  const [expiry, setExpiry] = useState("current_week");
  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [chainBusy, setChainBusy] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [archiveDates, setArchiveDates] = useState<string[]>([]);
  const [archiveExpiry, setArchiveExpiry] = useState("");
  const [contracts, setContracts] = useState<ArchiveContract[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [selectedContract, setSelectedContract] = useState("");
  const [showAllStrikes, setShowAllStrikes] = useState(false);
  const [historyRange, setHistoryRange] = useState<Range>("1D");
  const [premium, setPremium] = useState<PremiumResponse | null>(null);
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [premiumError, setPremiumError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (mode !== "live") return;
    const controller = new AbortController();
    setChainBusy(true);
    setChainError(null);
    fetch("/api/options?underlying=" + underlying + "&expiry=" + encodeURIComponent(expiry) + "&refresh=" + refreshKey, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ChainResponse;
        if (!response.ok) throw new Error([body.error, body.detail].filter(Boolean).join(" "));
        return body;
      })
      .then((body) => { setChain(body); setChainError(null); })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setChain(null);
        setChainError(caught instanceof Error ? caught.message : "Option chain request failed.");
      })
      .finally(() => { if (!controller.signal.aborted) setChainBusy(false); });
    return () => controller.abort();
  }, [mode, underlying, expiry, refreshKey]);

  useEffect(() => {
    if (mode !== "archive") return;
    const controller = new AbortController();
    setArchiveError(null);
    setArchiveDates([]);
    setContracts([]);
    setArchiveExpiry("");
    setArchiveBusy(true);
    fetch("/api/option-expiries?underlying=" + underlying, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ArchiveResponse;
        if (!response.ok) throw new Error([body.error, body.detail].filter(Boolean).join(" "));
        return body;
      })
      .then((body) => {
        const dates = body.dates ?? [];
        setArchiveDates(dates);
        setArchiveExpiry(dates[0] ?? "");
        if (!dates.length) setArchiveError("No expired-option dates were returned by the provider.");
      })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setArchiveError(caught instanceof Error ? caught.message : "Could not load expired-option dates.");
      })
      .finally(() => { if (!controller.signal.aborted) setArchiveBusy(false); });
    return () => controller.abort();
  }, [mode, underlying]);

  useEffect(() => {
    if (mode !== "archive" || !archiveExpiry) return;
    const controller = new AbortController();
    setArchiveBusy(true);
    setArchiveError(null);
    setContracts([]);
    fetch("/api/expired-options?underlying=" + underlying + "&expiry=" + archiveExpiry, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ArchiveResponse;
        if (!response.ok) throw new Error([body.error, body.detail].filter(Boolean).join(" "));
        return body;
      })
      .then((body) => {
        const results = body.contracts ?? [];
        setContracts(results);
        setSelectedContract(results[0]?.instrumentKey ?? "");
        if (!results.length) setArchiveError("No contracts were returned for this expiry.");
      })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setArchiveError(caught instanceof Error ? caught.message : "Could not load expired contracts.");
      })
      .finally(() => { if (!controller.signal.aborted) setArchiveBusy(false); });
    return () => controller.abort();
  }, [mode, underlying, archiveExpiry]);

  const chainRows = useMemo(() => (chain?.rows ?? []).filter((row) => row.strike !== null).sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0)), [chain]);
  const selectedRows = useMemo(() => {
    if (showAllStrikes || !chainRows.length || chain?.spot == null) return chainRows;
    const atmIndex = chainRows.reduce((best, row, index) =>
      Math.abs((row.strike ?? 0) - chain.spot!) < Math.abs((chainRows[best]?.strike ?? 0) - chain.spot!) ? index : best, 0);
    return chainRows.slice(Math.max(0, atmIndex - 8), Math.min(chainRows.length, atmIndex + 9));
  }, [chainRows, chain?.spot, showAllStrikes]);

  const liveContracts = useMemo(() => {
    const options: Array<{ key: string; label: string }> = [];
    for (const row of chainRows) {
      if (row.call?.instrumentKey) options.push({ key: row.call.instrumentKey, label: "CALL " + number.format(row.strike ?? 0) + " · premium " + price.format(row.call.ltp ?? 0) });
      if (row.put?.instrumentKey) options.push({ key: row.put.instrumentKey, label: "PUT " + number.format(row.strike ?? 0) + " · premium " + price.format(row.put.ltp ?? 0) });
    }
    return options;
  }, [chainRows, chain?.spot]);

  const activeContract = mode === "archive"
    ? contracts.find((item) => item.instrumentKey === selectedContract) ?? contracts[0] ?? null
    : liveContracts.find((item) => item.key === selectedContract) ?? liveContracts[0] ?? null;
  const activeKey = mode === "archive"
    ? (activeContract && "instrumentKey" in activeContract ? activeContract.instrumentKey : "")
    : (activeContract && "key" in activeContract ? activeContract.key : "");

  useEffect(() => {
    if (mode === "live" && liveContracts.length && !liveContracts.some((item) => item.key === selectedContract)) {
      setSelectedContract(liveContracts[0]!.key);
    }
  }, [mode, liveContracts, selectedContract]);

  useEffect(() => {
    if (!activeKey) { setPremium(null); return; }
    const controller = new AbortController();
    setPremiumBusy(true);
    setPremiumError(null);
    fetch("/api/option-history?instrumentKey=" + encodeURIComponent(activeKey) + "&range=" + historyRange, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as PremiumResponse;
        if (!response.ok) throw new Error([body.error, body.detail].filter(Boolean).join(" "));
        return body;
      })
      .then((body) => { setPremium(body); if (!body.candles?.length && body.note) setPremiumError(body.note); })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setPremium(null);
        setPremiumError(caught instanceof Error ? caught.message : "Premium history could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setPremiumBusy(false); });
    return () => controller.abort();
  }, [activeKey, historyRange, mode, refreshKey]);

  const totalCallOi = chainRows.reduce((sum, row) => sum + (row.call?.oi ?? 0), 0);
  const totalPutOi = chainRows.reduce((sum, row) => sum + (row.put?.oi ?? 0), 0);
  const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : null;
  const maxPain = useMemo(() => {
    if (!chainRows.length) return null;
    let bestStrike: number | null = null;
    let lowestPain = Infinity;
    for (const settlement of chainRows) {
      if (settlement.strike === null) continue;
      const pain = chainRows.reduce((sum, row) => {
        const strike = row.strike ?? 0;
        return sum + Math.max(0, settlement.strike! - strike) * (row.call?.oi ?? 0) +
          Math.max(0, strike - settlement.strike!) * (row.put?.oi ?? 0);
      }, 0);
      if (pain < lowestPain) { lowestPain = pain; bestStrike = settlement.strike; }
    }
    return bestStrike;
  }, [chainRows]);

  const premiumCandles = premium?.candles ?? [];
  const premiumChart = useMemo(() => {
    if (premiumCandles.length < 2) return null;
    const width = 1000, height = 230, padLeft = 8, padRight = 70, padTop = 16, padBottom = 26;
    const lo = Math.min(...premiumCandles.map((item) => item.low));
    const hi = Math.max(...premiumCandles.map((item) => item.high));
    const pad = Math.max((hi - lo) * 0.06, hi * 0.001);
    const min = Math.max(0, lo - pad);
    const max = hi + pad;
    const points = premiumCandles.map((item, index) => {
      const x = padLeft + (index / Math.max(1, premiumCandles.length - 1)) * (width - padLeft - padRight);
      const y = height - padBottom - ((item.close - min) / Math.max(0.001, max - min)) * (height - padTop - padBottom);
      return x.toFixed(2) + "," + y.toFixed(2);
    }).join(" ");
    const last = premiumCandles.at(-1)!;
    const first = premiumCandles[0]!;
    return { width, height, min, max, points, latest: last.close, changePct: first.close > 0 ? (last.close / first.close - 1) * 100 : 0 };
  }, [premiumCandles]);

  const optionName = activeContract && "tradingSymbol" in activeContract
    ? activeContract.tradingSymbol
    : activeContract && "label" in activeContract ? activeContract.label : "Choose a contract";

  return <section id="options-terminal" className="options-desk-section" aria-labelledby="options-desk-title">
    <div className="terminal-section-top">
      <div>
        <div className="section-kicker">DERIVATIVES LAB / 02</div>
        <h2 id="options-desk-title">Options premium terminal</h2>
        <p>Live option-chain snapshot, bid/ask, open interest, IV/Greeks and contract-specific premium history. Nothing is invented if the provider is disconnected.</p>
      </div>
      <span className={"terminal-data-badge " + (chain && !chainError ? "" : "terminal-data-badge-amber")}><i /> {chain && !chainError ? "UPSTOX SNAPSHOT" : "FEED CONNECTION"}</span>
    </div>
    <div className="options-mode-tabs" role="tablist" aria-label="Options data mode">
      <button role="tab" aria-selected={mode === "live"} className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Current option chain</button>
      <button role="tab" aria-selected={mode === "archive"} className={mode === "archive" ? "active" : ""} onClick={() => setMode("archive")}>Expired contracts &amp; history</button>
    </div>
    <div className="options-controls">
      <label className="chart-instrument-picker"><span>UNDERLYING</span><select value={underlying} onChange={(event) => { setUnderlying(event.target.value); setChain(null); setSelectedContract(""); }} >{UNDERLYINGS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      {mode === "live" ? <label className="chart-instrument-picker"><span>EXPIRY</span><select value={expiry} onChange={(event) => { setExpiry(event.target.value); setSelectedContract(""); }} >{EXPIRIES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        : <label className="chart-instrument-picker"><span>HISTORICAL EXPIRY</span><select value={archiveExpiry} onChange={(event) => setArchiveExpiry(event.target.value)} disabled={!archiveDates.length}>{archiveDates.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
      <button className="chart-refresh" onClick={() => setRefreshKey((value) => value + 1)} disabled={chainBusy || archiveBusy} aria-label="Refresh option data">↻</button>
    </div>
    {mode === "live" && chainBusy && <div className="chart-loading"><span className="spinner" /> Loading authorised option chain…</div>}
    {mode === "live" && chainError && <div className="provider-setup-callout"><strong>Connect the options data feed</strong><p>{chainError}</p><ol><li>Create/authorize a market-data app with Upstox.</li><li>Add <code>UPSTOX_ACCESS_TOKEN</code> as a server-side Vercel environment variable. Never put it in frontend code or Git.</li><li>Redeploy and refresh this panel. Tokens expire and may need a secure refresh flow.</li></ol><small>Options quotes, IV and Greeks require the provider to authorize your account. No sample quotes are displayed as live data.</small></div>}
    {mode === "archive" && (archiveBusy || !archiveDates.length) && !archiveError && <div className="chart-loading"><span className="spinner" /> Loading the available historical expiries and contract catalog…</div>}
    {mode === "archive" && archiveError && <div className="provider-setup-callout"><strong>Expired-contract archive unavailable</strong><p>{archiveError}</p><small>Upstox documents expired-instrument access as an entitled feature; eligibility depends on your plan/account.</small></div>}
    {mode === "live" && chain && !chainError && <>
      <div className="options-kpi-grid">
        <div><small>UNDERLYING SPOT</small><strong>{chain.spot == null ? "—" : price.format(chain.spot)}</strong><span>{UNDERLYINGS.find((item) => item.value === underlying)?.label}</span></div>
        <div><small>PUT / CALL OI</small><strong>{pcr === null ? "—" : pcr.toFixed(2)}</strong><span>Calculated from chain open interest</span></div>
        <div><small>OI-BASED MAX PAIN</small><strong>{maxPain === null ? "—" : number.format(maxPain)}</strong><span>Approximation, not a target</span></div>
        <div><small>STRIKES RECEIVED</small><strong>{chainRows.length}</strong><span>Expiry {chain.expiry ?? expiry}</span></div>
      </div>
      <div className="option-chain-actions"><span>{selectedRows.length} of {chainRows.length} strikes shown</span><button type="button" className="chain-chart-button" onClick={() => setShowAllStrikes((value) => !value)}>{showAllStrikes ? "Focus on near-ATM strikes" : "Show all strikes"}</button></div>
      <div className="chain-table-wrap"><table className="premium-chain-table">
        <thead><tr><th colSpan={6}>CALLS</th><th className="strike-column">STRIKE</th><th colSpan={6}>PUTS</th></tr><tr><th>OI</th><th>IV</th><th>GREEKS Δ / Θ / Γ / V</th><th>BID / ASK</th><th>CHART</th><th>LTP</th><th className="strike-column">INR</th><th>LTP</th><th>CHART</th><th>BID / ASK</th><th>GREEKS Δ / Θ / Γ / V</th><th>IV</th><th>OI</th></tr></thead>
        <tbody>{selectedRows.map((row) => <tr key={row.strike} className={chain.spot !== null && row.strike === selectedRows.reduce((best, item) => Math.abs((item.strike ?? 0) - (chain.spot ?? 0)) < Math.abs((best?.strike ?? 0) - (chain.spot ?? 0)) ? item : best, selectedRows[0])?.strike ? "chain-atm" : ""}>
          <td>{row.call?.oi == null ? "—" : number.format(row.call.oi)}</td><td>{row.call?.iv == null ? "—" : row.call.iv.toFixed(1) + "%"}</td><td className="greeks-cell">{row.call ? "Δ " + (row.call.delta == null ? "—" : row.call.delta.toFixed(2)) + " · Θ " + (row.call.theta == null ? "—" : row.call.theta.toFixed(1)) + " · Γ " + (row.call.gamma == null ? "—" : row.call.gamma.toFixed(4)) + " · V " + (row.call.vega == null ? "—" : row.call.vega.toFixed(2)) : "—"}</td><td>{row.call?.bid == null || row.call.ask == null ? "—" : price.format(row.call.bid) + " / " + price.format(row.call.ask)}</td>
          <td><button className="chain-chart-button" disabled={!row.call?.instrumentKey} onClick={() => setSelectedContract(row.call?.instrumentKey ?? "")}>Chart</button></td><td className="chain-call-ltp">{row.call?.ltp == null ? "—" : price.format(row.call.ltp)}</td>
          <th className="strike-column">{row.strike == null ? "—" : number.format(row.strike)}</th>
          <td className="chain-put-ltp">{row.put?.ltp == null ? "—" : price.format(row.put.ltp)}</td><td><button className="chain-chart-button" disabled={!row.put?.instrumentKey} onClick={() => setSelectedContract(row.put?.instrumentKey ?? "")}>Chart</button></td>
          <td>{row.put?.bid == null || row.put.ask == null ? "—" : price.format(row.put.bid) + " / " + price.format(row.put.ask)}</td><td className="greeks-cell">{row.put ? "Δ " + (row.put.delta == null ? "—" : row.put.delta.toFixed(2)) + " · Θ " + (row.put.theta == null ? "—" : row.put.theta.toFixed(1)) + " · Γ " + (row.put.gamma == null ? "—" : row.put.gamma.toFixed(4)) + " · V " + (row.put.vega == null ? "—" : row.put.vega.toFixed(2)) : "—"}</td><td>{row.put?.iv == null ? "—" : row.put.iv.toFixed(1) + "%"}</td><td>{row.put?.oi == null ? "—" : number.format(row.put.oi)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="options-note">Chain data as of {chain.generatedAt ? new Date(chain.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) + " IST" : "provider response"} · Snapshot timing follows the provider, not a guaranteed exchange tick feed. Click Chart beside a contract to inspect its own premium history.</p>
    </>}
    {mode === "archive" && contracts.length > 0 && !archiveBusy && <>
      <div className="archive-contract-picker"><label className="chart-instrument-picker"><span>EXPIRED CONTRACT</span><select value={selectedContract} onChange={(event) => setSelectedContract(event.target.value)}>{contracts.map((item) => <option key={item.instrumentKey} value={item.instrumentKey}>{item.tradingSymbol} · lot {item.lotSize ?? "—"}</option>)}</select></label><span>{contracts.length} contracts returned</span></div>
      <p className="options-note">Historical contract data is not a continuous option series. Each strike and expiry is a distinct instrument; review the selected contract's actual candle coverage.</p>
    </>}
    {(mode === "live" ? !!activeKey : !!selectedContract) && <div className="premium-chart-section">
      <div className="premium-chart-heading"><div><small>CONTRACT PREMIUM / HISTORICAL CANDLES</small><h3>{optionName}</h3><p>{activeKey}</p></div>
        <div className="chart-range-tabs" role="tablist" aria-label="Option premium history timeframe">{RANGES.map((item) => <button key={item} role="tab" aria-selected={historyRange === item} className={historyRange === item ? "active" : ""} onClick={() => setHistoryRange(item)}>{item}</button>)}</div>
      </div>
      {premiumBusy && <div className="chart-loading"><span className="spinner" /> Loading this contract's premium candles…</div>}
      {premiumError && !premiumBusy && <div className="options-history-message">{premiumError}</div>}
      {!premiumBusy && !premiumError && !premiumChart && premiumCandles.length > 0 && <div className="options-history-message">At least two usable premium candles are required to draw the chart.</div>}
      {!premiumBusy && !premiumError && premium && premiumCandles.length === 0 && <div className="options-history-message">{premium.note ?? "No premium candles are available for this contract and window."}</div>}
      {!premiumBusy && !premiumError && premiumChart && <>
        <div className="premium-chart-stats"><span>LATEST PREMIUM <strong>₹{price.format(premiumChart.latest)}</strong></span><span>WINDOW CHANGE <strong className={premiumChart.changePct >= 0 ? "positive" : "negative"}>{premiumChart.changePct > 0 ? "+" : ""}{premiumChart.changePct.toFixed(2)}%</strong></span><span>CANDLES <strong>{premiumCandles.length}</strong></span><span>LOW / HIGH <strong>₹{price.format(premiumChart.min)} / ₹{price.format(premiumChart.max)}</strong></span></div>
        <svg className="premium-history-svg" viewBox={`0 0 ${premiumChart.width} ${premiumChart.height}`} role="img" aria-label="Selected option contract premium history">
          {[0, 1, 2, 3].map((line) => {
            const y = 16 + line * 62;
            const value = premiumChart.max - (line / 3) * (premiumChart.max - premiumChart.min);
            return <g key={line}><line x1="8" x2="925" y1={y} y2={y} className="chart-grid-line" /><text x="936" y={y + 4} className="chart-axis-label">{price.format(value)}</text></g>;
          })}
          <polyline points={premiumChart.points} className="premium-history-line" />
        </svg>
        <div className="chart-source-note">{premium?.source ?? "Upstox premium history"}. Range requested: {historyRange}; provider returned candles only for this contract's available life. This is not stitched across different strikes/expiries.</div>
      </>}
    </div>}
    <div className="options-risk-note"><strong>Before an options trade</strong><p>Premium decay, IV change, bid/ask spread, lot size, expiry settlement, slippage and fees can dominate an apparently attractive chart. Open-interest ratio and max pain are descriptive statistics, not reliable directional signals. This panel does not place orders.</p></div>
  </section>;
}
