"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { erc20Abi } from "viem";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { feedToNumber, sideLabels, stocMoonLensAbi, stocMoonMarketsAbi } from "@stocmoon/core";
import type { MarketView } from "@/lib/server/markets";
import { publicEnv } from "@/lib/public-env";
import { useTx } from "@/hooks/useTx";
import { fmtUsd, fmtUsdc, parseUsdcInput, usdcToNumber, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Countdown, TxStatusLine } from "@/components/common";
import { EligibilityGate, useTradingAccess } from "@/components/eligibility";
import { ShareButton } from "@/components/share";

const PRESETS = ["5", "10", "25", "100"];
const SLIPPAGE_BPS = 100n; // 1%

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export interface MarketTradeProps {
  market: MarketView;
  /** Current reference price of asset A (display only). */
  currentPrice?: number | null;
  defaultSide?: "yes" | "no";
}

/** Buy UP/DOWN (or A/B, YES/NO) shares in one market. All numbers shown come from the contracts. */
export function MarketTrade({ market, currentPrice, defaultSide = "yes" }: MarketTradeProps) {
  const { address, isConnected } = useAccount();
  const access = useTradingAccess();
  const [side, setSide] = useState<"yes" | "no">(defaultSide);
  const [amount, setAmount] = useState("10");
  const units = parseUsdcInput(amount);
  const debounced = useDebounced(units, 250);
  const isYes = side === "yes";
  const labels = sideLabels(market.kind, market.assetMetaA?.symbol, market.assetMetaB?.symbol);
  const tx = useTx();
  const approveTx = useTx();

  const quote = useReadContract({
    address: publicEnv.lens, abi: stocMoonLensAbi, functionName: "quoteBuy",
    args: debounced && debounced > 0n ? [BigInt(market.id), isYes, debounced] : undefined,
    query: { enabled: Boolean(publicEnv.lens && debounced && debounced > 0n), refetchInterval: 8_000 },
  });
  const account = useReadContracts({
    contracts: address && publicEnv.usdc && publicEnv.markets ? [
      { address: publicEnv.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] },
      { address: publicEnv.usdc, abi: erc20Abi, functionName: "allowance", args: [address, publicEnv.markets] },
    ] : [],
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });
  const balance = account.data?.[0]?.result as bigint | undefined;
  const allowance = account.data?.[1]?.result as bigint | undefined;

  const [shares, fee] = (quote.data as readonly [bigint, bigint, bigint] | undefined) ?? [0n, 0n, 0n];
  const quoteMatchesInput = debounced === units;
  const avg = shares > 0n && units ? usdcToNumber(units) / usdcToNumber(shares) : null;
  const pYes = market.priceYes;
  const pSide = isYes ? pYes : 1 - pYes;
  const decimalsA = market.assetMetaA?.decimals ?? null;
  const entry = market.kind !== "EVENT" && decimalsA !== null ? feedToNumber(market.openPriceA, decimalsA) : null;

  const tradingOpen = market.phase === "trading";
  const insufficient = units !== null && balance !== undefined && units > balance;
  const needsApproval = units !== null && allowance !== undefined && units > allowance;

  const disabledReason = useMemo(() => {
    if (!tradingOpen) return "Trading has closed for this market";
    if (!units || units <= 0n) return "Enter an amount";
    if (units < 1_000n) return "Minimum 0.001 USDC";
    if (insufficient) return "Insufficient USDC balance";
    if (!quoteMatchesInput || quote.isLoading) return "Fetching quote…";
    if (shares === 0n) return "No liquidity for this trade";
    return null;
  }, [tradingOpen, units, insufficient, quoteMatchesInput, quote.isLoading, shares]);

  async function approve() {
    if (!publicEnv.usdc || !publicEnv.markets || !units) return;
    await approveTx.send({ address: publicEnv.usdc, abi: erc20Abi, functionName: "approve", args: [publicEnv.markets, units] });
    await account.refetch();
  }

  async function buy() {
    if (!publicEnv.markets || !units) return;
    const minOut = (shares * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    await tx.send({
      address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "buy",
      args: [BigInt(market.id), isYes, units, minOut, deadline],
    });
    await account.refetch();
  }

  return (
    <div className="space-y-4">
      {/* side selector */}
      <div className="grid grid-cols-2 gap-2">
        {(["yes", "no"] as const).map((s) => {
          const active = side === s;
          const p = s === "yes" ? pYes : 1 - pYes;
          const isUpSide = s === "yes";
          return (
            <button key={s} onClick={() => setSide(s)}
              className={cn("relative flex flex-col items-start gap-1 rounded-2xl border px-4 py-4 text-left transition-colors",
                active ? (isUpSide ? "border-up bg-up-soft" : "border-down bg-down-soft") : "border-border hover:bg-surface-2")}>
              <span className={cn("flex items-center gap-1 text-lg font-semibold", isUpSide ? "text-up" : "text-down")}>
                {market.kind === "UP_DOWN" && (isUpSide ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />)}
                {s === "yes" ? labels.yes : labels.no}
              </span>
              <span className="tabular text-xs text-muted">{Math.round(p * 100)}% implied · {fmtUsd(p)}/share</span>
            </button>
          );
        })}
      </div>

      {/* amount */}
      <div className="rounded-2xl bg-surface-2 p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Amount</span>
          <button className="tabular hover:text-text" disabled={balance === undefined}
            onClick={() => balance !== undefined && setAmount(String(usdcToNumber(balance)))}>
            Balance: {balance !== undefined ? fmtUsdc(balance) : isConnected ? "…" : "—"}
          </button>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <input inputMode="decimal" value={amount} aria-label="Amount in USDC"
            onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setAmount(e.target.value)}
            className="tabular w-full bg-transparent text-3xl font-semibold outline-none" placeholder="0" />
          <span className="text-sm text-muted">USDC</span>
        </div>
        <div className="mt-3 flex gap-2">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(p)} className={cn("rounded-full bg-surface px-3 py-1 text-xs font-medium text-muted hover:text-text", amount === p && "text-text ring-1 ring-border")}>
              ${p}
            </button>
          ))}
        </div>
      </div>

      {/* details */}
      <dl className="space-y-2 text-sm">
        {entry !== null && market.kind === "UP_DOWN" && (
          <Row label="Entry reference price" value={fmtUsd(entry)} hint="Opening Chainlink reference price recorded onchain at market creation" />
        )}
        {currentPrice !== undefined && currentPrice !== null && <Row label="Current reference price" value={fmtUsd(currentPrice)} />}
        <Row label="Estimated shares" value={shares > 0n && quoteMatchesInput ? usdcToNumber(shares).toFixed(2) : "—"} />
        <Row label="Avg. price per share" value={avg ? fmtUsd(avg) : "—"} hint="AMM execution estimate, includes fees. Not guaranteed — protected by 1% max slippage." />
        <Row label={`Payout if ${isYes ? labels.yes : labels.no} wins`} value={shares > 0n && quoteMatchesInput ? fmtUsdc(shares) : "—"} strong
          hint="1 USDC per share if your side wins, 0.50 on a tie/invalid market, 0 if it loses. Not a guaranteed payout." />
        <Row label={`Fees (${((market.lpFeeBps + market.protocolFeeBps) / 100).toFixed(2)}%)`} value={fee > 0n && quoteMatchesInput ? fmtUsdc(fee) : "—"} />
        <Row label="Max loss" value={units ? fmtUsdc(units) : "—"} />
        <Row label={tradingOpen ? "Trading closes in" : "Trading closed"} value={tradingOpen ? <Countdown to={market.tradingEndsAt} /> : fmtDateTime(market.tradingEndsAt)} />
        <Row label="Settles at" value={fmtDateTime(market.closeTime)} />
      </dl>

      {/* actions */}
      {!isConnected ? (
        <div className="flex justify-center [&>div]:w-full [&_button]:w-full"><ConnectButton label="Connect wallet to trade" /></div>
      ) : !access.canTrade ? (
        <EligibilityGate />
      ) : needsApproval && !disabledReason ? (
        <Button size="xl" className="w-full" onClick={approve} disabled={approveTx.busy}>
          {approveTx.busy ? "Approving…" : `Approve ${amount} USDC`}
        </Button>
      ) : (
        <Button size="xl" variant={isYes ? "up" : "down"} className="w-full" onClick={buy} disabled={Boolean(disabledReason) || tx.busy}>
          {tx.busy ? "Confirming…" : disabledReason ?? `Buy ${isYes ? labels.yes : labels.no} · ${amount} USDC`}
        </Button>
      )}
      <TxStatusLine tx={approveTx} labels={{ success: "Approval confirmed." }} />
      <TxStatusLine tx={tx} labels={{ success: "Position opened onchain." }} />
      <AnimatePresence>
        {tx.status === "success" && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-2">
            <Button asChild variant="subtle" size="sm" className="flex-1"><Link href="/portfolio">View position</Link></Button>
            <ShareButton marketId={market.id} side={isYes ? labels.yes : labels.no} className="flex-1" />
          </motion.div>
        )}
      </AnimatePresence>
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Settles on the Chainlink reference price in effect at close. Equal price = push (0.50 per share). Implied
          odds ({Math.round(pSide * 100)}%) are AMM prices, not predictions. <Link href={`/m/${market.id}`} className="underline">Full rules</Link>
        </span>
      </p>
    </div>
  );
}

function Row({ label, value, hint, strong }: { label: string; value: React.ReactNode; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1 text-muted" title={hint}>{label}{hint && <Info className="h-3 w-3 opacity-60" />}</dt>
      <dd className={cn("tabular text-right", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
