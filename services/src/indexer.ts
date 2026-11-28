import { syncIndex } from "@stocmoon/core";
import { deployment, env, log, loop } from "./lib/env";
import { appClient } from "./lib/clients";
import { db } from "./lib/db";

/**
 * Event indexer (long-running). The same logic also runs on demand inside the web app (see web/src/lib/server/sync.ts).
 * Indexes up to `latest - INDEXER_CONFIRMATIONS` to avoid reorged data; idempotent.
 */
async function main() {
  const d = deployment();
  const client = appClient();
  const sql = db(true)!;
  await loop("indexer", Number(env("INDEXER_INTERVAL_MS", "5000")), async () => {
    const r = await syncIndex(sql, client, {
      chainId: d.chainId, markets: d.markets, deployBlock: BigInt(d.deployBlock),
      confirmations: BigInt(env("INDEXER_CONFIRMATIONS", "3")), logsApi: process.env.LOGS_API_URL,
    });
    if (r.events) log("indexer", "indexed", { from: r.from, to: r.to, events: r.events });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
