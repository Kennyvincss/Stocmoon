import { COLLATERAL_DECIMALS } from "@stocmoon/core";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });

export function fmtUsd(v: number | null | undefined, compact = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return compact ? usdCompact.format(v) : usd.format(v);
}

export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

/** USDC units (6 decimals) -> number for display. */
export function usdcToNumber(units: string | bigint | null | undefined): number {
  if (units === null || units === undefined) return 0;
  return Number(BigInt(units)) / 10 ** COLLATERAL_DECIMALS;
}

export function fmtUsdc(units: string | bigint | null | undefined, opts: { signed?: boolean } = {}): string {
  if (units === null || units === undefined) return "—";
  const n = usdcToNumber(units);
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${opts.signed && n > 0 ? "+" : ""}${s} USDC`;
}

export function fmtShares(units: string | bigint): string {
  return usdcToNumber(units).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Parses a user-entered USDC amount into units. Returns null for invalid input. */
export function parseUsdcInput(v: string): bigint | null {
  if (!/^\d*(\.\d{0,6})?$/.test(v) || v === "" || v === ".") return null;
  const [i = "0", f = ""] = v.split(".");
  return BigInt(i || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

export const shortAddr = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export function fmtDuration(secs: number): string {
  if (secs <= 0) return "0s";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtAgo(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return "unknown";
  const ms = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 0) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${fmtDuration(secs).split(" ")[0]} ago`;
}

export function fmtDateTime(secs: number): string {
  return new Date(secs * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
