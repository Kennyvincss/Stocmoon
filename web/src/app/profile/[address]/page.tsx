"use client";

import { use } from "react";
import { isAddress } from "viem";
import { useUser, usePortfolio } from "@/lib/api";
import { fmtUsdc, shortAddr } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Stat, StockLogo } from "@/components/common";
import { MarketCard } from "@/components/cards";
import { ShareButton } from "@/components/share";

export default function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const valid = isAddress(address, { strict: false });
  const user = useUser(valid ? address : undefined);
  const portfolio = usePortfolio(valid ? address : undefined);
  if (!valid) return <EmptyState title="Invalid address" />;
  const s = user.data?.stats;
  const recent = (portfolio.data?.positions ?? []).slice(0, 6);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <StockLogo src={user.data?.profile?.avatarUrl} symbol={user.data?.profile?.username ?? address.slice(2, 4)} size={56} />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{user.data?.profile?.username ?? shortAddr(address)}</h1>
          <div className="font-mono text-xs text-muted">{address}</div>
        </div>
      </div>
      {user.isLoading ? <Skeleton className="h-28" /> : !user.data?.available ? (
        <EmptyState title="Stats unavailable" body="Verified stats are computed by the indexer, which isn't configured on this deployment." />
      ) : (
        <Card><CardContent className="grid grid-cols-2 gap-5 sm:grid-cols-5">
          <Stat label="Markets" value={s?.markets ?? 0} />
          <Stat label="Correct" value={s?.correct ?? 0} />
          <Stat label="Incorrect" value={s?.incorrect ?? 0} />
          <Stat label="Accuracy" value={s?.accuracy != null ? `${Math.round(s.accuracy * 100)}%` : "—"} sub="resolved, excl. push/invalid" />
          <Stat label="Realised P&L" value={s ? fmtUsdc(s.realizedPnl, { signed: true }) : "—"} sub="resolved markets" />
        </CardContent></Card>
      )}
      <Card>
        <CardHeader><CardTitle>Recent markets</CardTitle></CardHeader>
        <CardContent>
          {recent.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
            <div className="grid gap-3 sm:grid-cols-2">{recent.map((p) => <div key={p.market.id} className="space-y-2"><MarketCard market={p.market} /><ShareButton marketId={p.market.id} className="w-full" /></div>)}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
