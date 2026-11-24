"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { explorerAddress, feedToNumber, sideLabels } from "@stocmoon/core";
import { useMarket } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { fmtDateTime, fmtDuration, fmtUsd, fmtUsdc, shortAddr } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Stat, StockLogo, TxLink } from "@/components/common";
import { OddsBar, PhaseBadge } from "@/components/cards";
import { MarketTrade } from "@/components/market-trade";
import { PositionActions } from "@/components/position-actions";
import { ShareButton } from "@/components/share";

export function MarketDetail({ id }: { id: number }) {
  const q = useMarket(id);
  if (q.isLoading) return <div className="grid gap-6 lg:grid-cols-[1fr_380px]"><Skeleton className="h-96" /><Skeleton className="h-[520px]" /></div>;
  if (!q.data) return <EmptyState title="Market not found" body={(q.error as Error | null)?.message} action={<Link href="/markets" className="text-sm underline">Back</Link>} />;
  const { market: m, activity, participants } = q.data;
  const a = m.assetMetaA;
  const b = m.assetMetaB;
  const labels = sideLabels(m.kind, a?.symbol, b?.symbol);
  const dA = a?.decimals ?? null;
  const dB = b?.decimals ?? null;
  const px = (raw: string, d: number | null) => (d === null || raw === "0" ? "—" : fmtUsd(feedToNumber(raw, d)));
  const ret = (o: string, c: string) => (o === "0" || c === "0" ? null : Number(BigInt(c)) / Number(BigInt(o)) - 1);
  const title = m.kind === "BATTLE" ? `${a?.symbol} vs ${b?.symbol}` : m.kind === "EVENT" ? (m.question ?? `Event market #${m.id}`) : `${a?.symbol} · UP or DOWN`;
  const question =
    m.kind === "UP_DOWN" ? `Will ${a?.symbol}'s reference price be higher than ${px(m.openPriceA, dA)} at ${fmtDateTime(m.closeTime)}?`
      : m.kind === "BATTLE" ? `Which stock has the higher percentage return from open to ${fmtDateTime(m.closeTime)}?`
        : m.question;

  return (
    <div className="space-y-5">
      <Link href={a && m.kind !== "EVENT" ? `/stocks/${a.address}` : m.kind === "EVENT" ? "/earnings" : "/battles"} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <div className="flex -space-x-3">
              <StockLogo src={a?.iconUrl} symbol={a?.symbol ?? "?"} size={48} className="ring-2 ring-bg" />
              {b && <StockLogo src={b.iconUrl} symbol={b.symbol} size={48} className="ring-2 ring-bg" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><PhaseBadge market={m} /></div>
              <p className="mt-1 text-sm text-muted">{question}</p>
            </div>
            <ShareButton marketId={m.id} />
          </div>

          <Card><CardContent className="space-y-5">
            <OddsBar p={m.priceYes} yesLabel={labels.yes} noLabel={labels.no} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {m.kind !== "EVENT" && <Stat label={`${a?.symbol} open`} value={px(m.openPriceA, dA)} />}
              {m.kind !== "EVENT" && <Stat label={`${a?.symbol} close`} value={px(m.closePriceA, dA)}
                sub={m.kind === "BATTLE" && ret(m.openPriceA, m.closePriceA) !== null ? `${(ret(m.openPriceA, m.closePriceA)! * 100).toFixed(2)}%` : undefined} />}
              {m.kind === "BATTLE" && <Stat label={`${b?.symbol} open`} value={px(m.openPriceB, dB)} />}
              {m.kind === "BATTLE" && <Stat label={`${b?.symbol} close`} value={px(m.closePriceB, dB)}
                sub={ret(m.openPriceB, m.closePriceB) !== null ? `${(ret(m.openPriceB, m.closePriceB)! * 100).toFixed(2)}%` : undefined} />}
              <Stat label="Total locked" value={fmtUsdc(m.collateral)} />
              <Stat label="Pool depth" value={`${fmtUsdc(m.poolYes)} / ${fmtUsdc(m.poolNo)}`} sub={`${labels.yes} / ${labels.no} shares in AMM`} />
              <Stat label="Participants" value={participants ?? "—"} sub={participants === null ? "needs indexer" : undefined} />
              <Stat label="Outcome" value={m.outcome === "NONE" ? "Pending" : m.outcome === "YES" ? labels.yes : m.outcome === "NO" ? labels.no : m.outcome} />
            </div>
          </CardContent></Card>

          <Card>
            <CardHeader><CardTitle>Settlement rules (fixed at creation)</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed">
              {m.kind === "EVENT" ? (
                <>
                  <p>Resolved by the StocMoon resolver after {fmtDateTime(m.closeTime)} using the source in the rules document, followed by a {fmtDuration(m.disputeWindow)} dispute window during which the guardian can reject a wrong proposal. Undisputed proposals are finalized by anyone.</p>
                  {m.rulesURI && <a className="inline-flex items-center gap-1 underline" href={m.rulesURI} target="_blank" rel="noreferrer">Resolution rules & source <ExternalLink className="h-3 w-3" /></a>}
                </>
              ) : (
                <ol className="list-decimal space-y-1.5 pl-5">
                  <li>Reference price: Chainlink tokenized-equity feed ({m.kind === "BATTLE" ? "both assets" : a?.symbol}), price per token including the issuer multiplier.</li>
                  <li>Opening price recorded onchain at creation ({fmtDateTime(m.openTime)}).</li>
                  <li>Closing price = the feed round in effect at {fmtDateTime(m.closeTime)}, proved by round ids and verified by the contract. It must be no older than {fmtDuration(m.maxStaleness)}.</li>
                  {m.kind === "UP_DOWN"
                    ? <li>UP wins if close &gt; open, DOWN wins if close &lt; open. Equal prices = <b>push</b>: every share redeems 0.50 USDC.</li>
                    : <li>{a?.symbol} wins if its % return (close − open) / open is higher; equal returns = push (0.50 per share).</li>}
                  <li>Trading stops at {fmtDateTime(m.tradingEndsAt)}. Settlement opens {fmtDuration(m.settlementDelay)} after close and anyone can trigger it.</li>
                  <li>If no valid price can be proved within {fmtDuration(m.resolutionWindow)} of close (stale feed, corporate-action pause, weekend), the market becomes <b>INVALID</b>: every share redeems 0.50 USDC.</li>
                  <li>Fees: {(m.lpFeeBps / 100).toFixed(2)}% to liquidity providers + {(m.protocolFeeBps / 100).toFixed(2)}% protocol, on buys and sells.</li>
                </ol>
              )}
              <div className="flex flex-wrap gap-3 text-xs text-muted">
                {m.feedA && !/^0x0+$/.test(m.feedA) && <a className="underline" target="_blank" rel="noreferrer" href={explorerAddress(publicEnv.chainId, m.feedA) ?? "#"}>Feed A {shortAddr(m.feedA)}</a>}
                {m.kind === "BATTLE" && <a className="underline" target="_blank" rel="noreferrer" href={explorerAddress(publicEnv.chainId, m.feedB) ?? "#"}>Feed B {shortAddr(m.feedB)}</a>}
                {publicEnv.markets && <a className="underline" target="_blank" rel="noreferrer" href={explorerAddress(publicEnv.chainId, publicEnv.markets) ?? "#"}>Market contract</a>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent>
              {activity.length === 0 ? <p className="text-sm text-muted">{participants === null ? "Activity history needs the indexer (DATABASE_URL)." : "No activity yet."}</p> : (
                <ul className="divide-y divide-border text-sm">
                  {activity.map((e) => (
                    <li key={`${e.tx_hash}-${e.event_name}-${e.account}`} className="flex items-center justify-between gap-3 py-2">
                      <span><span className="font-medium">{e.event_name}</span> <span className="text-muted">{e.account ? shortAddr(e.account) : ""}</span></span>
                      <TxLink hash={e.tx_hash} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {m.phase === "trading" && <Card><CardContent><MarketTrade market={m} /></CardContent></Card>}
          <Card><CardHeader><CardTitle>Your position</CardTitle></CardHeader><CardContent><PositionActions market={m} /></CardContent></Card>
        </div>
      </div>
    </div>
  );
}
