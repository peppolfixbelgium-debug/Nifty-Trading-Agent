import type { UniverseStock } from "./universe.js";

/**
 * Broad-market and sector indices available as Yahoo Finance daily OHLCV symbols.
 * These are price-series research instruments, not automatically executable products.
 * Runtime history/coverage checks remain authoritative because Yahoo's endpoint is unofficial.
 */
export const INDEX_UNIVERSE: UniverseStock[] = [
  { symbol: "^NSEI", name: "Nifty 50" },
  { symbol: "^NSEBANK", name: "Nifty Bank" },
  { symbol: "^CNX100", name: "Nifty 100" },
  { symbol: "^CNX200", name: "Nifty 200" },
  { symbol: "^CNX500", name: "Nifty 500" },
  { symbol: "^NSMIDCP", name: "Nifty Midcap Select" },
  { symbol: "^NSEMDCP50", name: "Nifty Midcap 50" },
  { symbol: "^CNXIT", name: "Nifty IT" },
  { symbol: "^CNXAUTO", name: "Nifty Auto" },
  { symbol: "^CNXPHARMA", name: "Nifty Pharma" },
  { symbol: "^CNXFMCG", name: "Nifty FMCG" },
  { symbol: "^CNXMETAL", name: "Nifty Metal" },
  { symbol: "^CNXENERGY", name: "Nifty Energy" },
  { symbol: "^CNXREALTY", name: "Nifty Realty" },
  { symbol: "^CNXMEDIA", name: "Nifty Media" },
  { symbol: "^CNXPSUBANK", name: "Nifty PSU Bank" },
  { symbol: "^CNXINFRA", name: "Nifty Infrastructure" },
  { symbol: "^CNXFIN", name: "Nifty Financial Services" }
];
