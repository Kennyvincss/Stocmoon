import { parseAbiItem, type Address } from "viem";
import {
  CANDIDATE_DURATIONS, findSettlementProof, normalizeMarket, marketPhase, stocMoonLensAbi, stocMoonMarketsAbi,
  type MarketData, type MarketPhase, type RawMarket,
} from "@stocmoon/core";
import { publicEnv } from "../public-env";
import { cached, invalidate } from "./cache";
import { chainClient } from "./chain";
import { db } from "./db";
import { serverEnv } from "./env";
import { getStocks, onchainRegistry, type OnchainAsset } from "./stocks";

export interface AssetMeta {
  address: Address;
  symbol: string;
  name: string;
  iconUrl: string | null;
  decimals: number | null;
}

export interface MarketView extends MarketData {
  phase: MarketPhase;
  duration: number;
  assetMetaA: AssetMeta | null;
  assetMetaB: AssetMeta | null;
  question: string | null;
  rulesURI: string | null;
}

export interface ProtocolConfig {
  configured: boolean;
  chainId: number;
  durations: { duration: number; enabled: boolean; tradingCutoff: number }[];
  lpFeeBps: number;
  protocolFeeBps: number;
  settlementDelay: number;
  resolutionWindow: number;
  disputeWindow: number;
  minInitialLiquidity: string;
  openCreation: boolean;
  eligibilityRequired: boolean;
  paused: boolean;
}

const MAX_SCAN = 500;

