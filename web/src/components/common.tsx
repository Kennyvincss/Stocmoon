"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Inbox } from "lucide-react";
import { explorerTx } from "@stocmoon/core";
import { cn } from "@/lib/utils";
import { fmtAgo, fmtDuration } from "@/lib/format";
import { publicEnv } from "@/lib/public-env";
import type { TxState } from "@/hooks/useTx";

export function StockLogo({ src, symbol, size = 40, className }: { src?: string | null; symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!src || failed) {
    return (
      <div style={style} className={cn("flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted", className)}>
        {symbol.replace(/[^A-Za-z]/g, "").slice(0, 3) || "?"}
      </div>
    );
  }
  // Coinbase serves icons as binary/octet-stream + nosniff, which Safari/iOS won't render: proxy them same-origin.
  const url = /^https:\/\/metadata\.coinbase\.com\//.test(src) ? `/api/icon?src=${encodeURIComponent(src)}` : src;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" style={style} loading="lazy" decoding="async" onError={() => setFailed(true)} className={cn("shrink-0 rounded-full bg-surface-2 object-cover", className)} />;
}

export function Notice({ tone = "warn", children, className }: { tone?: "warn" | "down" | "neutral"; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm",
      tone === "warn" && "bg-warn-soft text-warn", tone === "down" && "bg-down-soft text-down", tone === "neutral" && "bg-surface-2 text-muted", className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StaleBanner({ source, fetchedAt, error }: { source: string; fetchedAt: string | null; error?: string }) {
  if (source === "live") return null;
  if (source === "unavailable") {
    return <Notice tone="down">The Base Tokenized Stocks API is unavailable and no cached copy exists yet. No prices are shown rather than invented ones.{error ? ` (${error})` : ""}</Notice>;
  }
  return (
    <Notice>
      Showing cached stock data from {fetchedAt ? fmtAgo(fetchedAt) : "an earlier sync"} — the Tokenized Stocks API is not responding right now.
    </Notice>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <Inbox className="h-8 w-8 text-muted" />
      <div className="font-medium">{title}</div>
      {body && <div className="max-w-md text-sm text-muted">{body}</div>}
      {action}
    </div>
  );
}

export function Countdown({ to, prefix = "" }: { to: number; prefix?: string }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = to - now;
  return <span className="tabular">{left > 0 ? `${prefix}${fmtDuration(left)}` : "now"}</span>;
}

export function TxLink({ hash, className }: { hash: string; className?: string }) {
  const url = explorerTx(publicEnv.chainId, hash);
  if (!url) return <span className={cn("font-mono text-xs", className)}>{hash.slice(0, 10)}…</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-text hover:underline", className)}>
      {hash.slice(0, 10)}… <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function TxStatusLine({ tx, labels }: { tx: TxState; labels?: Partial<Record<TxState["status"], string>> }) {
  if (tx.status === "idle") return null;
  const text = labels?.[tx.status] ?? {
    simulating: "Simulating transaction…",
    signing: "Confirm in your wallet…",
    pending: "Waiting for confirmation onchain…",
    success: "Confirmed onchain.",
    error: tx.error ?? "Transaction failed",
    idle: "",
  }[tx.status];
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm",
      tx.status === "success" && "text-up", tx.status === "error" && "text-down", !["success", "error"].includes(tx.status) && "text-muted")}>
      <span>{text}</span>
      {tx.hash && <TxLink hash={tx.hash} />}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 truncate font-medium">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Change({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className={cn("text-muted", className)}>—</span>;
  return (
    <span className={cn("tabular font-medium", value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted", className)}>
      {value > 0 ? "+" : ""}{(value * 100).toFixed(2)}%
    </span>
  );
}
