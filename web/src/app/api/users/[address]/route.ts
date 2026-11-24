import { isAddress } from "viem";
import { bad, json, rateLimit } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { userStats } from "@/lib/server/leaderboard";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ address: string }> }) {
  const limited = await rateLimit("user", 120);
  if (limited) return limited;
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) return bad("Invalid address");
  const sql = db();
  if (!sql) return json({ profile: null, stats: null, available: false });
  const [p] = await sql<{ username: string | null; avatar_url: string | null }[]>`
    select username, avatar_url from users where address = ${address.toLowerCase()}`;
  return json({
    profile: p ? { username: p.username, avatarUrl: p.avatar_url } : null,
    stats: await userStats(address),
    available: true,
  });
}
