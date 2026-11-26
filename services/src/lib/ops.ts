import type { Address, PublicClient } from "viem";
import { normalizeMarket, stocMoonLensAbi, stocMoonMarketsAbi, type MarketData, type RawMarket } from "@stocmoon/core";
import { log } from "./env";

export type Send = (fn: string, args: readonly unknown[]) => Promise<boolean>;

/** Newest `limit` markets via the lens. */
export async function listMarkets(client: PublicClient, lens: Address, markets: Address, limit = 300): Promise<MarketData[]> {
  const count = Number(await client.readContract({ address: markets, abi: stocMoonMarketsAbi, functionName: "marketCount" }));
  const out: MarketData[] = [];
  for (let offset = 0; offset < Math.min(count, limit); offset += 100) {
    const page = (await client.readContract({
      address: lens, abi: stocMoonLensAbi, functionName: "listMarkets", args: [BigInt(offset), 100n],
    })) as readonly { id: bigint; market: RawMarket; priceYes: bigint; yesSupply: bigint; noSupply: bigint }[];
    for (const v of page) out.push(normalizeMarket(v.id, v.market, v));
  }
  return out;
}

/** Withdraws `me`'s LP position from resolved markets so its USDC can seed new markets. */
export async function recycleLiquidity(client: PublicClient, marketsAddr: Address, me: Address, markets: MarketData[], send: Send) {
  for (const m of markets.filter((x) => x.status === "RESOLVED")) {
    const lp = await client.readContract({ address: marketsAddr, abi: stocMoonMarketsAbi, functionName: "lpShares", args: [BigInt(m.id), me] });
    if (lp > 0n) {
      await send("removeLiquidity", [BigInt(m.id), lp, 0n]).catch((e) =>
        log("ops", "recycle failed", { id: m.id, error: (e as Error).message.slice(0, 160) }),
      );
    }
  }
}
