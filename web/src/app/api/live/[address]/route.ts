import { isAddress } from "viem";
import { getStock } from "@/lib/server/stocks";
import { liveQuote, pythConfigured } from "@/lib/server/live";
import { bad, json, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Live price for the chart and P&L (display only — markets settle on the Chainlink reference price).
 * Token price = underlying live share price × the token's current multiplier (from the Tokenized Stocks API).
 * Falls back to the Chainlink reference price when no live source is configured or the source fails.
 */
export async function GET(_: Request, ctx: { params: Promise<{ address: string }> }) {
  const limited = await rateLimit("live", 240);
  if (limited) return limited;
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) return bad("Invalid token address");
  const { stock } = await getStock(address);
  if (!stock) return bad("Unknown token", 404);
  const ticker = stock.symbol.replace(/c$/, "").toUpperCase();
  const reference = {
    price: stock.onchain.feedPrice ?? stock.navPrice,
    time: stock.onchain.feedUpdatedAt ?? (stock.navUpdatedAt ? Math.floor(Date.parse(stock.navUpdatedAt) / 1000) : null),
  };
  const q = await liveQuote(ticker).catch(() => null);
  if (q) {
    const multiplier = stock.multiplier ?? 1;
    return json({
      source: "pyth",
      session: q.session,
      symbol: q.symbol,
      price: q.price * multiplier,
      sharePrice: q.price,
      multiplier,
      time: q.publishTime,
      reference,
    });
  }
  return json({ source: "reference", liveConfigured: pythConfigured(), price: reference.price, time: reference.time, reference });
}
