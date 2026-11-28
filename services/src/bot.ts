import { env, log, optEnv, sleep } from "./lib/env";
import { setupRelayer } from "./relayer";
import { setupKeeper } from "./keeper";
import { setupIntraday } from "./operator";

/**
 * StocMoon all-in-one bot (run on an always-on server):  pnpm bot
 *
 * One process, one wallet (OPERATOR_PRIVATE_KEY), strictly sequential — so the three jobs never send transactions
 * at the same time from the same wallet:
 *   - relayer   copies Base mainnet Chainlink rounds into the testnet mirrors (every RELAYER_INTERVAL_MS, 30s)
 *   - keeper    opens/settles 24H/7D markets and recycles their liquidity (every KEEPER_INTERVAL_MS, 60s)
 *   - intraday  publishes Alpaca prices and opens/settles 5m–1H markets during extended hours (its own cadence)
 * Disable a part with BOT_DISABLE=relayer,keeper,intraday. Settings: services/.env.
 */
async function main() {
  const disabled = new Set((optEnv("BOT_DISABLE") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const jobs: { name: string; every: number; tick: () => Promise<void>; last: number }[] = [];
  const add = async (name: string, every: number, setup: () => Promise<{ tick: () => Promise<void> }>) => {
    if (disabled.has(name)) return log("bot", `${name} disabled`);
    try {
      const { tick } = await setup();
      jobs.push({ name, every, tick, last: 0 });
    } catch (e) {
      // a part that cannot start (e.g. missing Alpaca keys) must not stop the others
      log("bot", `${name} not started`, { error: (e as Error).message.slice(0, 200) });
    }
  };
  await add("relayer", Number(env("RELAYER_INTERVAL_MS", "30000")), setupRelayer);
  await add("keeper", Number(env("KEEPER_INTERVAL_MS", "60000")), setupKeeper);
  await add("intraday", 2_000, setupIntraday);
  if (!jobs.length) throw new Error("No jobs could start — check services/.env");
  log("bot", "running", { jobs: jobs.map((j) => j.name) });

  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  while (!stop) {
    for (const j of jobs) {
      if (stop || Date.now() - j.last < j.every) continue;
      j.last = Date.now();
      try {
        await j.tick();
      } catch (e) {
        log("bot", `${j.name} tick failed`, { error: (e as Error).message.slice(0, 200) });
      }
    }
    await sleep(1_000);
  }
  log("bot", "stopped");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
