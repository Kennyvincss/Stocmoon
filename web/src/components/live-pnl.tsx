"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { stocMoonLensAbi, stocMoonMarketsAbi } from "@stocmoon/core";
import { apiGet } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { fmtShares, fmtUsdc, usdcToNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTx } from "@/hooks/useTx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Countdown, TxStatusLine } from "@/components/common";
import { useConfig as useWagmiConfig } from "wagmi";
import { readContract } from "wagmi/actions";

/** Trade deadline 10 minutes from now (module-level so render stays pure). */
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);

interface Pos {
  marketId: number;
  kind: "UP_DOWN" | "BATTLE";
  phase: string;
  side: "YES" | "NO";
  shares: string;
  openPrice: string;
  closeTime: number;
  tradingEndsAt: number;
  decimals: number | null;
  closeValue: string | null;
  paid: string | null;
  received: string | null;
}

/**
 * Moon-style live P&L for the connected wallet in this stock.
 *  - "Close now" = what the AMM pays right now (executable, from the contract quote).
 *  - "If settled now" = payout if the market settled at the live price (indicative; UP/DOWN markets only).
 * P&L = value + USDC already received − USDC paid, from onchain Trade events.
 */
export function LivePnl({ asset, livePrice }: { asset: string; livePrice: number | null }) {
  const { address } = useAccount();
  const wagmi = useWagmiConfig();
  const tx = useTx();
  const [closing, setClosing] = useState(false);
  const q = useQuery({
    queryKey: ["positions", address?.toLowerCase(), asset.toLowerCase()],
    queryFn: () => apiGet<{ positions: Pos[] }>(`/api/positions/${address}?asset=${asset}`),
    enabled: Boolean(address),
    refetchInterval: 5_000,
  });
  if (!address) return null;
  const positions = q.data?.positions ?? [];

  const rows = positions.map((p) => {
    const shares = BigInt(p.shares);
    const entry = p.decimals !== null ? Number(BigInt(p.openPrice)) / 10 ** p.decimals : null;
    let settleNow: bigint | null = null;
    if (p.kind === "UP_DOWN" && livePrice !== null && entry !== null) {
      const upWins = livePrice > entry;
      const tie = livePrice === entry;
      settleNow = tie ? shares / 2n : (p.side === "YES") === upWins ? shares : 0n;
    }
    const close = p.closeValue !== null ? BigInt(p.closeValue) : null;
    const paid = p.paid !== null ? BigInt(p.paid) : null;
    const received = p.received !== null ? BigInt(p.received) : 0n;
    const pnl = close !== null && paid !== null ? close + received - paid : null;
    const pnlIfSettled = settleNow !== null && paid !== null ? settleNow + received - paid : null;
    return { p, entry, settleNow, close, paid, pnl, pnlIfSettled };
  });
  const total = rows.reduce<bigint | null>((acc, r) => (r.pnl === null ? acc : (acc ?? 0n) + r.pnl), null);
  const totalSettled = rows.reduce<bigint | null>((acc, r) => (r.pnlIfSettled === null ? acc : (acc ?? 0n) + r.pnlIfSettled), null);
  const closable = rows.filter((r) => r.p.phase === "trading" && r.close !== null && r.close > 0n);

  async function closeAll() {
    if (!publicEnv.markets || !publicEnv.lens) return;
    setClosing(true);
    for (const r of closable) {
      const id = BigInt(r.p.marketId);
      const isYes = r.p.side === "YES";
      const shares = BigInt(r.p.shares);
      // fresh quote right before each sell; 1% slippage protection
      const [out] = (await readContract(wagmi, { address: publicEnv.lens, abi: stocMoonLensAbi, functionName: "quoteSell", args: [id, isYes, shares] })) as readonly [bigint, bigint];
      const ok = await tx.send({
        address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "sell",
        args: [id, isYes, shares, (out * 99n) / 100n, deadline()],
      });
      if (!ok) break;
    }
    setClosing(false);
    await q.refetch();
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted">Open Profit/Loss</div>
            <div className={cn("tabular text-2xl font-semibold", total !== null && total > 0n && "text-up", total !== null && total < 0n && "text-down")}>
              {total === null ? (q.isLoading ? "…" : fmtUsdc(0n)) : fmtUsdc(total, { signed: true })}
            </div>
            {totalSettled !== null && (
              <div className="text-xs text-muted">
                If settled at the live price: <span className={cn("tabular", totalSettled >= 0n ? "text-up" : "text-down")}>{fmtUsdc(totalSettled, { signed: true })}</span>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" disabled={!closable.length || closing || tx.busy} onClick={closeAll}>
            {closing ? "Closing…" : "Close all"}
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No open positions in this stock.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {rows.map((r) => {
              const up = r.p.side === "YES";
              const label = r.p.kind === "UP_DOWN" ? (up ? "UP" : "DOWN") : up ? "A" : "B";
              return (
                <li key={`${r.p.marketId}-${r.p.side}`} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", up ? "bg-up-soft text-up" : "bg-down-soft text-down")}>{label}</span>
                      <Link href={`/m/${r.p.marketId}`} className="text-muted hover:text-text">#{r.p.marketId}</Link>
                      <span className="tabular text-xs text-muted">{fmtShares(r.p.shares)} sh</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.p.phase === "trading" ? <>closes in <Countdown to={r.p.closeTime} /></> : "awaiting settlement"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("tabular font-medium", r.pnl !== null && r.pnl > 0n && "text-up", r.pnl !== null && r.pnl < 0n && "text-down")}>
                      {r.pnl !== null ? fmtUsdc(r.pnl, { signed: true }) : "—"}
                    </div>
                    <div className="tabular text-xs text-muted">
                      close now {r.close !== null ? `$${usdcToNumber(r.close).toFixed(2)}` : "—"}
                      {r.settleNow !== null && ` · settle $${usdcToNumber(r.settleNow).toFixed(2)}`}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <TxStatusLine tx={tx} labels={{ success: "Position closed onchain." }} />
      </CardContent>
    </Card>
  );
}
