import { z } from "zod";
import { leaderboard, MIN_RESOLVED, MIN_VOLUME } from "@/lib/server/leaderboard";
import { bad, json, rateLimit } from "@/lib/server/http";
import { ensureIndexed } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

const Query = z.object({
  period: z.enum(["daily", "weekly", "monthly", "all"]).default("weekly"),
  sort: z.enum(["pnl", "accuracy"]).default("pnl"),
});

export async function GET(req: Request) {
  const limited = await rateLimit("leaderboard", 60);
  if (limited) return limited;
  const q = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return bad("Invalid query");
  await ensureIndexed();
  const r = await leaderboard(q.data.period, q.data.sort).catch(() => ({ rows: [], available: false }));
  return json({ ...r, rules: { minResolvedMarkets: MIN_RESOLVED, minVolume: MIN_VOLUME.toString() } }, { maxAge: 30 });
}
