import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import { aggregatorV3Abi, fetchAllTokenizedStocks } from "@stocmoon/core";
import { ROOT, log, optEnv } from "./lib/env";
import { sourceClient } from "./lib/clients";

/**
 * Builds contracts/config/assets.json for deployment:
 *   1. pages through the Base Tokenized Stocks API (token contract addresses, NAV, pause state)
 *   2. matches each configured Chainlink feed (config/feeds.base-mainnet.json) to exactly one API token by symbol
 *   3. verifies each feed onchain on Base mainnet: decimals, description, positive answer, freshness
 * Entries that fail any check are reported and excluded. Nothing is guessed.
 */
interface FeedEntry {
  symbol: string;
  feed: string;
  maxStaleness: number;
}

async function main() {
  const feedsFile = join(ROOT, "contracts/config/feeds.base-mainnet.json");
  const { feeds } = JSON.parse(readFileSync(feedsFile, "utf8")) as { feeds: FeedEntry[] };
  const api = await fetchAllTokenizedStocks({ baseUrl: optEnv("TOKENIZED_STOCKS_API_URL") });
  log("assets-sync", "api fetched", { tokens: api.stocks.length, pages: api.pages, skipped: api.skipped });

  const client = sourceClient();
  const out: { symbol: string; token: Address; feed: Address; decimals: number; maxStaleness: number }[] = [];
  const report: Record<string, unknown>[] = [];

  for (const f of feeds) {
    // Coinbase API tickers carry a lowercase "c" suffix (AAPLc); Chainlink names use the plain ticker.
    const matches = api.stocks.filter((s) => s.symbol.replace(/c$/, "").toUpperCase() === f.symbol.toUpperCase());
    if (matches.length !== 1) {
      report.push({ symbol: f.symbol, ok: false, reason: `${matches.length} API tokens match symbol` });
      continue;
    }
    const token = matches[0]!;
    try {
      const feed = getAddress(f.feed);
      const [decimals, description, latest] = await Promise.all([
        client.readContract({ address: feed, abi: aggregatorV3Abi, functionName: "decimals" }),
        client.readContract({ address: feed, abi: aggregatorV3Abi, functionName: "description" }),
        client.readContract({ address: feed, abi: aggregatorV3Abi, functionName: "latestRoundData" }),
      ]);
      const [, answer, , updatedAt] = latest;
      const age = Math.floor(Date.now() / 1000) - Number(updatedAt);
      const price = Number(answer) / 10 ** decimals;
      const navDiff = token.navPrice ? Math.abs(price / token.navPrice - 1) : null;
      const problems: string[] = [];
      if (answer <= 0n) problems.push("non-positive answer");
      if (!description.toUpperCase().includes(f.symbol.toUpperCase())) problems.push(`description "${description}" does not mention ${f.symbol}`);
      if (navDiff !== null && navDiff > 0.05) problems.push(`feed price ${price} differs from API NAV ${token.navPrice} by ${(navDiff * 100).toFixed(1)}%`);
      if (token.pausedFeatures.length) problems.push(`issuer paused features ${token.pausedFeatures.join(",")}`);
      report.push({ symbol: f.symbol, token: token.address, feed, decimals, description, price, ageSeconds: age, navPrice: token.navPrice, ok: problems.length === 0, problems });
      if (problems.length === 0) out.push({ symbol: f.symbol, token: token.address, feed, decimals, maxStaleness: f.maxStaleness });
    } catch (e) {
      report.push({ symbol: f.symbol, ok: false, reason: `feed read failed: ${(e as Error).message.slice(0, 160)}` });
    }
  }

  console.table(report.map((r) => ({ symbol: r.symbol, ok: r.ok, price: r.price, age: r.ageSeconds, issue: (r.problems as string[] | undefined)?.join("; ") ?? r.reason })));
  if (out.length === 0) {
    log("assets-sync", "no verified assets; assets.json not written");
    process.exit(1);
  }
  const target = join(ROOT, "contracts/config/assets.json");
  writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), assets: out }, null, 2));
  log("assets-sync", "written", { file: target, assets: out.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
