"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { feedToNumber, sideLabels } from "@stocmoon/core";
import type { StockView } from "@/lib/server/stocks";
import type { MarketView } from "@/lib/server/markets";
import { fmtUsd, fmtUsdc, fmtAgo, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Change, Countdown, StockLogo } from "@/components/common";

export function StockCard({ stock, index = 0 }: { stock: StockView; index?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.02 }}>
      <Link href={`/stocks/${stock.address}`}
        className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2">
        <StockLogo src={stock.iconUrl} symbol={stock.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{stock.symbol}</span>
            {stock.tradable ? <Badge tone="up">Live</Badge> : stock.pausedFeatures.length ? <Badge tone="warn">Paused</Badge> : null}
          </div>
          <div className="truncate text-sm text-muted">{stock.name}</div>
        </div>
        <div className="text-right">
          <div className="tabular font-semibold">{fmtUsd(stock.onchain.feedPrice ?? stock.navPrice)}</div>
          <div className="text-xs"><Change value={stock.change24h} /></div>
        </div>
      </Link>
    </motion.div>
  );
}

export function StockRow({ stock }: { stock: StockView }) {
  return (
    <Link href={`/stocks/${stock.address}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2">
      <StockLogo src={stock.iconUrl} symbol={stock.symbol} size={32} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{stock.symbol}</div>
        <div className="truncate text-xs text-muted">{stock.name}</div>
      </div>
      <div className="text-right">
        <div className="tabular text-sm font-medium">{fmtUsd(stock.onchain.feedPrice ?? stock.navPrice)}</div>
        <div className="text-xs"><Change value={stock.change24h} /></div>
      </div>
    </Link>
  );
}

export function PhaseBadge({ market }: { market: MarketView }) {
  switch (market.phase) {
    case "trading":
      return <Badge tone="up">Open · <Countdown to={market.tradingEndsAt} /></Badge>;
    case "awaiting-close":
      return <Badge tone="warn">Closing · <Countdown to={market.closeTime + market.settlementDelay} /></Badge>;
    case "settling":
      return <Badge tone="warn">Awaiting settlement</Badge>;
    case "proposed":
      return <Badge tone="warn">Outcome proposed</Badge>;
    case "expired":
      return <Badge tone="down">Unsettled · can be invalidated</Badge>;
    default:
      return <Badge tone="solid">Resolved · {market.outcome}</Badge>;
  }
}

export function OddsBar({ p, yesLabel, noLabel }: { p: number; yesLabel: string; noLabel: string }) {
  const pct = Math.round(p * 100);
  return (
    <div>
      <div className="flex justify-between text-xs font-medium">
        <span className="text-up">{yesLabel} {pct}%</span>
        <span className="text-down">{100 - pct}% {noLabel}</span>
      </div>
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-down/30">
        <motion.div className="h-full bg-up" initial={{ width: "50%" }} animate={{ width: `${pct}%` }} transition={{ type: "spring", duration: 0.6 }} />
      </div>
    </div>
  );
}

export function MarketCard({ market }: { market: MarketView }) {
  const a = market.assetMetaA;
  const b = market.assetMetaB;
  const labels = sideLabels(market.kind, a?.symbol, b?.symbol);
  const title =
    market.kind === "BATTLE" ? `${a?.symbol ?? "?"} vs ${b?.symbol ?? "?"}` : market.kind === "EVENT" ? market.question ?? `Event #${market.id}` : `${a?.symbol ?? "?"} · UP or DOWN`;
  const entry = market.kind === "UP_DOWN" && a?.decimals != null ? feedToNumber(market.openPriceA, a.decimals) : null;
  return (
    <Link href={`/m/${market.id}`} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex -space-x-2">
            <StockLogo src={a?.iconUrl} symbol={a?.symbol ?? "?"} size={32} className="ring-2 ring-surface" />
            {b && <StockLogo src={b.iconUrl} symbol={b.symbol} size={32} className="ring-2 ring-surface" />}
          </div>
          <div className="min-w-0">
            <div className={cn("truncate font-medium", market.kind === "EVENT" && "text-sm")}>{title}</div>
            <div className="text-xs text-muted">
              #{market.id} · {entry !== null ? `from ${fmtUsd(entry)} · ` : ""}settles {fmtDateTime(market.closeTime)}
            </div>
          </div>
        </div>
        <PhaseBadge market={market} />
      </div>
      <OddsBar p={market.priceYes} yesLabel={labels.yes} noLabel={labels.no} />
      <div className="flex justify-between text-xs text-muted">
        <span>Liquidity {fmtUsdc(market.collateral)}</span>
        <span>Opened {fmtAgo(market.openTime)}</span>
      </div>
    </Link>
  );
}
