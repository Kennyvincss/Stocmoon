import { getAddress, isAddress, parseAbiItem, type Address } from "viem";
import { stocMoonLensAbi } from "@stocmoon/core";
import { listMarkets } from "@/lib/server/markets";
import { chainClient } from "@/lib/server/chain";
import { cached } from "@/lib/server/cache";
import { marketEvents } from "@/lib/server/logs";
import { bad, json, rateLimit, serialize } from "@/lib/server/http";
import { publicEnv } from "@/lib/public-env";

export const dynamic = "force-dynamic";

const TRADE = parseAbiItem(
  "event Trade(uint256 indexed marketId, address indexed trader, bool indexed isYes, bool isBuy, uint256 collateralAmount, uint256 shares, uint256 fee, uint256 poolYes, uint256 poolNo)",
);
/** Net USDC paid / received per (market, side) by `trader`, from onchain Trade events. */
async function flows(trader: Address) {
  const r = await cached(`flows:${trader.toLowerCase()}`, 15_000, async () => {
    const out: Record<string, { paid: string; received: string }> = {};
    for (const l of await marketEvents(TRADE, { trader })) {
      const k = `${l.args.marketId}:${l.args.isYes ? "YES" : "NO"}`;
      const amt = l.args.collateralAmount ?? 0n;
      const cur = out[k] ?? { paid: "0", received: "0" };
      out[k] = {
        paid: (BigInt(cur.paid) + (l.args.isBuy ? amt : 0n)).toString(),
        received: (BigInt(cur.received) + (l.args.isBuy ? 0n : amt)).toString(),
      };
    }
    return out;
  });
  return r.value;
}

/**
 * The wallet's positions in one stock's markets: balances, close-now value (AMM quote, executable now),
 * and USDC paid/received from onchain events. Used by the live P&L card.
 */
export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const limited = await rateLimit("positions", 120);
  if (limited) return limited;
  const { address } = await ctx.params;
  const asset = new URL(req.url).searchParams.get("asset");
  if (!isAddress(address, { strict: false }) || !asset || !isAddress(asset, { strict: false })) return bad("Invalid address");
  if (!publicEnv.lens || !publicEnv.markets) return json({ positions: [] });
  const user = getAddress(address);
  const markets = (await listMarkets({ asset })).filter((m) => m.kind !== "EVENT");
  if (!markets.length) return json({ positions: [] });
  const c = chainClient();
  const ids = markets.map((m) => BigInt(m.id));
  const [yes, no] = (await c.readContract({
    address: publicEnv.lens, abi: stocMoonLensAbi, functionName: "positionsOf", args: [user, ids],
  })) as readonly [readonly bigint[], readonly bigint[], readonly bigint[], readonly bigint[]];
  const held = markets.flatMap((m, i) => {
    const rows = [];
    if ((yes[i] ?? 0n) > 0n) rows.push({ m, isYes: true, shares: yes[i]! });
    if ((no[i] ?? 0n) > 0n) rows.push({ m, isYes: false, shares: no[i]! });
    return rows;
  });
  if (!held.length) return json({ positions: [] });
  const f = await flows(user).catch(() => ({}) as Record<string, { paid: string; received: string }>);
  const positions = await Promise.all(
    held.map(async ({ m, isYes, shares }) => {
      let closeValue: bigint | null = null;
      if (m.phase === "trading") {
        const q = (await c
          .readContract({ address: publicEnv.lens!, abi: stocMoonLensAbi, functionName: "quoteSell", args: [BigInt(m.id), isYes, shares] })
          .catch(() => null)) as readonly [bigint, bigint] | null;
        closeValue = q ? q[0] : null;
      }
      const flow = f[`${m.id}:${isYes ? "YES" : "NO"}`];
      return {
        marketId: m.id, kind: m.kind, phase: m.phase, side: isYes ? "YES" : "NO", shares: shares.toString(),
        openPrice: m.openPriceA, openPriceB: m.openPriceB, closeTime: m.closeTime, tradingEndsAt: m.tradingEndsAt,
        decimals: m.assetMetaA?.decimals ?? null, closeValue: closeValue?.toString() ?? null,
        paid: flow?.paid ?? null, received: flow?.received ?? null,
      };
    }),
  );
  return json(serialize({ positions }));
}
