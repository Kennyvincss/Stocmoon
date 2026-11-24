import { getMarket, settlementProof } from "@/lib/server/markets";
import { bad, json, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Round ids for `resolve()`. Advisory only — the contract verifies them, so a bad proof just reverts. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit("proof", 30);
  if (limited) return limited;
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return bad("Invalid market id");
  const market = await getMarket(id);
  if (!market) return bad("Market not found", 404);
  if (market.kind === "EVENT") return bad("Event markets are resolved by the resolver + dispute window");
  const now = Math.floor(Date.now() / 1000);
  if (now < market.closeTime + market.settlementDelay) return bad("Settlement not open yet", 409);
  try {
    const proof = await settlementProof(market);
    return json({ proof });
  } catch (e) {
    return bad(`Could not build proof: ${(e as Error).message.slice(0, 200)}`, 502);
  }
}
