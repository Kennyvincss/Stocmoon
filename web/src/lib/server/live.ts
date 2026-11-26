import { cached } from "./cache";
import { serverEnv } from "./env";

/**
 * Live (display-only) stock prices. Pyth publishes sub-second equity prices but, since Pyth's Aug-2026 upgrade,
 * Hermes requires an API key (PYTH_API_KEY, server-side only). Without a key the caller falls back to the
 * Chainlink reference price. These prices are NEVER used for settlement.
 */
const HERMES = process.env.PYTH_HERMES_URL || "https://hermes.pyth.network";

export interface LiveQuote {
  /** Underlying share price in USD. */
  price: number;
  /** Unix seconds of the publisher update. */
  publishTime: number;
  /** "Equity.US.NVDA/USD" (regular hours) or "Equity.Index.NVDA/USD" (24/7 indicative). */
  symbol: string;
  session: "regular" | "24/7";
}

export const pythConfigured = () => Boolean(process.env.PYTH_API_KEY);

function headers(): HeadersInit {
  return process.env.PYTH_API_KEY ? { authorization: `Bearer ${process.env.PYTH_API_KEY}` } : {};
}

/** Pyth feed ids for a ticker: regular-hours feed and 24/7 feed (either may be missing). */
async function feedIds(ticker: string): Promise<{ regular?: string; allDay?: string }> {
  const r = await cached(`pyth:ids:${ticker}`, 24 * 3600_000, async () => {
    const url = `${HERMES}/v2/price_feeds?query=${encodeURIComponent(ticker)}&asset_type=equity`;
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`pyth feeds HTTP ${res.status}`);
    const list = (await res.json()) as { id: string; attributes: { symbol?: string } }[];
    const find = (s: string) => list.find((f) => f.attributes.symbol === s)?.id;
    return { regular: find(`Equity.US.${ticker}/USD`), allDay: find(`Equity.Index.${ticker}/USD`) };
  });
  return r.value;
}

interface ParsedPrice {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

/** Latest live quote: the regular-hours feed if it is fresh (< 60s), otherwise the 24/7 feed. */
export async function liveQuote(ticker: string): Promise<LiveQuote | null> {
  if (!pythConfigured()) return null;
  const ids = await feedIds(ticker).catch(() => ({}) as { regular?: string; allDay?: string });
  const want = [ids.regular, ids.allDay].filter(Boolean) as string[];
  if (!want.length) return null;
  const r = await cached(`pyth:latest:${want.join(",")}`, 1_000, async () => {
    const qs = want.map((id) => `ids[]=${id}`).join("&");
    const res = await fetch(`${HERMES}/v2/updates/price/latest?${qs}&parsed=true`, { headers: headers(), signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`pyth latest HTTP ${res.status}`);
    return ((await res.json()) as { parsed: ParsedPrice[] }).parsed;
  });
  const now = Math.floor(Date.now() / 1000);
  const pick = (id?: string) => r.value.find((p) => id && p.id.replace(/^0x/, "") === id.replace(/^0x/, ""));
  const reg = pick(ids.regular);
  const all = pick(ids.allDay);
  const use = reg && now - reg.price.publish_time < 60 ? { p: reg, s: "regular" as const } : all ? { p: all, s: "24/7" as const } : reg ? { p: reg, s: "regular" as const } : null;
  if (!use) return null;
  const price = Number(use.p.price.price) * 10 ** use.p.price.expo;
  if (!(price > 0)) return null;
  return {
    price,
    publishTime: use.p.price.publish_time,
    symbol: use.s === "regular" ? `Equity.US.${ticker}/USD` : `Equity.Index.${ticker}/USD`,
    session: use.s,
  };
}

void serverEnv;
