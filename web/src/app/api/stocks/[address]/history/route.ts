import { isAddress, type Address } from "viem";
import { z } from "zod";
import { feedToNumber, mirrorAggregatorAbi, recentRounds } from "@stocmoon/core";
import { onchainRegistry } from "@/lib/server/stocks";
import { chainClient, mainnetClient } from "@/lib/server/chain";
import { cached } from "@/lib/server/cache";
import { db } from "@/lib/server/db";
import { bad, json, rateLimit } from "@/lib/server/http";
import { publicEnv } from "@/lib/public-env";

export const dynamic = "force-dynamic";

const RANGES = { "1H": 3600, "4H": 14_400, "1D": 86_400, "1W": 604_800, "1M": 2_592_000, "1Y": 31_536_000 } as const;
const Query = z.object({ range: z.enum(Object.keys(RANGES) as [keyof typeof RANGES]).default("1D") });

interface Point {
  time: number;
  value: number;
}

/**
 * Reference-price history. Sources, in order: Chainlink rounds of the asset's feed (on testnet: the mainnet source feed
 * the mirror copies), then StocMoon's recorded API NAV snapshots. Ranges without coverage are reported as unavailable,
 * never filled with synthetic data.
 */
export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const limited = await rateLimit("history", 120);
  if (limited) return limited;
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) return bad("Invalid token address");
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return bad("Invalid range");
  const range = parsed.data.range;
  const since = Math.floor(Date.now() / 1000) - RANGES[range];

  const r = await cached(`history:${address.toLowerCase()}`, 60_000, async () => {
    const points: Point[] = [];
    let source = "none";
    const reg = (await onchainRegistry().catch(() => new Map())).get(address.toLowerCase());
    if (reg?.feed && reg.decimals != null) {
      try {
        let client = chainClient();
        let feed: Address = reg.feed;
        if (publicEnv.chainId !== 8453) {
          // testnet mirror -> read history from the real mainnet feed it mirrors
          const src = await client.readContract({ address: feed, abi: mirrorAggregatorAbi, functionName: "sourceFeed" }).catch(() => null);
          if (src) {
            client = mainnetClient();
            feed = src;
            source = "chainlink-mainnet";
          } else source = "feed";
        } else source = "chainlink";
        const rounds = await recentRounds(client, feed, 400);
        for (const rd of rounds) points.push({ time: Number(rd.updatedAt), value: feedToNumber(rd.answer, reg.decimals) });
      } catch {
        source = "none";
      }
    }
    const sql = db();
    if (sql) {
      const rows = await sql<{ t: Date; price: string }[]>`
        select observed_at as t, price from price_snapshots where stock_address = ${address.toLowerCase()}
        and observed_at >= now() - interval '366 days' order by observed_at`;
      const have = new Set(points.map((p) => p.time));
      for (const row of rows) {
        const t = Math.floor(row.t.getTime() / 1000);
        if (!have.has(t)) points.push({ time: t, value: Number(row.price) });
      }
      if (rows.length) source = source === "none" ? "nav-snapshots" : `${source}+nav-snapshots`;
    }
    points.sort((a, b) => a.time - b.time);
    return { points, source };
  });

  const all = r.value.points;
  const earliest = all[0]?.time ?? null;
  const available = Object.fromEntries(
    Object.entries(RANGES).map(([k, secs]) => [k, earliest !== null && earliest <= Math.floor(Date.now() / 1000) - secs * 0.5]),
  );
  return json({
    range, source: r.value.source, stale: r.stale, earliest, available,
    points: all.filter((p) => p.time >= since),
  }, { maxAge: 30 });
}
