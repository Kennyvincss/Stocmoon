"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { erc20Abi } from "viem";
import { DURATION_LABELS, stocMoonMarketsAbi } from "@stocmoon/core";
import { useConfig, useMarkets, useStocks } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { fmtUsdc } from "@/lib/format";
import { useTx } from "@/hooks/useTx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketCard } from "@/components/cards";
import { EmptyState, TxStatusLine } from "@/components/common";
import { EligibilityGate, useTradingAccess } from "@/components/eligibility";

const BATTLE_DURATIONS = [86_400, 604_800, 2_592_000];

export default function BattlesPage() {
  const q = useMarkets({ kind: "BATTLE" });
  const [tab, setTab] = useState("live");
  const list = (q.data?.markets ?? []).filter((m) => (tab === "live" ? m.phase === "trading" : tab === "settling" ? ["awaiting-close", "settling", "expired"].includes(m.phase) : m.phase === "resolved"));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stock Battles</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Two stocks, one winner: the one with the higher <b>percentage</b> return, (close − open) / open, by the deadline.
          Settled onchain on both stocks&apos; Chainlink reference prices. Equal returns = push.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="live">Live</TabsTrigger>
              <TabsTrigger value="settling">Settling</TabsTrigger>
              <TabsTrigger value="resolved">Results</TabsTrigger>
            </TabsList>
          </Tabs>
          {q.isLoading ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-36" />)}</div>
            : list.length ? <div className="grid gap-3 sm:grid-cols-2">{list.map((m) => <MarketCard key={m.id} market={m} />)}</div>
              : <EmptyState title={tab === "live" ? "No live battles" : "Nothing here yet"} body={tab === "live" ? "Start one with the form, or check back when the keeper opens the next round." : undefined} />}
        </div>
        <CreateBattle />
      </div>
    </div>
  );
}

function CreateBattle() {
  const cfg = useConfig();
  const stocks = useStocks();
  const { address, isConnected } = useAccount();
  const access = useTradingAccess();
  const tradable = useMemo(() => (stocks.data?.stocks ?? []).filter((s) => s.tradable), [stocks.data]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const durations = (cfg.data?.durations ?? []).filter((d) => d.enabled && BATTLE_DURATIONS.includes(d.duration));
  const [duration, setDuration] = useState<number | null>(null);
  const d = duration ?? durations[0]?.duration ?? null;
  const min = BigInt(cfg.data?.minInitialLiquidity ?? "0");
  const tx = useTx();
  const approveTx = useTx();
  const allowance = useReadContract({
    address: publicEnv.usdc, abi: erc20Abi, functionName: "allowance", args: address && publicEnv.markets ? [address, publicEnv.markets] : undefined,
    query: { enabled: Boolean(address) },
  });

  if (!cfg.data?.configured) return null;
  if (!cfg.data.openCreation) {
    return (
      <Card><CardContent className="text-sm text-muted">Battles are opened by the StocMoon keeper on this deployment (open creation is disabled).</CardContent></Card>
    );
  }
  const select = "h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm";
  const valid = a && b && a !== b && d;
  return (
    <Card className="self-start">
      <CardHeader><CardTitle>Start a battle</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <select className={select} value={a} onChange={(e) => setA(e.target.value)} aria-label="First stock">
          <option value="">First stock</option>
          {tradable.map((s) => <option key={s.address} value={s.address}>{s.symbol} — {s.name}</option>)}
        </select>
        <select className={select} value={b} onChange={(e) => setB(e.target.value)} aria-label="Second stock">
          <option value="">Second stock</option>
          {tradable.filter((s) => s.address !== a).map((s) => <option key={s.address} value={s.address}>{s.symbol} — {s.name}</option>)}
        </select>
        <div className="flex gap-1.5">
          {durations.map((x) => (
            <button key={x.duration} onClick={() => setDuration(x.duration)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${d === x.duration ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"}`}>
              {DURATION_LABELS[x.duration]}
            </button>
          ))}
          {durations.length === 0 && <span className="text-xs text-muted">No battle durations enabled.</span>}
        </div>
        <p className="text-xs text-muted">You seed {fmtUsdc(min)} of liquidity (withdrawable anytime) and earn LP fees.</p>
        {tradable.length < 2 && <p className="text-xs text-warn">At least two tradable stocks are needed.</p>}
        {!isConnected ? null : !access.canTrade ? <EligibilityGate compact /> : (allowance.data ?? 0n) < min ? (
          <Button className="w-full" disabled={approveTx.busy} onClick={async () => {
            await approveTx.send({ address: publicEnv.usdc!, abi: erc20Abi, functionName: "approve", args: [publicEnv.markets!, min] });
            await allowance.refetch();
          }}>Approve {fmtUsdc(min)}</Button>
        ) : (
          <Button className="w-full" disabled={!valid || tx.busy}
            onClick={() => tx.send({ address: publicEnv.markets!, abi: stocMoonMarketsAbi, functionName: "createBattleMarket", args: [a as `0x${string}`, b as `0x${string}`, d!, min] })}>
            Create battle
          </Button>
        )}
        <TxStatusLine tx={approveTx} />
        <TxStatusLine tx={tx} labels={{ success: "Battle created onchain." }} />
      </CardContent>
    </Card>
  );
}