export async function protocolConfig(): Promise<ProtocolConfig> {
  const markets = publicEnv.markets;
  const empty: ProtocolConfig = {
    configured: false, chainId: publicEnv.chainId, durations: [], lpFeeBps: 0, protocolFeeBps: 0, settlementDelay: 0,
    resolutionWindow: 0, disputeWindow: 0, minInitialLiquidity: "0", openCreation: false, eligibilityRequired: false, paused: false,
  };
  if (!markets) return empty;
  const r = await cached("config", 60_000, async () => {
    const c = chainClient();
    const read = <T,>(functionName: string, args: unknown[] = []) =>
      c.readContract({ address: markets, abi: stocMoonMarketsAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
    const durations = await Promise.all(
      CANDIDATE_DURATIONS.map(async (d) => {
        const [enabled, tradingCutoff] = await read<readonly [boolean, number]>("durations", [d]);
        return { duration: d, enabled, tradingCutoff: Number(tradingCutoff) };
      }),
    );
    const [lp, proto, delay, window_, dispute, minLiq, open, elig, paused] = await Promise.all([
      read<number>("lpFeeBps"), read<number>("protocolFeeBps"), read<number>("settlementDelay"), read<number>("resolutionWindow"),
      read<number>("disputeWindow"), read<bigint>("minInitialLiquidity"), read<boolean>("openCreation"),
      read<boolean>("eligibilityRequired"), read<boolean>("paused"),
    ]);
    return {
      configured: true, chainId: publicEnv.chainId, durations, lpFeeBps: Number(lp), protocolFeeBps: Number(proto),
      settlementDelay: Number(delay), resolutionWindow: Number(window_), disputeWindow: Number(dispute),
      minInitialLiquidity: minLiq.toString(), openCreation: open, eligibilityRequired: elig, paused,
    } satisfies ProtocolConfig;
  });
  return r.value;
}

interface LensView {
  id: bigint;
  market: RawMarket;
  priceYes: bigint;
  yesSupply: bigint;
  noSupply: bigint;
}

async function rawMarkets(): Promise<MarketData[]> {
  const lens = publicEnv.lens;
  if (!lens) return [];
  const r = await cached("markets:raw", 8_000, async () => {
    const c = chainClient();
    const out: MarketData[] = [];
    for (let offset = 0; offset < MAX_SCAN; offset += 100) {
      const page = (await c.readContract({
        address: lens, abi: stocMoonLensAbi, functionName: "listMarkets", args: [BigInt(offset), 100n],
      })) as readonly LensView[];
      for (const v of page) out.push(normalizeMarket(v.id, v.market, v));
      if (page.length < 100) break;
    }
    return out;
  });
  return r.value;
}

const EVENT_DETAILS = parseAbiItem("event EventMarketDetails(uint256 indexed marketId, string question, string rulesURI)");

async function eventDetails(): Promise<Map<number, { question: string; rulesURI: string }>> {
  const out = new Map<number, { question: string; rulesURI: string }>();
  if (!publicEnv.markets) return out;
  const r = await cached("markets:eventDetails", 60_000, async () => {
    const sql = db();
    if (sql) {
      const rows = await sql<{ market_id: string; question: string; rules_uri: string }[]>`
        select market_id, question, rules_uri from earnings_events where chain_id = ${publicEnv.chainId}`;
      if (rows.length) return rows.map((x) => [Number(x.market_id), { question: x.question, rulesURI: x.rules_uri }] as const);
    }
    const logs = await chainClient().getLogs({
      address: publicEnv.markets, event: EVENT_DETAILS, fromBlock: serverEnv.deployBlock, toBlock: "latest",
    });
    return logs.map((l) => [Number(l.args.marketId), { question: l.args.question ?? "", rulesURI: l.args.rulesURI ?? "" }] as const);
  }).catch(() => ({ value: [] as (readonly [number, { question: string; rulesURI: string }])[] }));
  for (const [k, v] of r.value) out.set(k, v);
  return out;
}

export async function listMarkets(filter: { kind?: string; asset?: string; phase?: string } = {}): Promise<MarketView[]> {
  const [markets, stocks, details] = await Promise.all([rawMarkets(), getStocks(), eventDetails()]);
  const registry: Map<string, OnchainAsset> = await onchainRegistry().catch(() => new Map());
  const meta = new Map<string, AssetMeta>();
  for (const s of stocks.stocks) {
    meta.set(s.address.toLowerCase(), {
      address: s.address, symbol: s.symbol, name: s.name, iconUrl: s.iconUrl,
      decimals: registry.get(s.address.toLowerCase())?.decimals ?? null,
    });
  }
  const metaFor = (a: Address): AssetMeta | null => {
    if (!a || /^0x0+$/.test(a)) return null;
    const m = meta.get(a.toLowerCase());
    if (m) return m;
    const reg = registry.get(a.toLowerCase());
    return { address: a, symbol: `${a.slice(0, 6)}…`, name: "Unlisted token", iconUrl: null, decimals: reg?.decimals ?? null };
  };
  const now = Math.floor(Date.now() / 1000);
  return markets
    .map((m) => ({
      ...m,
      phase: marketPhase(m, now),
      duration: m.closeTime - m.openTime,
      assetMetaA: metaFor(m.assetA),
      assetMetaB: m.kind === "BATTLE" ? metaFor(m.assetB) : null,
      question: details.get(m.id)?.question ?? null,
      rulesURI: details.get(m.id)?.rulesURI ?? null,
    }))
    .filter((m) => (!filter.kind || m.kind === filter.kind))
    .filter((m) => (!filter.asset || m.assetA.toLowerCase() === filter.asset.toLowerCase() || m.assetB.toLowerCase() === filter.asset.toLowerCase()))
    .filter((m) => (!filter.phase || m.phase === filter.phase));
}

export async function getMarket(id: number): Promise<MarketView | null> {
  const all = await listMarkets();
  return all.find((m) => m.id === id) ?? null;
}

export function invalidateMarkets() {
  invalidate("markets:");
}

/**
 * Computes the settlement proof (round ids in effect at closeTime). This is a convenience: the contract
 * verifies the proof independently, so a wrong proof can only make the transaction revert.
 */
export async function settlementProof(m: MarketView) {
  if (m.kind === "EVENT") return null;
  const target = BigInt(m.closeTime);
  const a = await findSettlementProof(chainClient(), m.feedA, target);
  const b = m.kind === "BATTLE" ? await findSettlementProof(chainClient(), m.feedB, target) : null;
  const staleA = Number(target - a.updatedAt) > m.maxStaleness;
  const staleB = b ? Number(target - b.updatedAt) > m.maxStaleness : false;
  return {
    roundA: a.roundId.toString(), nextRoundA: a.nextRoundId.toString(), answerA: a.answer.toString(), updatedAtA: Number(a.updatedAt),
    roundB: b?.roundId.toString() ?? "0", nextRoundB: b?.nextRoundId.toString() ?? "0", answerB: b?.answer.toString() ?? "0",
    updatedAtB: b ? Number(b.updatedAt) : 0,
    stale: staleA || staleB,
  };
}
