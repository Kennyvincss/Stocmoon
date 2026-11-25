import { fetchAllTokenizedStocks } from "@stocmoon/core";
import { env, log, loop, optEnv } from "./lib/env";
import { db } from "./lib/db";

/**
 * Pages through the Base Tokenized Stocks API on an interval and records stock metadata and every new
 * (nav_price, nav_price_updated_at) observation. Failures are recorded in api_sync_runs; nothing is fabricated.
 */
async function main() {
  const sql = db(true)!;
  await loop("snapshotter", Number(env("SNAPSHOT_INTERVAL_MS", "300000")), async () => {
    const started = new Date();
    try {
      const r = await fetchAllTokenizedStocks({ baseUrl: optEnv("TOKENIZED_STOCKS_API_URL") });
      let snaps = 0;
      for (const s of r.stocks) {
        const addr = s.address.toLowerCase();
        await sql`
          insert into stocks (address, symbol, name, description, decimals, icon_url, isin, total_supply, multiplier, nav_price,
            nav_price_updated_at, paused_features, first_mint_date, raw, last_synced_at)
          values (${addr}, ${s.symbol}, ${s.name}, ${s.description}, ${s.decimals}, ${s.iconUrl}, ${s.isin}, ${s.totalSupply}, ${s.multiplier},
            ${s.navPrice}, ${s.navUpdatedAt}, ${s.pausedFeatures}, ${s.firstMintDate}, ${sql.json(JSON.parse(JSON.stringify(s)))}, now())
          on conflict (address) do update set symbol = excluded.symbol, name = excluded.name, description = excluded.description,
            decimals = excluded.decimals, icon_url = excluded.icon_url, isin = excluded.isin, total_supply = excluded.total_supply,
            multiplier = excluded.multiplier, nav_price = excluded.nav_price, nav_price_updated_at = excluded.nav_price_updated_at,
            paused_features = excluded.paused_features, first_mint_date = excluded.first_mint_date, raw = excluded.raw, last_synced_at = now()`;
        if (s.navPrice !== null && s.navUpdatedAt) {
          const res = await sql`insert into price_snapshots (stock_address, source, price, observed_at)
            values (${addr}, 'api_nav', ${s.navPrice}, ${s.navUpdatedAt}) on conflict do nothing`;
          snaps += res.count;
        }
      }
      await sql`insert into api_sync_runs (source, ok, pages, records, skipped, started_at, finished_at)
        values ('tokenized-stocks-api', true, ${r.pages}, ${r.stocks.length}, ${r.skipped}, ${started}, now())`;
      log("snapshotter", "synced", { stocks: r.stocks.length, pages: r.pages, newSnapshots: snaps });
    } catch (e) {
      await sql`insert into api_sync_runs (source, ok, error, started_at, finished_at)
        values ('tokenized-stocks-api', false, ${(e as Error).message.slice(0, 500)}, ${started}, now())`;
      throw e;
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
