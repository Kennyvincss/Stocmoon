"use client";

import { useQuery } from "@tanstack/react-query";
import type { StocksResponse, StockView } from "./server/stocks";
import type { MarketView, ProtocolConfig } from "./server/markets";
import type { PortfolioResponse } from "./server/portfolio";
import type { LeaderRow } from "./server/leaderboard";

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export const useStocks = () =>
  useQuery({ queryKey: ["stocks"], queryFn: () => get<StocksResponse>("/api/stocks"), refetchInterval: 60_000 });

export const useStock = (address: string) =>
  useQuery({
    queryKey: ["stock", address.toLowerCase()],
    queryFn: () => get<{ stock: StockView; meta: Omit<StocksResponse, "stocks">; markets: MarketView[] }>(`/api/stocks/${address}`),
    refetchInterval: 15_000,
  });

export interface HistoryResponse {
  range: string;
  source: string;
  points: { time: number; value: number }[];
  available: Record<string, boolean>;
  earliest: number | null;
}

export const useHistory = (address: string, range: string) =>
  useQuery({
    queryKey: ["history", address.toLowerCase(), range],
    queryFn: () => get<HistoryResponse>(`/api/stocks/${address}/history?range=${range}`),
    refetchInterval: 60_000,
  });

export const useMarkets = (filter: { kind?: string; asset?: string; phase?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({
    queryKey: ["markets", qs],
    queryFn: () => get<{ markets: MarketView[]; error?: string }>(`/api/markets${qs ? `?${qs}` : ""}`),
    refetchInterval: 10_000,
  });
};

export interface ActivityRow {
  event_name: string;
  account: string | null;
  args: Record<string, string>;
  tx_hash: string;
  block_number: string;
  block_time: string | null;
}

export const useMarket = (id: number) =>
  useQuery({
    queryKey: ["market", id],
    queryFn: () => get<{ market: MarketView; activity: ActivityRow[]; participants: number | null }>(`/api/markets/${id}`),
    refetchInterval: 5_000,
  });

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => get<ProtocolConfig>("/api/config"), staleTime: 60_000 });

export const usePortfolio = (address?: string) =>
  useQuery({
    queryKey: ["portfolio", address?.toLowerCase()],
    queryFn: () => get<PortfolioResponse>(`/api/portfolio/${address}`),
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });

export interface Eligibility {
  country: string | null;
  blocked: boolean;
  reason: string | null;
  attested: boolean;
  eligibilityRequired: boolean;
  onchainEligible: boolean | null;
}

export const useEligibility = (address?: string) =>
  useQuery({
    queryKey: ["eligibility", address?.toLowerCase() ?? ""],
    queryFn: () => get<Eligibility>(`/api/eligibility${address ? `?address=${address}` : ""}`),
    staleTime: 60_000,
  });

export const useLeaderboard = (period: string, sort: string) =>
  useQuery({
    queryKey: ["leaderboard", period, sort],
    queryFn: () => get<{ rows: LeaderRow[]; available: boolean; rules: { minResolvedMarkets: number; minVolume: string } }>(
      `/api/leaderboard?period=${period}&sort=${sort}`,
    ),
  });

export interface UserStats {
  profile: { username: string | null; avatarUrl: string | null } | null;
  stats: { markets: number; resolved: number; correct: number; incorrect: number; accuracy: number | null; realizedPnl: string; volume: string } | null;
  available: boolean;
}

export const useUser = (address?: string) =>
  useQuery({ queryKey: ["user", address?.toLowerCase()], queryFn: () => get<UserStats>(`/api/users/${address}`), enabled: Boolean(address) });

export { get as apiGet };
