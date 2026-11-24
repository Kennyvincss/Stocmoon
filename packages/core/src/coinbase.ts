import { getAddress, isAddress, type Address } from "viem";

/**
 * Client for the public, read-only Base Tokenized Stocks API.
 * Docs: https://docs.base.org/sdks/tokenized-stocks/api-reference/list-tokenized-stocks
 *
 * Rules implemented (from the docs):
 *  - cursor pagination via `page_token` / `next_page_token`, until `next_page_token` is absent
 *  - default-valued fields are OMITTED from responses -> every field is optional here
 *  - assets are identified by `contract_address`, never by ticker
 *  - `nav_price` is a Chainlink-based NAV/reference value, NOT an execution price; missing NAV = no price
 *  - `multiplier` (API value, already de-WAD'ed) converts token units to share-equivalent units
 */
export const TOKENIZED_STOCKS_API = "https://api.coinbase.com/v1/tokenized-stocks";

export interface TokenizedStock {
  address: Address;
  symbol: string;
  name: string;
  description: string | null;
  decimals: number | null;
  iconUrl: string | null;
  isin: string | null;
  /** Total supply in token units as reported by the API (null when omitted). */
  totalSupply: number | null;
  /** Token -> underlying-share ratio (1 = no adjustment). */
  multiplier: number | null;
  /** Total supply expressed in underlying shares = totalSupply × multiplier. */
  shareEquivalentSupply: number | null;
  /** Reference NAV per token in USD. null = unavailable (never treated as 0). */
  navPrice: number | null;
  navUpdatedAt: string | null;
  pausedFeatures: number[];
  firstMintDate: string | null;
  /** API-level tradability only. Oracle/feed checks happen separately. */
  apiStatus: { listable: boolean; reasons: string[] };
}

export interface FetchStocksResult {
  stocks: TokenizedStock[];
  pages: number;
  skipped: number;
  fetchedAt: string;
}

export interface FetchStocksOptions {
  baseUrl?: string;
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Feature codes documented for B20 pausing (mapping to API integers is unverified; shown raw as well). */
export const PAUSE_FEATURE_LABELS: Record<number, string> = { 0: "transfer", 1: "mint", 2: "burn", 3: "seize" };

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return toNumber(o.value ?? o.amount ?? o.price);
  }
  return null;
}

function toStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function toTimestamp(v: unknown): string | null {
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000).toISOString();
  if (v && typeof v === "object" && "seconds" in (v as object)) {
    const s = toNumber((v as { seconds: unknown }).seconds);
    return s === null ? null : new Date(s * 1000).toISOString();
  }
  return null;
}

/** Parses one raw API record. Returns null for records without a valid contract address. */
export function parseTokenizedStock(raw: unknown): TokenizedStock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const addr = toStr(r.contract_address);
  if (!addr || !isAddress(addr, { strict: false })) return null;

  const totalSupply = toNumber(r.total_supply);
  const multiplier = toNumber(r.multiplier);
  const navPriceRaw = toNumber(r.nav_price);
  const navPrice = navPriceRaw !== null && navPriceRaw > 0 ? navPriceRaw : null;
  const navUpdatedAt = toTimestamp(r.nav_price_updated_at);
  const pausedFeatures = Array.isArray(r.paused_features)
    ? r.paused_features.map((x) => toNumber(x)).filter((x): x is number => x !== null)
    : [];

  const reasons: string[] = [];
  if (navPrice === null) reasons.push("No NAV/reference price published");
  if (navPrice !== null && !navUpdatedAt) reasons.push("NAV timestamp missing");
  if (pausedFeatures.length > 0) {
    reasons.push(`Issuer paused: ${pausedFeatures.map((f) => PAUSE_FEATURE_LABELS[f] ?? `feature ${f}`).join(", ")}`);
  }
  if (multiplier !== null && multiplier <= 0) reasons.push("Invalid multiplier");

  const symbol = toStr(r.symbol) ?? toStr(r.ticker) ?? "";
  return {
    address: getAddress(addr),
    symbol,
    name: toStr(r.name) ?? symbol,
    description: toStr(r.description),
    decimals: toNumber(r.decimals),
    iconUrl: toStr(r.icon_url),
    isin: toStr(r.isin),
    totalSupply,
    multiplier,
    shareEquivalentSupply: totalSupply !== null && multiplier !== null ? totalSupply * multiplier : null,
    navPrice,
    navUpdatedAt,
    pausedFeatures,
    firstMintDate: toTimestamp(r.first_mint_date),
    apiStatus: { listable: reasons.length === 0, reasons },
  };
}

/** Fetches every page of the Tokenized Stocks API. Throws on HTTP/network failure (callers fall back to cache). */
export async function fetchAllTokenizedStocks(opts: FetchStocksOptions = {}): Promise<FetchStocksResult> {
  const baseUrl = opts.baseUrl ?? TOKENIZED_STOCKS_API;
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 50;
  const doFetch = opts.fetchImpl ?? fetch;
  const byAddress = new Map<string, TokenizedStock>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  let skipped = 0;

  do {
    const url = new URL(baseUrl);
    url.searchParams.set("page_size", String(pageSize));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await doFetch(url.toString(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`Tokenized Stocks API HTTP ${res.status}`);
    const body = (await res.json()) as { tokens?: unknown[]; next_page_token?: string };
    pages++;
    for (const raw of body.tokens ?? []) {
      const s = parseTokenizedStock(raw);
      if (!s) {
        skipped++;
        continue;
      }
      byAddress.set(s.address.toLowerCase(), s);
    }
    pageToken = typeof body.next_page_token === "string" && body.next_page_token ? body.next_page_token : undefined;
    if (pageToken) {
      if (seenTokens.has(pageToken)) throw new Error("Tokenized Stocks API returned a repeated page token");
      seenTokens.add(pageToken);
    }
  } while (pageToken && pages < maxPages);

  return { stocks: [...byAddress.values()], pages, skipped, fetchedAt: new Date().toISOString() };
}

/** Age of the NAV in seconds, or null. */
export function navAgeSeconds(stock: Pick<TokenizedStock, "navUpdatedAt">, now = Date.now()): number | null {
  if (!stock.navUpdatedAt) return null;
  return Math.max(0, Math.floor((now - Date.parse(stock.navUpdatedAt)) / 1000));
}
