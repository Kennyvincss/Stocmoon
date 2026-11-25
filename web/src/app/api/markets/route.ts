import { z } from "zod";
import { listMarkets } from "@/lib/server/markets";
import { bad, json, rateLimit, serialize } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Query = z.object({
  kind: z.enum(["UP_DOWN", "BATTLE", "EVENT"]).optional(),
  asset: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  phase: z.enum(["trading", "awaiting-close", "settling", "proposed", "resolved", "expired"]).optional(),
});

export async function GET(req: Request) {
  const limited = await rateLimit("markets", 240);
  if (limited) return limited;
  const q = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return bad("Invalid query");
  try {
    return json(serialize({ markets: await listMarkets(q.data) }), { maxAge: 5 });
  } catch (e) {
    return json({ markets: [], error: `Chain read failed: ${(e as Error).message.slice(0, 200)}` }, { status: 502 });
  }
}
