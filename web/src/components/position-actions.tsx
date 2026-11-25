"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { payoutFor, sideLabels, stocMoonLensAbi, stocMoonMarketsAbi } from "@stocmoon/core";
import type { MarketView } from "@/lib/server/markets";
import { apiGet } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { fmtDuration, fmtShares, fmtUsdc } from "@/lib/format";
import { useTx } from "@/hooks/useTx";
import { Button } from "@/components/ui/button";
import { Notice, TxStatusLine } from "@/components/common";
import { useNow } from "@/hooks/useNow";

interface Proof {
  roundA: string;
  nextRoundA: string;
  roundB: string;
  nextRoundB: string;
  stale: boolean;
}

/** Close / settle / claim / withdraw actions for the connected wallet in one market. */
export function PositionActions({ market }: { market: MarketView }) {
  const { address } = useAccount();
  const tx = useTx();
  const nowMs = useNow(5_000);
  const [proofError, setProofError] = useState<string | null>(null);
  const id = BigInt(market.id);
  const labels = sideLabels(market.kind, market.assetMetaA?.symbol, market.assetMetaB?.symbol);
  const pos = useReadContracts({
    contracts: address && publicEnv.markets ? [
      { address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "balanceOf", args: [address, id * 2n] },
      { address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "balanceOf", args: [address, id * 2n + 1n] },
      { address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "lpShares", args: [id, address] },
      { address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "pendingLpFees", args: [id, address] },
    ] : [],
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });
  const yes = (pos.data?.[0]?.result as bigint | undefined) ?? 0n;
  const no = (pos.data?.[1]?.result as bigint | undefined) ?? 0n;
  const lp = (pos.data?.[2]?.result as bigint | undefined) ?? 0n;
  const fees = (pos.data?.[3]?.result as bigint | undefined) ?? 0n;

  const sellYes = useReadContract({
    address: publicEnv.lens, abi: stocMoonLensAbi, functionName: "quoteSell", args: [id, true, yes],
    query: { enabled: yes > 0n && market.phase === "trading" },
  });
  const sellNo = useReadContract({
    address: publicEnv.lens, abi: stocMoonLensAbi, functionName: "quoteSell", args: [id, false, no],
    query: { enabled: no > 0n && market.phase === "trading" },
  });

  const m = publicEnv.markets!;
  const done = async () => {
    await pos.refetch();
  };

  async function sell(isYes: boolean) {
    const shares = isYes ? yes : no;
    const q = (isYes ? sellYes.data : sellNo.data) as readonly [bigint, bigint] | undefined;
    if (!q) return;
    const minOut = (q[0] * 99n) / 100n;
    await tx.send({ address: m, abi: stocMoonMarketsAbi, functionName: "sell", args: [id, isYes, shares, minOut, BigInt(Math.floor(Date.now() / 1000) + 600)] });
    await done();
  }

  async function settle() {
    setProofError(null);
    try {
      const { proof } = await apiGet<{ proof: Proof }>(`/api/markets/${market.id}/proof`);
      if (proof.stale) {
        setProofError("The reference price at close is older than this market's staleness limit, so the contract will refuse it. If no fresh price appears, the market becomes INVALID (0.50 per share) after the resolution window.");
        return;
      }
      await tx.send({
        address: m, abi: stocMoonMarketsAbi, functionName: "resolve",
        args: [id, BigInt(proof.roundA), BigInt(proof.nextRoundA), BigInt(proof.roundB), BigInt(proof.nextRoundB)],
      });
    } catch (e) {
      setProofError((e as Error).message);
    }
  }

  const now = Math.floor(nowMs / 1000);
  const hasShares = yes > 0n || no > 0n;
  const payout = payoutFor(market.outcome, yes, no);

  if (!address) return <p className="text-sm text-muted">Connect a wallet to see and manage your position.</p>;
  return (
    <div className="space-y-3">
      {!hasShares && lp === 0n && fees === 0n && !["settling", "expired", "proposed"].includes(market.phase) && (
        <p className="text-sm text-muted">You have no position in this market.</p>
      )}
      {(hasShares || lp > 0n) && (
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <div><div className="text-xs text-muted">{labels.yes} shares</div><div className="tabular font-medium">{fmtShares(yes)}</div></div>
          <div><div className="text-xs text-muted">{labels.no} shares</div><div className="tabular font-medium">{fmtShares(no)}</div></div>
          <div><div className="text-xs text-muted">LP shares</div><div className="tabular font-medium">{fmtShares(lp)}</div></div>
        </div>
      )}

      {market.phase === "trading" && hasShares && (
        <div className="grid gap-2 sm:grid-cols-2">
          {yes > 0n && (
            <Button variant="outline" disabled={tx.busy || !sellYes.data} onClick={() => sell(true)}>
              Close {labels.yes} · {sellYes.data ? fmtUsdc((sellYes.data as readonly [bigint, bigint])[0]) : "…"}
            </Button>
          )}
          {no > 0n && (
            <Button variant="outline" disabled={tx.busy || !sellNo.data} onClick={() => sell(false)}>
              Close {labels.no} · {sellNo.data ? fmtUsdc((sellNo.data as readonly [bigint, bigint])[0]) : "…"}
            </Button>
          )}
        </div>
      )}
      {market.phase === "awaiting-close" && hasShares && (
        <Notice tone="neutral">
          Trading has closed. Positions can&apos;t be closed early from here on; settlement opens in {fmtDuration(market.closeTime + market.settlementDelay - now)}.
        </Notice>
      )}
      {market.phase === "settling" && market.kind !== "EVENT" && (
        <Button className="w-full" disabled={tx.busy} onClick={settle}>Settle market (anyone can)</Button>
      )}
      {market.phase === "expired" && (
        <Button variant="outline" className="w-full" disabled={tx.busy}
          onClick={() => tx.send({ address: m, abi: stocMoonMarketsAbi, functionName: "resolveInvalid", args: [id] })}>
          Mark INVALID (no valid price within the resolution window)
        </Button>
      )}
      {market.phase === "proposed" && now >= market.proposedAt + market.disputeWindow && (
        <Button className="w-full" disabled={tx.busy}
          onClick={() => tx.send({ address: m, abi: stocMoonMarketsAbi, functionName: "finalizeOutcome", args: [id] })}>
          Finalize proposed outcome
        </Button>
      )}
      {market.phase === "resolved" && hasShares && (
        <Button variant={payout > 0n ? "up" : "outline"} className="w-full" disabled={tx.busy}
          onClick={async () => { await tx.send({ address: m, abi: stocMoonMarketsAbi, functionName: "redeem", args: [id] }); await done(); }}>
          {payout > 0n ? `Claim ${fmtUsdc(payout)}` : "Clear losing position (0 USDC)"}
        </Button>
      )}
      {lp > 0n && (
        <Button variant="outline" className="w-full" disabled={tx.busy}
          onClick={async () => { await tx.send({ address: m, abi: stocMoonMarketsAbi, functionName: "removeLiquidity", args: [id, lp, 0n] }); await done(); }}>
          Withdraw liquidity{fees > 0n ? ` + ${fmtUsdc(fees)} fees` : ""}
        </Button>
      )}
      {lp === 0n && fees > 0n && (
        <Button variant="outline" className="w-full" disabled={tx.busy}
          onClick={() => tx.send({ address: m, abi: stocMoonMarketsAbi, functionName: "claimLpFees", args: [id] })}>
          Claim {fmtUsdc(fees)} LP fees
        </Button>
      )}
      {proofError && <Notice tone="down">{proofError}</Notice>}
      <TxStatusLine tx={tx} />
    </div>
  );
}
