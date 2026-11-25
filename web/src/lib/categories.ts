/**
 * StocMoon editorial categories for discovery filters (not part of the Coinbase API).
 * Unknown tickers fall into "Other". Categories are informational only.
 */
const MAP: Record<string, string> = {
  AAPL: "Technology", MSFT: "Technology", GOOGL: "Technology", GOOG: "Technology", META: "Technology",
  ORCL: "Technology", CRM: "Technology", ADBE: "Technology", IBM: "Technology", PLTR: "Technology",
  NVDA: "Semiconductors", AMD: "Semiconductors", INTC: "Semiconductors", AVGO: "Semiconductors", TSM: "Semiconductors",
  QCOM: "Semiconductors", MU: "Semiconductors", ARM: "Semiconductors",
  AMZN: "Consumer", TSLA: "Consumer", NKE: "Consumer", SBUX: "Consumer", MCD: "Consumer", KO: "Consumer",
  PEP: "Consumer", WMT: "Consumer", COST: "Consumer", DIS: "Media", NFLX: "Media", SPOT: "Media",
  COIN: "Crypto & Fintech", HOOD: "Crypto & Fintech", MSTR: "Crypto & Fintech", CRCL: "Crypto & Fintech",
  PYPL: "Crypto & Fintech", SQ: "Crypto & Fintech", XYZ: "Crypto & Fintech",
  JPM: "Financials", GS: "Financials", BAC: "Financials", V: "Financials", MA: "Financials", BRK: "Financials",
  JNJ: "Healthcare", PFE: "Healthcare", LLY: "Healthcare", UNH: "Healthcare", MRNA: "Healthcare",
  XOM: "Energy", CVX: "Energy",
  SPY: "ETFs", QQQ: "ETFs", IWM: "ETFs", GLD: "ETFs",
};

export function categoryFor(symbol: string): string {
  // Coinbase tokenized-stock tickers carry a lowercase "c" suffix (e.g. AAPLc -> AAPL)
  const s = symbol.replace(/c$/, "").toUpperCase().replace(/[^A-Z]/g, "");
  return MAP[s] ?? MAP[s.replace(/^(CB|C|X)/, "")] ?? "Other";
}

export const CATEGORIES = [
  "Technology", "Semiconductors", "Consumer", "Media", "Crypto & Fintech", "Financials", "Healthcare", "Energy", "ETFs", "Other",
];
