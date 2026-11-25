import type { Address } from "viem";
import { fetchAllTokenizedStocks, findSettlementProof, feedToNumber, oracleAdapterAbi, type TokenizedStock } from "@stocmoon/core";
import { publicEnv } from "../public-env";
import { categoryFor } from "../categories";
import { cached } from "./cache";
import { chainClient } from "./chain";
import { db } from "./db";
import { serverEnv } from "./env";

export interface OnchainAsset {
  registered: boolean;
  enabled: boolean;
  paused: boolean;
  tradable: boolean;
  feed?: Address;
  decimals?: number;
  maxStaleness?: number;
  feedPrice?: number | null;
  feedUpdatedAt?: number | null;
}

export interface StockView extends TokenizedStock {
  category: string;
  onchain: OnchainAsset;
  change24h: number | null;
  tradable: boolean;
  reasons: string[];
}

export interface StocksResponse {
  stocks: StockView[];
  source: "live" | "cache" | "database" | "unavailable";
  fetchedAt: string | null;
  stale: boolean;
  error?: string;
  registryConfigured: boolean;
}

const API_TTL = 60_000;

async function persist(stocks: TokenizedStock[], pages: number, skipped: number) {
  const sql = db();
  if (!sql) return;
  try {
    for (const s of stocks) {
      const raw = JSON.stringify(s);
      await sql`
        insert into stocks (address, symbol, name, description, decimals, icon_url, isin, total_supply, multiplier,
          nav_price, nav_price_updated_at, paused_features, first_mint_date, category, raw, last_synced_at)
        values (${s.address.toLowerCase()}, ${s.symbol}, ${s.name}, ${s.description}, ${s.decimals}, ${s.iconUrl}, ${s.isin},
          ${s.totalSupply}, ${s.multiplier}, ${s.navPrice}, ${s.navUpdatedAt}, ${s.pausedFeatures}, ${s.firstMintDate},
          ${categoryFor(s.symbol)}, ${raw}::jsonb, now())
        on conflict (address) do update set symbol = excluded.symbol, name = excluded.name, description = excluded.description,
          decimals = excluded.decimals, icon_url = excluded.icon_url, isin = excluded.isin, total_supply = excluded.total_supply,
          multiplier = excluded.multiplier, nav_price = excluded.nav_price, nav_price_updated_at = excluded.nav_price_updated_at,
          paused_features = excluded.paused_features, first_mint_date = excluded.first_mint_date, raw = excluded.raw,
          last_synced_at = now()`;
      if (s.navPrice !== null && s.navUpdatedAt) {
        await sql`insert into price_snapshots (stock_address, source, price, observed_at)
          values (${s.address.toLowerCase()}, 'api_nav', ${s.navPrice}, ${s.navUpdatedAt}) on conflict do nothing`;
      }
    }
    await sql`insert into api_sync_runs (source, ok, pages, records, skipped, finished_at)
      values ('tokenized-stocks-api', true, ${pages}, ${stocks.length}, ${skipped}, now())`;
  } catch (e) {
    console.error("[stocks] persist failed", (e as Error).message);
  }
}

async function loadFromDatabase(): Promise<{ stocks: TokenizedStock[]; at: string } | null> {
  const sql = db();
  if (!sql) return null;
  const rows = await sql<{ raw: TokenizedStock; last_synced_at: Date }[]>`select raw, last_synced_at from stocks order by symbol`;
  if (rows.length === 0) return null;
  const at = rows.reduce((m, r) => (r.last_synced_at > m ? r.last_synced_at : m), rows[0]!.last_synced_at);
  return { stocks: rows.map((r) => r.raw), at: at.toISOString() };
}

/** Onchain registry: every asset registered in OracleAdapter with its live feed status. */
export async function onchainRegistry(): Promise<Map<string, OnchainAsset>> {
  const oracle = publicEnv.oracle;
  const out = new Map<string, OnchainAsset>();
  if (!oracle) return out;
  const r = await cached("registry", 30_000, async () => {
    const client = chainClient();
    const count = await client.readContract({ address: oracle, abi: oracleAdapterAbi, functionName: "assetCount" });
    const idx = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
    const addrs = await Promise.all(
      idx.map((i) => client.readContract({ address: oracle, abi: oracleAdapterAbi, functionName: "assetAt", args: [i] })),
    );
    const rows = await Promise.all(
      addrs.map(async (a) => {
        const [info, tradable] = await Promise.all([
          client.readContract({ address: oracle, abi: oracleAdapterAbi, functionName: "getAsset", args: [a] }),
          client.readContract({ address: oracle, abi: oracleAdapterAbi, functionName: "isTradable", args: [a] }),
        ]);
        let feedPrice: number | null = null;
        let feedUpdatedAt: number | null = null;
        try {
          const [, answer, , updatedAt] = await client.readContract({
            address: info.feed,
            abi: [
              {
                type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
                outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
              },
            ] as const,
            functionName: "latestRoundData",
          });
          if (answer > 0n) feedPrice = feedToNumber(answer, info.decimals);
          feedUpdatedAt = Number(updatedAt);
        } catch {
          /* feed unavailable -> isTradable already false */
        }
        return [a.toLowerCase(), {
          registered: true, enabled: info.enabled, paused: info.paused, tradable, feed: info.feed,
          decimals: info.decimals, maxStaleness: info.maxStaleness, feedPrice, feedUpdatedAt,
        } satisfies OnchainAsset] as const;
      }),
    );
    return rows;
  });
  for (const [k, v] of r.value) out.set(k, v);
  return out;
}

