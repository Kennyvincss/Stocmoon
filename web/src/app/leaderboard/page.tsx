"use client";

import Link from "next/link";
import { useState } from "react";
import { useLeaderboard } from "@/lib/api";
import { fmtUsdc, shortAddr } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, StockLogo } from "@/components/common";
import { cn } from "@/lib/utils";

export default function LeaderboardPage() {
  const [period, setPeriod] = useState("weekly");
  const [sort, setSort] = useState("pnl");
  const q = useLeaderboard(period, sort);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Ranked on <b>realised</b> results from resolved markets only, computed from onchain events. Unrealised P&L never counts.
          {q.data?.rules && ` Minimum ${q.data.rules.minResolvedMarkets} resolved markets and ${fmtUsdc(q.data.rules.minVolume)} volume to rank.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList>
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="all">All-time</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={sort} onValueChange={setSort}>
          <TabsList>
            <TabsTrigger value="pnl">Realised return</TabsTrigger>
            <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {q.isLoading ? <Skeleton className="h-96" /> : !q.data?.available ? (
        <EmptyState title="Leaderboard unavailable" body="The leaderboard is computed from indexed onchain events. This deployment has no indexer database configured." />
      ) : q.data.rows.length === 0 ? (
        <EmptyState title="No ranked traders yet" body="Traders appear once they meet the minimums in resolved markets for this period." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Trader</th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Markets</th>
                <th className="px-4 py-3 text-right font-medium">Accuracy</th>
                <th className="px-4 py-3 text-right font-medium">Realised P&L</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => {
                const pnl = BigInt(r.realizedPnl);
                return (
                  <tr key={r.account} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="tabular px-4 py-3 text-muted">{r.rank}</td>
                    <td className="px-4 py-3">
                      <Link href={`/profile/${r.account}`} className="flex items-center gap-2">
                        <StockLogo src={r.avatarUrl} symbol={r.username ?? r.account.slice(2, 4)} size={28} />
                        <span className="font-medium">{r.username ?? shortAddr(r.account)}</span>
                      </Link>
                    </td>
                    <td className="tabular hidden px-4 py-3 text-right sm:table-cell">{r.resolvedMarkets}</td>
                    <td className="tabular px-4 py-3 text-right">{r.accuracy !== null ? `${Math.round(r.accuracy * 100)}% (${r.correct}/${r.correct + r.incorrect})` : "—"}</td>
                    <td className={cn("tabular px-4 py-3 text-right font-medium", pnl > 0n ? "text-up" : pnl < 0n ? "text-down" : "")}>{fmtUsdc(pnl, { signed: true })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
