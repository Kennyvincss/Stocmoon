import type { Address, PublicClient } from "viem";
import { aggregatorV3Abi, getRound, mirrorAggregatorAbi, oracleAdapterAbi } from "@stocmoon/core";
import { deployment, env, log, loop, privateKey } from "./lib/env";
import { appClient, sourceClient, walletFor } from "./lib/clients";
import { db } from "./lib/db";

/**
 * TESTNET relayer: copies Base mainnet Chainlink tokenized-equity rounds into each MirrorAggregator on Base Sepolia.
 * Rounds are pushed in order with their original round id, answer and timestamps; the mirror enforces monotonicity.
 * Also logs observed source update intervals, which inform which market durations are safe to enable.
 */
const MAX_PER_TICK = Number(env("RELAYER_MAX_ROUNDS_PER_TICK", "25"));
const AGG_MASK = (1n << 64n) - 1n;

interface Mirror {
  asset: Address;
  mirror: Address;
  source: Address;
}

async function discoverMirrors(client: PublicClient, oracle: Address): Promise<Mirror[]> {
  const count = await client.readContract({ address: oracle, abi: oracleAdapterAbi, functionName: "assetCount" });
  const out: Mirror[] = [];
  for (let i = 0n; i < count; i++) {
    const asset = await client.readContract({ address: oracle, abi: oracleAdapterAbi, functionName: "assetAt", args: [i] });
    const info = await client.readContract({ address: oracle, abi: oracleAdapterAbi, functionName: "getAsset", args: [asset] });
    const source = await client.readContract({ address: info.feed, abi: mirrorAggregatorAbi, functionName: "sourceFeed" }).catch(() => null);
    // intraday feeds (Alpaca, written by the operator) have no mainnet source: skip them here
    if (source && !/^0x0{40}$/i.test(source)) out.push({ asset, mirror: info.feed, source });
  }
  return out;
}

const lastSeen = new Map<string, bigint>();

async function main() {
  const d = deployment();
  const app = appClient();
  const src = sourceClient();
  const wallet = walletFor(privateKey("RELAYER_PRIVATE_KEY"));
  const mirrors = await discoverMirrors(app, d.oracleAdapter);
  log("relayer", "mirrors", { count: mirrors.length, relayer: wallet.account.address });

  await loop("relayer", Number(env("RELAYER_INTERVAL_MS", "20000")), async () => {
    for (const m of mirrors) {
      const [lastSource, latest] = await Promise.all([
        app.readContract({ address: m.mirror, abi: mirrorAggregatorAbi, functionName: "lastSourceRoundId" }),
        src.readContract({ address: m.source, abi: aggregatorV3Abi, functionName: "latestRoundData" }),
      ]);
      const [latestId, , , latestUpdatedAt] = latest;
      if (latestId <= lastSource) continue;

      const prev = lastSeen.get(m.source);
      if (prev !== undefined && latestUpdatedAt > prev) {
        log("relayer", "source update interval", { source: m.source, seconds: Number(latestUpdatedAt - prev) });
      }
      lastSeen.set(m.source, latestUpdatedAt);

      // Rounds to push: everything after lastSource in the same phase (capped), else just the latest.
      const ids: bigint[] = [];
      const samePhase = lastSource >> 64n === latestId >> 64n && lastSource !== 0n;
      if (samePhase) {
        const from = (lastSource & AGG_MASK) + 1n;
        const to = latestId & AGG_MASK;
        const start = to - from + 1n > BigInt(MAX_PER_TICK) ? to - BigInt(MAX_PER_TICK) + 1n : from;
        if (start > from) log("relayer", "gap larger than cap, skipping older rounds", { mirror: m.mirror, skipped: Number(start - from) });
        for (let a = start; a <= to; a++) ids.push(((latestId >> 64n) << 64n) | a);
      } else {
        ids.push(latestId);
      }

      for (const id of ids) {
        const r = await getRound(src, m.source, id);
        if (!r || r.answer <= 0n) continue;
        const hash = await wallet.writeContract({
          address: m.mirror, abi: mirrorAggregatorAbi, functionName: "pushRound",
          args: [r.roundId, r.answer, r.updatedAt, r.updatedAt], chain: wallet.chain, account: wallet.account,
        });
        const receipt = await app.waitForTransactionReceipt({ hash });
        log("relayer", "pushed", { mirror: m.mirror, sourceRound: r.roundId, answer: r.answer, updatedAt: r.updatedAt, tx: hash, status: receipt.status });
        const sql = db();
        if (sql && receipt.status === "success") {
          await sql`insert into relayed_rounds (chain_id, mirror, source_feed, source_round_id, answer, updated_at_src, tx_hash)
            values (${d.chainId}, ${m.mirror.toLowerCase()}, ${m.source.toLowerCase()}, ${r.roundId.toString()}, ${r.answer.toString()},
              to_timestamp(${Number(r.updatedAt)}), ${hash}) on conflict do nothing`;
        }
      }
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
