import { db } from "@/lib/server/db";
import { chainClient } from "@/lib/server/chain";
import { contractsConfigured, publicEnv } from "@/lib/public-env";

export const dynamic = "force-dynamic";

export async function GET() {
  const [block, database] = await Promise.all([
    chainClient().getBlockNumber().then((b) => b.toString()).catch((e: Error) => `error: ${e.message.slice(0, 80)}`),
    db() ? db()!`select 1`.then(() => "ok").catch(() => "error") : Promise.resolve("not configured"),
  ]);
  return Response.json({ chainId: publicEnv.chainId, contractsConfigured, block, database });
}
