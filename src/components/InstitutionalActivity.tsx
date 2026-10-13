import { useEffect, useMemo, useState } from "react";
import type { InstitutionalActivityResponse, InstitutionalDeal, OwnershipChange, PromoterHoldingSnapshot } from "../lib/long-term-types.js";
import { UNIVERSE } from "../lib/universe.js";

type DealFilter = "ALL" | "INSTITUTIONS" | "BUY" | "SELL";
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const money = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : "₹" + compact.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
const quantity = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : whole.format(value);
const sideLabel = (side: InstitutionalDeal["side"]) => side === "BUY" ? "BUY" : side === "SELL" ? "SELL" : "UNREPORTED";

function DealRow({ deal }: { deal: InstitutionalDeal }) {
  return <tr>
    <td>{deal.date ?? "—"}<small>{deal.dealType} DEAL</small></td>
    <td><strong>{deal.symbol}</strong><small>{deal.company || deal.symbol}</small></td>
    <td><strong>{deal.client}</strong><small>{deal.institutionLike ? "Institution-like name · heuristic" : "Disclosed client name"}</small></td>
    <td><span className={"lt-side-badge lt-side-" + deal.side.toLowerCase()}>{sideLabel(deal.side)}</span></td>
    <td>{quantity(deal.quantity)}</td>
    <td>{deal.price === null ? "—" : "₹" + deal.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
    <td><strong>{deal.valueCrore === null ? "—" : "₹" + deal.valueCrore.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " Cr"}</strong></td>
  </tr>;
}

function HolderRow({ holder }: { holder: OwnershipChange }) {
  const label = holder.direction === "INCREASED" ? "Increased" : holder.direction === "REDUCED" ? "Reduced" : holder.direction === "UNCHANGED" ? "Unchanged" : "Change unavailable";
  return <tr>
    <td><strong>{holder.name}</strong><small>Report date: {holder.reportDate ?? "not returned"}</small></td>
    <td>{holder.pctHeld === null ? "—" : holder.pctHeld.toFixed(2) + "%"}</td>
    <td>{quantity(holder.shares)}</td>
    <td>{holder.sharesChange === null ? "—" : (holder.sharesChange > 0 ? "+" : "") + quantity(holder.sharesChange)}</td>
    <td><span className={"lt-change-badge lt-change-" + holder.direction.toLowerCase()}>{label}</span></td>
    <td>{holder.pctChange === null ? "—" : percent(holder.pctChange)}</td>
  </tr>;
}

function PromoterTrend({ snapshots }: { snapshots: PromoterHoldingSnapshot[] }) {
  if (!snapshots.length) return <div className="lt-empty-state"><strong>No shareholding snapshots received</strong><p>The exchange did not return enough quarterly disclosure data to calculate a trend.</p></div>;
  const latest = snapshots[0];
  const previous = snapshots[1];
  const change = latest && previous && latest.promoterPct !== null && previous.promoterPct !== null ? latest.promoterPct - previous.promoterPct : null;
  return <div className="lt-promoter-panel">
    <div className="lt-promoter-summary"><div><small>LATEST REPORTED QUARTER</small><strong>{latest?.date ?? "—"}</strong></div><div><small>PROMOTER GROUP</small><strong>{latest?.promoterPct === null || latest?.promoterPct === undefined ? "—" : latest.promoterPct.toFixed(2) + "%"}</strong></div><div><small>QUARTER-OVER-QUARTER</small><strong className={change === null ? "" : change >= 0 ? "positive" : "negative"}>{change === null ? "—" : (change > 0 ? "+" : "") + change.toFixed(2) + " pp"}</strong></div><div><small>PUBLIC SHAREHOLDING</small><strong>{latest?.publicPct === null || latest?.publicPct === undefined ? "—" : latest.publicPct.toFixed(2) + "%"}</strong></div></div>
    <div className="lt-promoter-timeline">{snapshots.map(snapshot => <div key={snapshot.date}><span>{snapshot.date}</span><strong>{snapshot.promoterPct === null ? "—" : snapshot.promoterPct.toFixed(2) + "%"}</strong><small>Promoter group · submitted {snapshot.submissionDate ?? "date not returned"}</small></div>)}</div>
    <p className="lt-data-caveat">Promoter shareholding is separate from FII/DII ownership. Quarter-on-quarter change is based on reported percentages; it is not a substitute for inspecting the full shareholding-pattern filing.</p>
  </div>;
}

export default function InstitutionalActivity() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [activity, setActivity] = useState<InstitutionalActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DealFilter>("ALL");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/institutional-activity?symbol=" + encodeURIComponent(symbol) + "&refresh=" + refresh, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async response => {
        const body = await response.json() as InstitutionalActivityResponse & { error?: string; detail?: string };
        if (!response.ok) throw new Error([body.error, body.detail].filter(Boolean).join(" "));
        return body;
      })
      .then(setActivity)
      .catch(caught => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setActivity(null);
        setError(caught instanceof Error ? caught.message : "Could not load disclosed institutional activity.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [symbol, refresh]);

  const filteredDeals = useMemo(() => {
    const deals = activity?.deals ?? [];
    if (filter === "INSTITUTIONS") return deals.filter(deal => deal.institutionLike);
    if (filter === "BUY") return deals.filter(deal => deal.side === "BUY");
    if (filter === "SELL") return deals.filter(deal => deal.side === "SELL");
    return deals;
  }, [activity, filter]);

  const buys = (activity?.deals ?? []).filter(deal => deal.side === "BUY");
  const sells = (activity?.deals ?? []).filter(deal => deal.side === "SELL");
  const institutionDeals = (activity?.deals ?? []).filter(deal => deal.institutionLike);
  const increases = (activity?.institutions ?? []).filter(holder => holder.direction === "INCREASED").length;
  const decreases = (activity?.institutions ?? []).filter(holder => holder.direction === "REDUCED").length;

  return <section className="long-term-workspace lt-institutional-workspace" aria-labelledby="institution-title">
    <div className="lt-workspace-header">
      <div>
        <div className="section-kicker">LONG-TERM INVESTING / DISCLOSURE RADAR</div>
        <h1 id="institution-title">Follow disclosed money.<br /><em>Verify the position.</em></h1>
        <p>Track large disclosed bulk/block deals, named institutional holder changes and quarterly promoter disclosures. Treat filings as evidence to investigate—not as automatic copy-trading signals.</p>
      </div>
      <div className="lt-header-stamp lt-header-stamp-institution"><span>DISCLOSED ACTIVITY</span><strong>₹1Cr+</strong><small>Recent 30-day deal window</small></div>
    </div>

    <div className="lt-search-bar lt-institution-filterbar">
      <label htmlFor="institution-stock"><span>COMPANY FOR HOLDER / PROMOTER DETAILS</span><select id="institution-stock" value={symbol} onChange={event => setSymbol(event.target.value)}>{UNIVERSE.map(stock => <option key={stock.symbol} value={stock.symbol.replace(/\.NS$/, "")}>{stock.symbol.replace(/\.NS$/, "")} · {stock.name}</option>)}</select></label>
      <button type="button" className="scan-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? <><span className="spinner" /> Refreshing…</> : <><span>↻</span> Refresh disclosures</>}</button>
      <small>Deal feed covers the market; named-holder and promoter detail is for the selected stock. Public exchange feeds can be temporarily unavailable.</small>
    </div>

    {error && <div className="error-banner"><strong>Institutional activity unavailable</strong><span>{error}</span><button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    {loading && !activity && <div className="lt-loading"><span className="spinner" /> Reading public exchange disclosures and holder data…</div>}
    {activity && <>
      <div className="lt-institution-kpis">
        <article><small>LARGE DISCLOSED DEALS</small><strong>{activity.deals.length}</strong><span>₹1 crore+ over the recent window</span></article>
        <article><small>BUY DISCLOSURES</small><strong className="positive">{buys.length}</strong><span>Disclosed purchase-side deals</span></article>
        <article><small>SELL DISCLOSURES</small><strong className="negative">{sells.length}</strong><span>Disclosed sale-side deals</span></article>
        <article><small>NAMED HOLDER SIGNALS</small><strong>{increases} ↑ / {decreases} ↓</strong><span>Only where source reported a comparable change</span></article>
      </div>

      <section className="lt-institutional-section">
        <div className="lt-section-heading"><div><div className="section-kicker">ALL-MARKET / OFFICIAL EXCHANGE FILINGS</div><h2>Large bulk & block deals</h2><p>Disclosed client names, side, quantity, price and estimated deal value. Use the client name in the original filing to identify the actual beneficial owner.</p></div><span>{filteredDeals.length} shown</span></div>
        <div className="lt-deal-filter" role="tablist" aria-label="Filter disclosed deals">
          {([{ id: "ALL", label: "All large deals" }, { id: "INSTITUTIONS", label: "Institution-like names" }, { id: "BUY", label: "Buy disclosures" }, { id: "SELL", label: "Sell disclosures" }] as Array<{ id: DealFilter; label: string }>).map(item => <button type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)} key={item.id}>{item.label}</button>)}
        </div>
        <div className="lt-table-wrap"><table className="lt-table lt-deal-table"><thead><tr><th>DISCLOSURE DATE</th><th>STOCK</th><th>CLIENT / DISCLOSED NAME</th><th>SIDE</th><th>QUANTITY</th><th>PRICE</th><th>APPROX. VALUE</th></tr></thead><tbody>
          {filteredDeals.map(deal => <DealRow key={deal.id} deal={deal} />)}
          {!filteredDeals.length && !loading && <tr><td colSpan={7} className="lt-table-empty">No deal rows match this filter. A blank list does not mean there was no institutional activity.</td></tr>}
        </tbody></table></div>
        <div className="lt-data-caveat"><strong>Important:</strong> “Institution-like name” is a name-based helper, not verified investor classification. A bulk/block purchase can be a fresh disclosed trade, but by itself does not prove a first-time position or that the buyer still holds the stock.</div>
      </section>

      <section className="lt-institutional-section">
        <div className="lt-section-heading"><div><div className="section-kicker">SELECTED STOCK / INSTITUTION & FUND HOLDINGS</div><h2>Who is holding—and adding or reducing?</h2><p>{symbol}: holder rows are shown only when the free source reports the organization and share-change fields.</p></div><span>{activity.institutions.length} names returned</span></div>
        {activity.institutions.length ? <div className="lt-table-wrap"><table className="lt-table"><thead><tr><th>INSTITUTION / FUND</th><th>SHARES HELD (%)</th><th>SHARES</th><th>SHARE CHANGE</th><th>DIRECTION</th><th>% CHANGE</th></tr></thead><tbody>{activity.institutions.map((holder, index) => <HolderRow key={holder.name + index} holder={holder} />)}</tbody></table></div> : <div className="lt-empty-state"><strong>No comparable named-holder changes returned for {symbol}</strong><p>Ownership lists may be missing, delayed or lack share-change fields for Indian tickers. Do not treat an absent row as zero ownership; open the source data to verify.</p></div>}
      </section>

      <section className="lt-institutional-section">
        <div className="lt-section-heading"><div><div className="section-kicker">QUARTERLY / NSE FILINGS</div><h2>Promoter holding trend · {symbol}</h2><p>Quarter-on-quarter promoter group change can add context, but is not the same as institutional FII/DII buying.</p></div><span>{activity.promoterSnapshots.length} disclosures</span></div>
        <PromoterTrend snapshots={activity.promoterSnapshots} />
      </section>

      {activity.warnings.length > 0 && <div className="lt-warning-list"><strong>Data coverage & interpretation</strong>{activity.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      <div className="lt-source-row"><span>SOURCES & AUDIT TRAIL</span>{activity.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div>
    </>}
  </section>;
}
