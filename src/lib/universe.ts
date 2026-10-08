export type UniverseStock = { symbol: string; name: string };

// Liquid, well-followed NSE names; this is a screening universe, not a buy list.
export const UNIVERSE: UniverseStock[] = [
  { symbol: "RELIANCE.NS", name: "Reliance Industries" },
  { symbol: "HDFCBANK.NS", name: "HDFC Bank" },
  { symbol: "ICICIBANK.NS", name: "ICICI Bank" },
  { symbol: "SBIN.NS", name: "State Bank of India" },
  { symbol: "INFY.NS", name: "Infosys" },
  { symbol: "TCS.NS", name: "Tata Consultancy Services" },
  { symbol: "LT.NS", name: "Larsen & Toubro" },
  { symbol: "ITC.NS", name: "ITC" },
  { symbol: "BHARTIARTL.NS", name: "Bharti Airtel" },
  { symbol: "AXISBANK.NS", name: "Axis Bank" },
  { symbol: "KOTAKBANK.NS", name: "Kotak Mahindra Bank" },
  { symbol: "BAJFINANCE.NS", name: "Bajaj Finance" },
  { symbol: "MARUTI.NS", name: "Maruti Suzuki" },
  { symbol: "SUNPHARMA.NS", name: "Sun Pharmaceutical" },
  { symbol: "TITAN.NS", name: "Titan Company" },
  { symbol: "NTPC.NS", name: "NTPC" },
  { symbol: "POWERGRID.NS", name: "Power Grid Corporation" },
  { symbol: "ONGC.NS", name: "ONGC" },
  { symbol: "TATASTEEL.NS", name: "Tata Steel" },
  { symbol: "TRENT.NS", name: "Trent" },
  { symbol: "ULTRACEMCO.NS", name: "UltraTech Cement" },
  { symbol: "ASIANPAINT.NS", name: "Asian Paints" },
  { symbol: "WIPRO.NS", name: "Wipro" },
  { symbol: "ADANIENT.NS", name: "Adani Enterprises" },
  { symbol: "BEL.NS", name: "Bharat Electronics" }
];
