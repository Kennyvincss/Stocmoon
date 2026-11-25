import type { Address, PublicClient } from "viem";
import { aggregatorV3Abi } from "./abi/aggregator";

const AGG_MASK = (1n << 64n) - 1n;

export interface FeedRound {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
}

export interface SettlementProof extends FeedRound {
  /** Immediate successor with updatedAt > target, or 0n when `roundId` is the latest round. */
  nextRoundId: bigint;
}

export class PhaseBoundaryError extends Error {
  constructor() {
    super("Target precedes the current feed phase; resolve manually with the previous phase's rounds.");
  }
}

export async function latestRound(client: PublicClient, feed: Address): Promise<FeedRound> {
  const [roundId, answer, , updatedAt] = await client.readContract({
    address: feed,
    abi: aggregatorV3Abi,
    functionName: "latestRoundData",
  });
  return { roundId, answer, updatedAt };
}

export async function getRound(client: PublicClient, feed: Address, roundId: bigint): Promise<FeedRound | null> {
  try {
    const [id, answer, , updatedAt] = await client.readContract({
      address: feed,
      abi: aggregatorV3Abi,
      functionName: "getRoundData",
      args: [roundId],
    });
    if (updatedAt === 0n) return null;
    return { roundId: id, answer, updatedAt };
  } catch {
    return null;
  }
}

/**
 * Finds the round in effect at `target` (unix seconds) — the proof `OracleAdapter.priceAt` verifies.
 * Uses binary search within the current phase (updatedAt is monotonic in round order).
 */
export async function findSettlementProof(client: PublicClient, feed: Address, target: bigint): Promise<SettlementProof> {
  const latest = await latestRound(client, feed);
  if (latest.updatedAt <= target) return { ...latest, nextRoundId: 0n };

  const phase = latest.roundId >> 64n;
  const base = phase << 64n;
  let lo = 1n;
  let hi = latest.roundId & AGG_MASK;
  const first = await getRound(client, feed, base | lo);
  if (!first || first.updatedAt > target) throw new PhaseBoundaryError();

  let best = first;
  // invariant: round(lo).updatedAt <= target < round(hi).updatedAt
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const r = await getRound(client, feed, base | mid);
    if (!r) throw new Error(`Missing round ${base | mid}`);
    if (r.updatedAt <= target) {
      lo = mid;
      best = r;
    } else {
      hi = mid;
    }
  }
  return { ...best, nextRoundId: base | (lo + 1n) };
}

/** Last `count` rounds, oldest first (multicall). Missing rounds are skipped. */
export async function recentRounds(client: PublicClient, feed: Address, count: number): Promise<FeedRound[]> {
  const latest = await latestRound(client, feed);
  const phase = latest.roundId >> 64n;
  const agg = latest.roundId & AGG_MASK;
  const ids: bigint[] = [];
  for (let i = 0n; i < BigInt(count) && agg - i >= 1n; i++) ids.push((phase << 64n) | (agg - i));
  const results = await client.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: feed,
      abi: aggregatorV3Abi,
      functionName: "getRoundData" as const,
      args: [id] as const,
    })),
  });
  const out: FeedRound[] = [];
  results.forEach((r, i) => {
    if (r.status !== "success") return;
    const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
    if (updatedAt > 0n && answer > 0n) out.push({ roundId: ids[i]!, answer, updatedAt });
  });
  return out.reverse();
}
