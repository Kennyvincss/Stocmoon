"use client";

import { useMarkets } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketCard } from "@/components/cards";
import { EmptyState, Notice } from "@/components/common";

export default function EarningsPage() {
  const q = useMarkets({ kind: "EVENT" });
  const markets = q.data?.markets ?? [];
  const live = markets.filter((m) => m.phase === "trading");
  const rest = markets.filter((m) => m.phase !== "trading");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Earnings</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          YES/NO questions about company results, e.g. whether quarterly revenue exceeds a figure published in a named source.
          Unlike UP/DOWN markets these don&apos;t settle on a price feed.
        </p>
      </div>
      <Notice tone="neutral">
        Earnings markets are resolved by the StocMoon resolver against the public source written into each market&apos;s rules
        (company earnings release or SEC filing), followed by a dispute window. Questions and rules are fixed onchain at
        creation. StocMoon never publishes its own estimates.
      </Notice>
      {q.isLoading ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-36" />)}</div> : markets.length === 0 ? (
        <EmptyState title="No earnings markets yet" body="Each earnings market is created with a verifiable resolution source. New ones appear here ahead of earnings season." />
      ) : (
        <>
          {live.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{live.map((m) => <MarketCard key={m.id} market={m} />)}</div>}
          {rest.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Closed & resolved</h2>
              <div className="grid gap-3 sm:grid-cols-2">{rest.map((m) => <MarketCard key={m.id} market={m} />)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
