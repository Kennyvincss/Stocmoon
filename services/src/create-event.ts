import { parseArgs } from "node:util";
import { getAddress, zeroAddress } from "viem";
import { stocMoonMarketsAbi } from "@stocmoon/core";
import { deployment, log, privateKey } from "./lib/env";
import { appClient, walletFor } from "./lib/clients";

/**
 * Admin CLI: create an EVENT (earnings) market. Requires MARKET_CREATOR_ROLE (KEEPER_PRIVATE_KEY by default).
 * The question and rules URI are written onchain and cannot be changed. Write questions against a named, public,
 * verifiable source (company earnings release / SEC filing) — never against StocMoon's own estimates.
 *
 *   pnpm --filter services create-event --question "Will NVIDIA report Q4 FY2027 revenue above $X as stated in its
 *     Q4 earnings press release?" --rules https://... --company 0xTOKEN --trading-ends 2027-02-20T20:00:00Z
 *     --resolves 2027-02-26T22:00:00Z --liquidity 50
 */
async function main() {
  const { values } = parseArgs({
    options: {
      question: { type: "string" },
      rules: { type: "string" },
      company: { type: "string" },
      "trading-ends": { type: "string" },
      resolves: { type: "string" },
      liquidity: { type: "string", default: "50" },
    },
  });
  if (!values.question || !values.rules || !values["trading-ends"] || !values.resolves) {
    throw new Error("--question, --rules, --trading-ends and --resolves are required");
  }
  if (!/^https:\/\/|^ipfs:\/\//.test(values.rules)) throw new Error("--rules must be an https:// or ipfs:// URI");
  const tradingEnds = BigInt(Math.floor(Date.parse(values["trading-ends"]) / 1000));
  const resolves = BigInt(Math.floor(Date.parse(values.resolves) / 1000));
  const liquidity = BigInt(Math.round(Number(values.liquidity) * 1e6));
  const d = deployment();
  const client = appClient();
  const wallet = walletFor(privateKey("KEEPER_PRIVATE_KEY"));
  const { request } = await client.simulateContract({
    address: d.markets, abi: stocMoonMarketsAbi, functionName: "createEventMarket", account: wallet.account,
    args: [values.company ? getAddress(values.company) : zeroAddress, values.question, values.rules, tradingEnds, resolves, liquidity],
  });
  const hash = await wallet.writeContract(request);
  const r = await client.waitForTransactionReceipt({ hash });
  log("create-event", "created", { tx: hash, status: r.status });
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
