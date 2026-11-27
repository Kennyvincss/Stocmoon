"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  DURATION_LABELS, DEFAULT_INTRADAY_HOURS, formatEt, intradayWindowEnd, isIntradayDuration, isIntradayOpen, nextIntradayOpen,
  sessionAt, sideLabels,
} from "@stocmoon/core";
import { useMarkets } from "@/lib/api";
import { useNow } from "@/hooks/useNow";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/common";
import type { MarketView } from "@/lib/server/markets";

const label = (d: number) => DURATION_LABELS[d] ?? `${Math.round(d / 60)}m`;
const sym = (s?: string) => (s ?? "?").replace(/c$/, "");

/**
 * Scrolling news-style ticker: US market status, which durations are live, and every open market with its odds and
 * time to close. All data comes from the chain (via /api/markets) and the trading calendar.
 */
export function MarketTicker() {
  const now = useNow(1_000);
  const q = useMarkets({ phase: "trading" });
  const markets = useMemo(
    () => [...(q.data?.markets ?? [])].sort((a, b) => a.tradingEndsAt - b.tradingEndsAt).slice(0, 40),
    [q.data],
  );

  // session info only needs minute resolution
  const minute = Math.floor(now / 60_000);
  const session = useMemo(() => {
    const t = minute * 60_000;
    const open = isIntradayOpen(t, DEFAULT_INTRADAY_HOURS);
    const name = sessionAt(t);
    return {
      open,
      label: name === "pre-market" ? "PRE-MARKET" : name === "post-market" ? "AFTER-HOURS" : "US MARKET OPEN",
      end: open ? intradayWindowEnd(t, DEFAULT_INTRADAY_HOURS) : null,
      next: open ? null : nextIntradayOpen(t, DEFAULT_INTRADAY_HOURS),
    };
  }, [minute]);

  const intraday = new Map<number, number>();
  const long = new Map<number, number>();
  for (const m of markets) {
    const bucket = isIntradayDuration(m.duration) ? intraday : long;
    bucket.set(m.duration, (bucket.get(m.duration) ?? 0) + 1);
  }
  const fmtBucket = (b: Map<number, number>) =>
    [...b.entries()].sort((a, c) => a[0] - c[0]).map(([d, n]) => `${label(d)} · ${n} ${n === 1 ? "stock" : "stocks"}`).join("   ");

  const items: React.ReactNode[] = [];
  items.push(
    session.open ? (
      <span key="status" className="font-semibold text-up">
        ● {session.label} — short markets for actively trading stocks until {session.end ? formatEt(session.end).replace(/^\w+ /, "") : "the close"}
      </span>
    ) : (
      <span key="status" className="font-semibold text-warn">
        ● US MARKET CLOSED — 5m–1H markets reopen {session.next ? `${formatEt(session.next)} (in ${fmtDuration(Math.max(0, (session.next - now) / 1000))})` : "next trading day"}
      </span>
    ),
  );
  if (intraday.size) items.push(<span key="intra">Live now: {fmtBucket(intraday)}</span>);
  if (long.size) items.push(<span key="long">Open around the clock: {fmtBucket(long)}</span>);
  for (const m of markets) items.push(<TickerMarket key={m.id} m={m} now={now} />);
  if (!q.isLoading && markets.length === 0) items.push(<span key="none">No markets open right now</span>);

  const row = (
    <div className="flex shrink-0 items-center gap-8 pr-8">
      {items.map((it, i) => (
        <span key={i} className="flex shrink-0 items-center gap-8">
          {it}
          <span className="text-border">|</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="group relative overflow-hidden border-b border-border bg-surface text-xs" aria-label="Live market ticker">
      <div
        className="flex w-max py-2 motion-safe:animate-[ticker_var(--ticker-speed)_linear_infinite] group-hover:[animation-play-state:paused]"
        style={{ ["--ticker-speed" as string]: `${Math.max(30, items.length * 6)}s` }}
      >
        {row}
        <div aria-hidden className="flex">{row}</div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface" />
    </div>
  );
}

function TickerMarket({ m, now }: { m: MarketView; now: number }) {
  const a = m.assetMetaA;
  const b = m.assetMetaB;
  const labels = sideLabels(m.kind, sym(a?.symbol), sym(b?.symbol));
  const pct = Math.round(m.priceYes * 100);
  const name = m.kind === "BATTLE" ? `${sym(a?.symbol)} vs ${sym(b?.symbol)}` : m.kind === "EVENT" ? "Earnings" : sym(a?.symbol);
  const left = Math.max(0, m.tradingEndsAt - Math.floor(now / 1000));
  return (
    <Link href={`/m/${m.id}`} className="flex shrink-0 items-center gap-2 hover:text-text">
      <StockLogo src={a?.iconUrl} symbol={a?.symbol ?? "?"} size={18} />
      <span className="font-semibold text-text">{name}</span>
      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">{label(m.duration)}</span>
      <span className={cn("tabular font-medium", pct >= 50 ? "text-up" : "text-down")}>
        {pct >= 50 ? `${labels.yes} ${pct}%` : `${labels.no} ${100 - pct}%`}
      </span>
      <span className="tabular text-muted">closes in {fmtDuration(left)}</span>
    </Link>
  );
}
