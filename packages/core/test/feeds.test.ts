import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { findSettlementProof, PhaseBoundaryError } from "../src/feeds";
import { payoutFor } from "../src/markets";

const PHASE = 3n << 64n;

function client(rounds: Array<[bigint, bigint]>): PublicClient {
  const map = new Map(rounds.map(([agg, ts]) => [PHASE | agg, ts]));
  const latest = rounds[rounds.length - 1]!;
  return {
    readContract: async ({ functionName, args }: { functionName: string; args?: [bigint] }) => {
      if (functionName === "latestRoundData") return [PHASE | latest[0], 100n, 0n, latest[1], 0n];
      const ts = map.get(args![0]);
      if (ts === undefined) throw new Error("No data present");
      return [args![0], 100n + (args![0] & 0xffn), 0n, ts, 0n];
    },
  } as unknown as PublicClient;
}

describe("findSettlementProof", () => {
  const rounds: Array<[bigint, bigint]> = Array.from({ length: 50 }, (_, i) => [BigInt(i + 1), BigInt(1000 + i * 10)]);

  it("returns latest round with nextRoundId 0 when it precedes the target", async () => {
    const p = await findSettlementProof(client(rounds), "0x0000000000000000000000000000000000000001", 5000n);
    expect(p.roundId).toBe(PHASE | 50n);
    expect(p.nextRoundId).toBe(0n);
  });

  it("binary-searches the round in effect at target", async () => {
    const p = await findSettlementProof(client(rounds), "0x0000000000000000000000000000000000000001", 1105n);
    // round 11 updated at 1100, round 12 at 1110
    expect(p.roundId).toBe(PHASE | 11n);
    expect(p.nextRoundId).toBe(PHASE | 12n);
    expect(p.updatedAt).toBe(1100n);
  });

  it("exact timestamp match uses that round", async () => {
    const p = await findSettlementProof(client(rounds), "0x0000000000000000000000000000000000000001", 1110n);
    expect(p.roundId).toBe(PHASE | 12n);
  });

  it("flags targets before the current phase", async () => {
    await expect(findSettlementProof(client(rounds), "0x0000000000000000000000000000000000000001", 10n)).rejects.toBeInstanceOf(
      PhaseBoundaryError,
    );
  });
});

describe("payoutFor mirrors the contract", () => {
  it("pays winners, halves on push/invalid", () => {
    expect(payoutFor("YES", 10n, 4n)).toBe(10n);
    expect(payoutFor("NO", 10n, 4n)).toBe(4n);
    expect(payoutFor("PUSH", 10n, 5n)).toBe(7n);
    expect(payoutFor("INVALID", 3n, 0n)).toBe(1n);
    expect(payoutFor("NONE", 3n, 3n)).toBe(0n);
  });
});
