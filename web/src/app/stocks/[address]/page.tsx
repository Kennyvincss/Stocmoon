"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { explorerAddress, sessionAt, SESSION_LABELS, PAUSE_FEATURE_LABELS } from "@stocmoon/core";
import { useStock } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { useNow } from "@/hooks/useNow";
import { fmtAgo, fmtUsd } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Change, EmptyState, StaleBanner, Stat, StockLogo } from "@/components/common";
import { LiveChart, useLivePrice } from "@/components/live-chart";
import { LivePnl } from "@/components/live-pnl";
import { StockTradePanel } from "@/components/stock-trade-panel";
import { MarketCard } from "@/components/cards";

export default function StockPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const q = useStock(address);
  const live = useLivePrice(address);
  const now = useNow(60_000);

  if (q.isLoading) {
    return <div className="grid gap-6 lg:grid-cols-[1fr_380px]"><Skeleton className="h-[480px]" /><Skeleton className="h-[560px]" /></div>;
  }
  if (q.isError || !q.data) {
    return <EmptyState title="Stock not found" body={(q.error as Error | null)?.message ?? "This contract address is not in the Tokenized Stocks API."}
      action={<Link href="/markets" className="text-sm underline">Back to markets</Link>} />;
  }
  const { stock, meta, markets } = q.data;
  const price = stock.onchain.feedPrice ?? stock.navPrice;
  const priceTime = stock.onchain.feedUpdatedAt ? stock.onchain.feedUpdatedAt : stock.navUpdatedAt;
  const session = sessionAt(now);
  const others = markets.filter((m) => m.kind !== "UP_DOWN" || m.phase !== "trading");
  const openUpDown = markets.find((m) => m.kind === "UP_DOWN" && m.phase === "trading");
  const busiest = markets.filter((m) => m.kind === "UP_DOWN" && m.phase === "trading").sort((a, b) => Number(BigInt(b.collateral) - BigInt(a.collateral)))[0];
  const sentiment = busiest ? { up: busiest.priceYes, label: "market odds" } : null;
  const entry = openUpDown && stock.onchain.decimals != null ? Number(BigInt(openUpDown.openPriceA)) / 10 ** stock.onchain.decimals : null;

  return (
    <div className="space-y-5">
      <Link href="/markets" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="h-4 w-4" /> Markets</Link>
      <StaleBanner source={meta.source} fetchedAt={meta.fetchedAt} error={meta.error} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6 lg:col-start-1">
          <div className="flex items-start gap-4">
            <StockLogo src={stock.iconUrl} symbol={stock.symbol} size={64} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{stock.name}</h1>
                <Badge>{stock.symbol}</Badge>
                {stock.tradable ? <Badge tone="up">Tradable</Badge> : <Badge tone="warn">Not tradable</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span>Settlement reference <b className="tabular text-text">{fmtUsd(price)}</b></span>
                <Change value={stock.change24h} />
                <span>24h · updated {fmtAgo(priceTime ?? null)} · {SESSION_LABELS[session]}</span>
              </div>
            </div>
          </div>

          <Card><CardContent><LiveChart address={stock.address} entry={entry} sentiment={sentiment} /></CardContent></Card>
        </div>

        {/* on mobile the trade panel follows the chart; on desktop it is a sticky right column */}
        <div className="lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="space-y-4">
            <LivePnl asset={stock.address} livePrice={live.data?.price ?? null} />
            <StockTradePanel stock={stock} markets={markets} />
          </div>
        </div>

        <div className="space-y-6 lg:col-start-1">

          <Card>
            <CardHeader><CardTitle>About this token</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {stock.description && <p className="text-sm leading-relaxed">{stock.description}</p>}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label="API NAV" value={fmtUsd(stock.navPrice)} sub={stock.navUpdatedAt ? fmtAgo(stock.navUpdatedAt) : "not published"} />
                <Stat label="Multiplier" value={stock.multiplier ?? "—"} sub="tokens → shares" />
                <Stat label="Total supply" value={stock.totalSupply?.toLocaleString() ?? "—"} sub={stock.shareEquivalentSupply !== null ? `≈ ${stock.shareEquivalentSupply.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares` : undefined} />
                <Stat label="Decimals" value={stock.decimals ?? "—"} />
                <Stat label="ISIN" value={stock.isin ?? "—"} />
                <Stat label="First minted" value={stock.firstMintDate ? new Date(stock.firstMintDate).toLocaleDateString() : "—"} />
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <a href={explorerAddress(8453, stock.address) ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-text">
                  Token contract (Base) <ExternalLink className="h-3 w-3" />
                </a>
                {stock.onchain.feed && (
                  <a href={explorerAddress(publicEnv.chainId, stock.onchain.feed) ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-text">
                    Settlement feed <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {stock.pausedFeatures.length > 0 && (
                <p className="text-xs text-warn">Issuer-paused features: {stock.pausedFeatures.map((f) => PAUSE_FEATURE_LABELS[f] ?? f).join(", ")} (raw codes {stock.pausedFeatures.join(", ")}).</p>
              )}
              <p className="text-xs leading-relaxed text-muted">
                The NAV/reference price is a Chainlink-computed value (underlying price × multiplier). It is not a bid, ask or
                execution price. Holding a tokenized stock does not by itself confer shareholder rights such as voting. StocMoon
                markets don&apos;t require holding the token — they settle in USDC on the reference price.
              </p>
            </CardContent>
          </Card>

          {others.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Other {stock.symbol} markets</h2>
              <div className="grid gap-3 sm:grid-cols-2">{others.slice(0, 8).map((m) => <MarketCard key={m.id} market={m} />)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