/** 24h change from the onchain feed (preferred) or recorded API snapshots. Null when not verifiable. */
async function change24h(stocks: TokenizedStock[], registry: Map<string, OnchainAsset>): Promise<Map<string, number>> {
  const r = await cached("change24h", 5 * 60_000, async () => {
    const out = new Map<string, number>();
    const target = BigInt(Math.floor(Date.now() / 1000) - 86_400);
    await Promise.all(
      [...registry.entries()].map(async ([addr, a]) => {
        if (!a.feed || a.feedPrice == null || a.decimals == null) return;
        try {
          const p = await findSettlementProof(chainClient(), a.feed, target);
          if (target - p.updatedAt > 3n * 86_400n) return; // too old to call it a 24h change
          const then = feedToNumber(p.answer, a.decimals);
          if (then > 0) out.set(addr, a.feedPrice / then - 1);
        } catch {
          /* not enough history */
        }
      }),
    );
    const sql = db();
    if (sql) {
      const rows = await sql<{ stock_address: string; price: string }[]>`
        select distinct on (stock_address) stock_address, price from price_snapshots
        where observed_at <= now() - interval '24 hours' and observed_at >= now() - interval '4 days'
        order by stock_address, observed_at desc`;
      const byAddr = new Map(stocks.map((s) => [s.address.toLowerCase(), s]));
      for (const row of rows) {
        const s = byAddr.get(row.stock_address);
        if (!s || s.navPrice === null || out.has(row.stock_address)) continue;
        const then = Number(row.price);
        if (then > 0) out.set(row.stock_address, s.navPrice / then - 1);
      }
    }
    return [...out.entries()];
  }).catch(() => ({ value: [] as [string, number][] }));
  return new Map(r.value);
}

function enrich(s: TokenizedStock, registry: Map<string, OnchainAsset>, changes: Map<string, number>): StockView {
  const key = s.address.toLowerCase();
  const onchain = registry.get(key) ?? { registered: false, enabled: false, paused: false, tradable: false };
  const reasons = [...s.apiStatus.reasons];
  if (!onchain.registered) reasons.push("No StocMoon market feed registered for this token yet");
  else {
    if (!onchain.enabled) reasons.push("Disabled in StocMoon oracle registry");
    if (onchain.paused) reasons.push("Paused in StocMoon oracle registry");
    if (onchain.enabled && !onchain.paused && !onchain.tradable) reasons.push("Reference feed stale or unavailable");
  }
  return {
    ...s,
    category: categoryFor(s.symbol),
    onchain,
    change24h: changes.get(key) ?? null,
    tradable: s.apiStatus.listable && onchain.tradable,
    reasons,
  };
}

export async function getStocks(): Promise<StocksResponse> {
  let base: { stocks: TokenizedStock[]; fetchedAt: string | null; source: StocksResponse["source"]; stale: boolean; error?: string };
  try {
    const r = await cached("stocks:api", API_TTL, async () => {
      const res = await fetchAllTokenizedStocks({ baseUrl: serverEnv.tokenizedStocksApi });
      void persist(res.stocks, res.pages, res.skipped);
      return res;
    });
    base = { stocks: r.value.stocks, fetchedAt: r.value.fetchedAt, source: r.stale ? "cache" : "live", stale: r.stale, error: r.error };
  } catch (e) {
    const fromDb = await loadFromDatabase().catch(() => null);
    base = fromDb
      ? { stocks: fromDb.stocks, fetchedAt: fromDb.at, source: "database", stale: true, error: (e as Error).message }
      : { stocks: [], fetchedAt: null, source: "unavailable", stale: true, error: (e as Error).message };
  }
  const registry = await onchainRegistry().catch(() => new Map<string, OnchainAsset>());
  const changes = await change24h(base.stocks, registry);
  return {
    ...base,
    stocks: base.stocks.map((s) => enrich(s, registry, changes)).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    registryConfigured: Boolean(publicEnv.oracle),
  };
}

export async function getStock(address: string): Promise<{ stock: StockView | null; meta: Omit<StocksResponse, "stocks"> }> {
  const all = await getStocks();
  const { stocks, ...meta } = all;
  return { stock: stocks.find((s) => s.address.toLowerCase() === address.toLowerCase()) ?? null, meta };
}
