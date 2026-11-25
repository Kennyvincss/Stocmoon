import { getAddress, isAddress } from "viem";
import { getPortfolio } from "@/lib/server/portfolio";
import { bad, json, rateLimit, serialize } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ address: string }> }) {
  const limited = await rateLimit("portfolio", 60);
  if (limited) return limited;
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) return bad("Invalid address");
  try {
    return json(serialize(await getPortfolio(getAddress(address))));
  } catch (e) {
    return bad(`Chain read failed: ${(e as Error).message.slice(0, 200)}`, 502);
  }
}
