"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useMarkets, useStocks } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketCard, StockRow } from "@/components/cards";
import { EmptyState, StaleBanner } from "@/components/common";
import { sessionAt, SESSION_LABELS } from "@stocmoon/core";

const STEPS = [
  { n: "1", t: "Pick a stock", d: "Real Coinbase tokenized stocks on Base, with Chainlink reference prices." },
  { n: "2", t: "Call UP or DOWN", d: "Choose an amount and a duration. Shares are priced by an onchain AMM." },
  { n: "3", t: "Settle & claim", d: "At close the contract reads the reference price. Winning shares pay 1 USDC." },
];

export default function Home() {
  const stocks = useStocks();
  const markets = useMarkets({ phase: "trading" });
  const live = stocks.data?.stocks.filter((s) => s.tradable) ?? [];
  const movers = [...(stocks.data?.stocks ?? [])].filter((s) => s.change24h !== null).sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!)).slice(0, 6);
  const session = sessionAt(Date.now());

  return (
    <div className="space-y-10">
      <section className="grid items-end gap-6 pt-2 md:grid-cols-[1.4fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
            Stocks, <span className="text-up">up</span> or <span className="text-down">down</span>.
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted md:text-lg">
            Prediction markets on tokenized stocks. Pick a side, pick a duration, settle onchain against Chainlink reference
            prices. USDC in, USDC out — on Base.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/markets">Explore markets <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/how-it-works">How settlement works</Link></Button>
          </div>
        </motion.div>
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${session === "closed" ? "bg-warn" : "bg-up"}`} />
              <span className="text-muted">{SESSION_LABELS[session]}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="tabular text-2xl font-semibold">{stocks.data ? stocks.data.stocks.length : "—"}</div><div className="text-xs text-muted">Tokenized stocks</div></div>
              <div><div className="tabular text-2xl font-semibold">{stocks.data ? live.length : "—"}</div><div className="text-xs text-muted">Tradable now</div></div>
              <div><div className="tabular text-2xl font-semibold">{markets.data ? markets.data.markets.length : "—"}</div><div className="text-xs text-muted">Open markets</div></div>
            </div>
          </CardContent>
        </Card>
      </section>

      {stocks.data && <StaleBanner source={stocks.data.source} fetchedAt={stocks.data.fetchedAt} error={stocks.data.error} />}

      <section className="grid gap-3 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold">{s.n}</div>
            <div className="mt-3 font-medium">{s.t}</div>
            <div className="mt-1 text-sm text-muted">{s.d}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Open markets</h2>
            <Link href="/markets" className="text-sm text-muted hover:text-text">All stocks</Link>
          </div>
          {markets.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
          ) : markets.data?.markets.length ? (
            <div className="grid gap-3 sm:grid-cols-2">{markets.data.markets.slice(0, 6).map((m) => <MarketCard key={m.id} market={m} />)}</div>
          ) : (
            <EmptyState title="No open markets right now"
              body={markets.data?.error ? "Market contracts are not reachable on this deployment." : "Markets open automatically while the reference feeds are live (Sun 8pm – Fri 8pm ET)."} />
          )}
        </div>
        <Card>
          <CardHeader><CardTitle>Biggest 24h moves</CardTitle></CardHeader>
          <CardContent className="pt-2">
            {stocks.isLoading ? <Skeleton className="h-64" /> : movers.length ? movers.map((s) => <StockRow key={s.address} stock={s} />) : (
              <p className="py-6 text-center text-sm text-muted">24h changes appear once enough verified reference-price history has been recorded.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
