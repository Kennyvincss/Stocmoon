import { getMarket } from "@/lib/server/markets";
import { bad, json } from "@/lib/server/http";
import { publicEnv } from "@/lib/public-env";

export const dynamic = "force-dynamic";

/** ERC-1155 metadata for outcome shares. id = marketId*2 (YES) / marketId*2+1 (NO), hex or decimal. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const raw = (await ctx.params).id.replace(/\.json$/, "");
  const tokenId = /^[0-9a-fA-F]{64}$/.test(raw) ? BigInt(`0x${raw}`) : /^\d+$/.test(raw) ? BigInt(raw) : null;
  if (tokenId === null) return bad("Invalid token id");
  const market = await getMarket(Number(tokenId / 2n));
  if (!market) return bad("Unknown market", 404);
  const yes = tokenId % 2n === 0n;
  const a = market.assetMetaA?.symbol ?? "asset";
  const side = market.kind === "UP_DOWN" ? (yes ? "UP" : "DOWN") : market.kind === "BATTLE" ? (yes ? a : market.assetMetaB?.symbol ?? "B") : yes ? "YES" : "NO";
  return json({
    name: `StocMoon #${market.id} ${side}`,
    description: `Outcome share of StocMoon market #${market.id}. Redeems for 1 USDC if ${side} wins, 0.5 USDC on push/invalid. ${publicEnv.chainId !== 8453 ? "Testnet — no monetary value." : ""}`,
    image: `${publicEnv.appUrl}/api/og/market/${market.id}`,
    decimals: 6,
    attributes: [
      { trait_type: "Market", value: market.kind },
      { trait_type: "Side", value: side },
      { trait_type: "Closes", value: new Date(market.closeTime * 1000).toISOString() },
    ],
  }, { maxAge: 300 });
}
