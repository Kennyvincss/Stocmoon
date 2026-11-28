import { getMarket } from "@/lib/server/markets";
import { bad, json, rateLimit, serialize } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { publicEnv } from "@/lib/public-env";
import { ensureIndexed } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit("market", 240);
  if (limited) return limited;
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return bad("Invalid market id");
  const market = await getMarket(id);
  if (!market) return bad("Market not found", 404);
  let activity: readonly unknown[] = [];
  let participants: number | null = null;
  const sql = db();
  if (sql) {
    await ensureIndexed();
    activity = await sql`select event_name, account, args, tx_hash, block_number, block_time from market_events
      where chain_id = ${publicEnv.chainId} and market_id = ${id} order by block_number desc, log_index desc limit 50`;
    const [p] = await sql<{ n: number }[]>`select count(distinct account)::int as n from transactions
      where chain_id = ${publicEnv.chainId} and market_id = ${id} and action in ('buy','split','add_liquidity')`;
    participants = p?.n ?? 0;
  }
  return json(serialize({ market, activity, participants }), { maxAge: 5 });
}
