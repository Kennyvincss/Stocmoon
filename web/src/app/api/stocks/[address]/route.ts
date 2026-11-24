import { isAddress } from "viem";
import { getStock } from "@/lib/server/stocks";
import { listMarkets } from "@/lib/server/markets";
import { bad, json, rateLimit, serialize } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ address: string }> }) {
  const limited = await rateLimit("stock", 240);
  if (limited) return limited;
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) return bad("Invalid token address");
  const { stock, meta } = await getStock(address);
  if (!stock) return bad("Token not found in the Tokenized Stocks API", 404);
  const markets = await listMarkets({ asset: address }).catch(() => []);
  return json(serialize({ stock, meta, markets }), { maxAge: 10 });
}
