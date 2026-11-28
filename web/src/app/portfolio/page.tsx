"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount, useReadContract, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { erc20Abi } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { sideLabels } from "@stocmoon/core";
import { usePortfolio, useUser } from "@/lib/api";
import type { PositionView } from "@/lib/server/portfolio";
import { publicEnv } from "@/lib/public-env";
import { PROFILE_MESSAGE } from "@/lib/messages";
import { fmtDateTime, fmtShares, fmtUsdc, shortAddr } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState, Stat, StockLogo, TxLink } from "@/components/common";
import { PhaseBadge } from "@/components/cards";
import { PositionActions } from "@/components/position-actions";
import { PnlChart } from "@/components/pnl-chart";
import { cn } from "@/lib/utils";

const BUCKETS = [
  { id: "open", label: "Open" },
  { id: "pending", label: "Pending settlement" },
  { id: "claimable", label: "Claimable" },
  { id: "closed", label: "Closed" },
] as const;

export default function PortfolioPage() {
  const { address } = useAccount();
  const q = usePortfolio(address);
  const user = useUser(address);
  const [bucket, setBucket] = useState<string>("open");
  const bal = useReadContract({
    address: publicEnv.usdc, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  if (!address) {
    return <EmptyState title="Connect your wallet" body="Your positions, claimable winnings and history are read from Base." action={<ConnectButton />} />;
  }
  const d = q.data;
  const positions = d?.positions.filter((p) => p.bucket === bucket) ?? [];
  const total = (bal.data ?? 0n) + BigInt(d?.totals.estimatedOpenValue ?? 0) + BigInt(d?.totals.claimable ?? 0) + BigInt(d?.totals.lpFees ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <StockLogo src={user.data?.profile?.avatarUrl} symbol={user.data?.profile?.username ?? address.slice(2, 4)} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{user.data?.profile?.username ?? "Portfolio"}</h1>
          <div className="text-sm text-muted">{shortAddr(address)} · <Link className="underline" href={`/profile/${address}`}>public profile</Link></div>
        </div>
        <EditProfile current={user.data?.profile ?? null} disabled={user.data?.available === false} />
      </div>

      <Card><CardContent className="grid grid-cols-2 gap-5 sm:grid-cols-5">
        <Stat label="Total value (est.)" value={d ? fmtUsdc(total) : "…"} sub="USDC + marked positions" />
        <Stat label="Available USDC" value={bal.data !== undefined ? fmtUsdc(bal.data) : "…"} />
        <Stat label="Open positions (est.)" value={d ? fmtUsdc(d.totals.estimatedOpenValue) : "…"} sub="at AMM mid price" />
        <Stat label="Claimable" value={d ? fmtUsdc(d.totals.claimable) : "…"} />
        <Stat label="Realised P&L" value={d?.realizedPnl != null ? fmtUsdc(d.realizedPnl, { signed: true }) : "—"} sub={d?.realizedPnl == null ? "needs indexer" : "verified from events"} />
      </CardContent></Card>

      {d?.historySource === "indexer" && d.history.length > 1 && (
        <Card><CardHeader><CardTitle>Realised cash flow</CardTitle></CardHeader><CardContent><PnlChart history={d.history} /></CardContent></Card>
      )}

      <div className="space-y-3">
        <Tabs value={bucket} onValueChange={setBucket}>
          <TabsList className="w-full overflow-x-auto sm:w-auto">
            {BUCKETS.map((b) => (
              <TabsTrigger key={b.id} value={b.id}>
                {b.label}{d ? ` ${d.positions.filter((p) => p.bucket === b.id).length}` : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {q.isLoading ? <Skeleton className="h-40" /> : q.isError ? (
          <EmptyState title="Couldn't load positions" body={(q.error as Error).message} />
        ) : positions.length === 0 ? (
          <EmptyState title={`No ${BUCKETS.find((b) => b.id === bucket)?.label.toLowerCase()} positions`}
            action={bucket === "open" ? <Button asChild size="sm"><Link href="/markets">Find a market</Link></Button> : undefined} />
        ) : (
          <div className="space-y-3">{positions.map((p) => <PositionCard key={p.market.id} p={p} />)}</div>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Trading history</CardTitle>
          <span className="text-xs text-muted">{d?.historySource === "chain-events" ? "Read directly from chain events" : ""}</span>
        </CardHeader>
        <CardContent>
          {!d?.history.length ? <p className="text-sm text-muted">No transactions yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-xs text-muted"><tr>
                  <th className="py-2 text-left font-medium">Action</th><th className="py-2 text-left font-medium">Market</th>
                  <th className="py-2 text-right font-medium">Paid</th><th className="py-2 text-right font-medium">Received</th>
                  <th className="py-2 text-right font-medium">Shares</th><th className="py-2 text-right font-medium">Tx</th>
                </tr></thead>
                <tbody>
                  {d.history.slice(0, 100).map((h) => (
                    <tr key={`${h.txHash}-${h.action}-${h.marketId}-${h.shares}`} className="border-t border-border">
                      <td className="py-2 capitalize">{h.action.replace("_", " ")} {h.side && <span className={h.side === "YES" ? "text-up" : "text-down"}>{h.side}</span>}</td>
                      <td className="py-2"><Link href={`/m/${h.marketId}`} className="underline-offset-2 hover:underline">#{h.marketId}</Link></td>
                      <td className="tabular py-2 text-right">{h.collateralIn !== "0" ? fmtUsdc(h.collateralIn) : "—"}</td>
                      <td className="tabular py-2 text-right">{h.collateralOut !== "0" ? fmtUsdc(h.collateralOut) : "—"}</td>
                      <td className="tabular py-2 text-right">{h.shares !== "0" ? fmtShares(h.shares) : "—"}</td>
                      <td className="py-2 text-right"><TxLink hash={h.txHash} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PositionCard({ p }: { p: PositionView }) {
  const [open, setOpen] = useState(false);
  const m = p.market;
  const labels = sideLabels(m.kind, m.assetMetaA?.symbol, m.assetMetaB?.symbol);
  const side = BigInt(p.yes) > BigInt(p.no) ? labels.yes : BigInt(p.no) > 0n ? labels.no : BigInt(p.lpShares) > 0n ? "LP" : "—";
  const isUp = BigInt(p.yes) >= BigInt(p.no);
  const title = m.kind === "BATTLE" ? `${m.assetMetaA?.symbol} vs ${m.assetMetaB?.symbol}` : m.kind === "EVENT" ? m.question ?? `Event #${m.id}` : m.assetMetaA?.symbol;
  const pnl = p.costBasis !== null && p.proceeds !== null && p.bucket === "closed" ? BigInt(p.proceeds) - BigInt(p.costBasis) : null;
  return (
    <Card>
      <button className="flex w-full flex-wrap items-center gap-3 p-4 text-left" onClick={() => setOpen((v) => !v)}>
        <StockLogo src={m.assetMetaA?.iconUrl} symbol={m.assetMetaA?.symbol ?? "?"} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium">
            <span className="truncate">{title}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs", side === "LP" ? "bg-surface-2" : isUp ? "bg-up-soft text-up" : "bg-down-soft text-down")}>{side}</span>
          </div>
          <div className="text-xs text-muted">#{m.id} · closes {fmtDateTime(m.closeTime)}</div>
        </div>
        <div className="text-right text-sm">
          <div className="tabular font-medium">{p.bucket === "claimable" ? fmtUsdc(p.claimable) : fmtUsdc(p.estimatedValue)}</div>
          <div className="text-xs text-muted">{p.bucket === "claimable" ? "claimable" : p.bucket === "closed" ? (pnl !== null ? fmtUsdc(pnl, { signed: true }) + " realised" : "closed") : "est. value"}</div>
        </div>
        <PhaseBadge market={m} />
      </button>
      {open && (
        <CardContent className="border-t border-border pt-4">
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Cost basis" value={p.costBasis !== null ? fmtUsdc(p.costBasis) : "—"} />
            <Stat label="Proceeds" value={p.proceeds !== null ? fmtUsdc(p.proceeds) : "—"} />
            <Stat label="Market odds" value={`${Math.round(m.priceYes * 100)}% ${labels.yes}`} />
            <Stat label="Outcome" value={m.outcome === "NONE" ? "Pending" : m.outcome} />
          </div>
          <PositionActions market={m} />
          <Link href={`/m/${m.id}`} className="mt-3 inline-block text-xs text-muted underline">Market details & rules</Link>
        </CardContent>
      )}
    </Card>
  );
}

function EditProfile({ current, disabled }: { current: { username: string | null; avatarUrl: string | null } | null; disabled: boolean }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  const [username, setUsername] = useState(current?.username ?? "");
  const [avatar, setAvatar] = useState(current?.avatarUrl ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const valid = useMemo(() => /^[a-zA-Z0-9_]{3,20}$/.test(username) && (avatar === "" || avatar.startsWith("https://")), [username, avatar]);
  async function save() {
    if (!address) return;
    setStatus("Waiting for signature…");
    try {
      const nonce = crypto.randomUUID();
      const issuedAt = new Date().toISOString();
      const signature = await signMessageAsync({ message: PROFILE_MESSAGE(address, username, avatar, nonce, issuedAt) });
      const r = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, username, avatarUrl: avatar, nonce, issuedAt, signature }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setStatus("Saved.");
      await qc.invalidateQueries({ queryKey: ["user"] });
    } catch (e) {
      setStatus((e as Error).message);
    }
  }
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline" size="sm" disabled={disabled} title={disabled ? "Profiles need the database" : undefined}>Edit profile</Button></DialogTrigger>
      <DialogContent title="Edit profile">
        <div className="space-y-3">
          <label className="block text-sm"><span className="text-muted">Username</span>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="moonwalker" maxLength={20} /></label>
          <label className="block text-sm"><span className="text-muted">Avatar URL (https)</span>
            <Input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" /></label>
          <p className="text-xs text-muted">You&apos;ll sign a message to prove you own this wallet. No transaction, no gas.</p>
          <Button className="w-full" disabled={!valid} onClick={save}>Save</Button>
          {status && <p className="text-sm text-muted">{status}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
