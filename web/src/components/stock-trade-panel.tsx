"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { erc20Abi } from "viem";
import { DURATION_LABELS, nextSessionOpen, isFeedSessionOpen, stocMoonMarketsAbi } from "@stocmoon/core";
import type { StockView } from "@/lib/server/stocks";
import type { MarketView } from "@/lib/server/markets";
import { useConfig } from "@/lib/api";
import { contractsConfigured, publicEnv } from "@/lib/public-env";
import { fmtDateTime, fmtUsdc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTx } from "@/hooks/useTx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice, TxStatusLine } from "@/components/common";
import { MarketTrade } from "@/components/market-trade";
import { useTradingAccess, EligibilityGate } from "@/components/eligibility";
import { useNow } from "@/hooks/useNow";

export function StockTradePanel({ stock, markets }: { stock: StockView; markets: MarketView[] }) {
  const cfg = useConfig();
  const enabled = useMemo(() => (cfg.data?.durations ?? []).filter((d) => d.enabled), [cfg.data]);
  const [duration, setDuration] = useState<number | null>(null);
  const selected = duration ?? enabled.find((d) => markets.some((m) => m.kind === "UP_DOWN" && m.phase === "trading" && m.duration === d.duration))?.duration ?? enabled[0]?.duration ?? null;

  const market = useMemo(
    () => markets.filter((m) => m.kind === "UP_DOWN" && m.phase === "trading" && m.duration === selected).sort((a, b) => b.tradingEndsAt - a.tradingEndsAt)[0],
    [markets, selected],
  );

  if (!contractsConfigured) {
    return (
      <Card><CardContent className="space-y-3">
        <div className="font-medium">Trading not configured</div>
        <p className="text-sm text-muted">This deployment has no StocMoon market contracts configured (NEXT_PUBLIC_MARKETS_ADDRESS etc.). Stock data above is live; trading is disabled rather than simulated.</p>
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 text-xs text-muted">Market duration</div>
          {cfg.isLoading ? <Skeleton className="h-9 w-full" /> : (
            <div className="flex flex-wrap gap-1.5">
              {(cfg.data?.durations ?? []).map((d) => {
                const hasMarket = markets.some((m) => m.kind === "UP_DOWN" && m.phase === "trading" && m.duration === d.duration);
                return (
                  <button key={d.duration} disabled={!d.enabled} onClick={() => setDuration(d.duration)}
                    title={d.enabled ? undefined : "Not enabled: the reference feed's update frequency doesn't support this duration reliably"}
                    className={cn("relative rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                      selected === d.duration ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-text")}>
                    {DURATION_LABELS[d.duration] ?? `${d.duration}s`}
                    {hasMarket && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-up" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!stock.tradable ? (
          <Notice>
            <div className="font-medium">Not tradable right now</div>
            <ul className="mt-1 list-disc pl-4 text-xs">{stock.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </Notice>
        ) : market ? (
          <MarketTrade market={market} currentPrice={market.currentPriceA ?? stock.onchain.feedPrice ?? null} />
        ) : selected ? (
          <NoMarket stock={stock} duration={selected} openCreation={cfg.data?.openCreation ?? false} minLiquidity={cfg.data?.minInitialLiquidity ?? "0"} />
        ) : (
          <Notice tone="neutral">No market durations are enabled on this deployment.</Notice>
        )}
      </CardContent>
    </Card>
  );
}

function NoMarket({ stock, duration, openCreation, minLiquidity }: { stock: StockView; duration: number; openCreation: boolean; minLiquidity: string }) {
  const { address, isConnected } = useAccount();
  const access = useTradingAccess();
  const tx = useTx();
  const approveTx = useTx();
  const min = BigInt(minLiquidity);
  const allowance = useReadContract({
    address: publicEnv.usdc, abi: erc20Abi, functionName: "allowance", args: address && publicEnv.markets ? [address, publicEnv.markets] : undefined,
    query: { enabled: Boolean(address) },
  });
  const now = useNow(30_000);
  const closeOk = isFeedSessionOpen(now) && isFeedSessionOpen(now + duration * 1000);
  const next = nextSessionOpen(now);
  const label = DURATION_LABELS[duration] ?? `${duration}s`;

  if (!openCreation) {
    return (
      <Notice tone="neutral">
        No {label} {stock.symbol} market is open right now. New markets are opened automatically while the reference feed is
        live{!isFeedSessionOpen(now) && next ? ` — next feed session starts ${fmtDateTime(Math.floor(next / 1000))}` : ""}.
      </Notice>
    );
  }
  return (
    <div className="space-y-3">
      <Notice tone="neutral">
        No {label} market is open for {stock.symbol}. You can open one: you provide {fmtUsdc(min)} of liquidity, earn the LP
        share of trading fees, and can withdraw your share at any time.
        {!closeOk && " Warning: this market would close while the feed is closed and would likely resolve as INVALID."}
      </Notice>
      {!isConnected ? null : !access.canTrade ? <EligibilityGate compact /> : (allowance.data ?? 0n) < min ? (
        <Button className="w-full" disabled={approveTx.busy} onClick={async () => {
          await approveTx.send({ address: publicEnv.usdc!, abi: erc20Abi, functionName: "approve", args: [publicEnv.markets!, min] });
          await allowance.refetch();
        }}>Approve {fmtUsdc(min)}</Button>
      ) : (
        <Button className="w-full" disabled={tx.busy || !closeOk} onClick={() =>
          tx.send({ address: publicEnv.markets!, abi: stocMoonMarketsAbi, functionName: "createUpDownMarket", args: [stock.address, duration, min] })}>
          Open {label} market
        </Button>
      )}
      <TxStatusLine tx={approveTx} />
      <TxStatusLine tx={tx} labels={{ success: "Market created onchain." }} />
    </div>
  );
}
