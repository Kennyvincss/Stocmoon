import { getStocks } from "@/lib/server/stocks";
import { json, rateLimit, serialize } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const limited = await rateLimit("stocks", 120);
  if (limited) return limited;
  return json(serialize(await getStocks()), { maxAge: 30 });
}
