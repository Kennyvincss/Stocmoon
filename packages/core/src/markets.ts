import type { Address, Hex } from "viem";

export const KIND = ["UP_DOWN", "BATTLE", "EVENT"] as const;
export const STATUS = ["NONE", "OPEN", "PROPOSED", "RESOLVED"] as const;
export const OUTCOME = ["NONE", "YES", "NO", "PUSH", "INVALID"] as const;

export type MarketKind = (typeof KIND)[number];
export type MarketStatus = (typeof STATUS)[number];
export type MarketOutcome = (typeof OUTCOME)[number];

/** Lifecycle phase derived from onchain status + time. */
export type MarketPhase = "trading" | "awaiting-close" | "settling" | "proposed" | "resolved" | "expired";

export interface MarketData {
  id: number;
  kind: MarketKind;
  status: MarketStatus;
  outcome: MarketOutcome;
  proposedOutcome: MarketOutcome;
  lpFeeBps: number;
  protocolFeeBps: number;
  maxStaleness: number;
  settlementDelay: number;
  resolutionWindow: number;
  disputeWindow: number;
  openTime: number;
  tradingEndsAt: number;
  closeTime: number;
  proposedAt: number;
  creator: Address;
  assetA: Address;
  feedA: Address;
  assetB: Address;
  feedB: Address;
  openPriceA: string;
  openPriceB: string;
  closePriceA: string;
  closePriceB: string;
  openRoundA: string;
  openRoundB: string;
  metadataHash: Hex;
  poolYes: string;
  poolNo: string;
  totalLpShares: string;
  collateral: string;
  /** Marginal YES probability 0..1 (indicative). */
  priceYes: number;
  yesSupply: string;
  noSupply: string;
}

/** Raw struct as returned by viem for `getMarket` / `listMarkets` (named tuple). */
export interface RawMarket {
  kind: number;
  status: number;
  outcome: number;
  proposedOutcome: number;
  lpFeeBps: number;
  protocolFeeBps: number;
  maxStaleness: number;
  settlementDelay: number;
  resolutionWindow: number;
  disputeWindow: number;
  openTime: bigint;
  tradingEndsAt: bigint;
  closeTime: bigint;
  proposedAt: bigint;
  creator: Address;
  assetA: Address;
  feedA: Address;
  assetB: Address;
  feedB: Address;
  openPriceA: bigint;
  openPriceB: bigint;
  closePriceA: bigint;
  closePriceB: bigint;
  openRoundA: bigint;
  openRoundB: bigint;
  metadataHash: Hex;
  poolYes: bigint;
  poolNo: bigint;
  totalLpShares: bigint;
  collateral: bigint;
}

export function normalizeMarket(
  id: number | bigint,
  m: RawMarket,
  extra: { priceYes: bigint; yesSupply: bigint; noSupply: bigint },
): MarketData {
  return {
    id: Number(id),
    kind: KIND[m.kind] ?? "UP_DOWN",
    status: STATUS[m.status] ?? "NONE",
    outcome: OUTCOME[m.outcome] ?? "NONE",
    proposedOutcome: OUTCOME[m.proposedOutcome] ?? "NONE",
    lpFeeBps: Number(m.lpFeeBps),
    protocolFeeBps: Number(m.protocolFeeBps),
    maxStaleness: Number(m.maxStaleness),
    settlementDelay: Number(m.settlementDelay),
    resolutionWindow: Number(m.resolutionWindow),
    disputeWindow: Number(m.disputeWindow),
    openTime: Number(m.openTime),
    tradingEndsAt: Number(m.tradingEndsAt),
    closeTime: Number(m.closeTime),
    proposedAt: Number(m.proposedAt),
    creator: m.creator,
    assetA: m.assetA,
    feedA: m.feedA,
    assetB: m.assetB,
    feedB: m.feedB,
    openPriceA: m.openPriceA.toString(),
    openPriceB: m.openPriceB.toString(),
    closePriceA: m.closePriceA.toString(),
    closePriceB: m.closePriceB.toString(),
    openRoundA: m.openRoundA.toString(),
    openRoundB: m.openRoundB.toString(),
    metadataHash: m.metadataHash,
    poolYes: m.poolYes.toString(),
    poolNo: m.poolNo.toString(),
    totalLpShares: m.totalLpShares.toString(),
    collateral: m.collateral.toString(),
    priceYes: Number(extra.priceYes) / 1e18,
    yesSupply: extra.yesSupply.toString(),
    noSupply: extra.noSupply.toString(),
  };
}

export function marketPhase(m: Pick<MarketData, "status" | "tradingEndsAt" | "closeTime" | "settlementDelay" | "resolutionWindow">, nowSec = Math.floor(Date.now() / 1000)): MarketPhase {
  if (m.status === "RESOLVED") return "resolved";
  if (m.status === "PROPOSED") return "proposed";
  if (nowSec < m.tradingEndsAt) return "trading";
  if (nowSec < m.closeTime + m.settlementDelay) return "awaiting-close";
  if (nowSec <= m.closeTime + m.resolutionWindow) return "settling";
  return "expired";
}

export const yesTokenId = (id: number | bigint) => BigInt(id) * 2n;
export const noTokenId = (id: number | bigint) => BigInt(id) * 2n + 1n;

/** Side labels per market kind. */
export function sideLabels(kind: MarketKind, symbolA = "A", symbolB = "B"): { yes: string; no: string } {
  if (kind === "UP_DOWN") return { yes: "UP", no: "DOWN" };
  if (kind === "BATTLE") return { yes: symbolA, no: symbolB };
  return { yes: "YES", no: "NO" };
}

/** Converts a raw feed answer to a decimal number (display only — never used for settlement). */
export function feedToNumber(raw: string | bigint, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

export function upDownQuestion(symbol: string, openPrice: number, closeTime: number): string {
  const when = new Date(closeTime * 1000).toUTCString().replace(" GMT", " UTC");
  return `Will ${symbol}'s reference price be higher than $${openPrice.toFixed(2)} at ${when}?`;
}

export function battleQuestion(a: string, b: string, closeTime: number): string {
  const when = new Date(closeTime * 1000).toUTCString().replace(" GMT", " UTC");
  return `Will ${a} have a higher percentage return than ${b} by ${when}?`;
}

/** Payout of a position at resolution in collateral units. Mirrors the contract. */
export function payoutFor(outcome: MarketOutcome, yes: bigint, no: bigint): bigint {
  if (outcome === "YES") return yes;
  if (outcome === "NO") return no;
  if (outcome === "PUSH" || outcome === "INVALID") return (yes + no) / 2n;
  return 0n;
}

export const DURATION_LABELS: Record<number, string> = {
  300: "5m",
  900: "15m",
  1800: "30m",
  3600: "1H",
  14400: "4H",
  86400: "24H",
  604800: "7D",
  2592000: "30D",
};

export const CANDIDATE_DURATIONS = [300, 900, 1800, 3600, 14400, 86400, 604800, 2592000] as const;
