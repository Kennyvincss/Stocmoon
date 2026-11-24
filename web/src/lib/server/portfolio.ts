import { parseAbiItem, type Address } from "viem";
import { payoutFor, stocMoonLensAbi } from "@stocmoon/core";
import { publicEnv } from "../public-env";
import { chainClient } from "./chain";
import { db } from "./db";
import { listMarkets, type MarketView } from "./markets";

export type Bucket = "open" | "pending" | "claimable" | "closed";

export interface PositionView {
  market: MarketView;
  bucket: Bucket;
  yes: string;
  no: string;
  lpShares: string;
  lpFees: string;
  /** Payout if resolved now (resolved markets only). */
  claimable: string;
  /** Indicative mark-to-market using the AMM marginal price. Not a realisable value. */
  estimatedValue: string;
  costBasis: string | null;
  proceeds: string | null;
}

export interface HistoryItem {
  txHash: string;
  blockNumber: string;
  time: string | null;
  marketId: number;
  action: string;
  side: "YES" | "NO" | null;
  collateralIn: string;
  collateralOut: string;
  shares: string;
  fee: string;
}

export interface PortfolioResponse {
  address: Address;
  positions: PositionView[];
  history: HistoryItem[];
  historySource: "indexer" | "recent-logs" | "none";
  realizedPnl: string | null;
  totals: { estimatedOpenValue: string; claimable: string; lpFees: string };
}

const TRADE = parseAbiItem(
  "event Trade(uint256 indexed marketId, address indexed trader, bool indexed isYes, bool isBuy, uint256 collateralAmount, uint256 shares, uint256 fee, uint256 poolYes, uint256 poolNo)",
);
const REDEEMED = parseAbiItem(
  "event Redeemed(uint256 indexed marketId, address indexed account, uint256 yesBurned, uint256 noBurned, uint256 payout)",
);

async function historyFromDb(address: Address) {
  const sql = db();
  if (!sql) return null;
  const rows = await sql<{
    tx_hash: string; block_number: string; block_time: Date | null; market_id: string; action: string; side: "YES" | "NO" | null;
    collateral_in: string; collateral_out: string; shares: string; fee: string;
  }[]>`select tx_hash, block_number, block_time, market_id, action, side, collateral_in, collateral_out, shares, fee
       from transactions where chain_id = ${publicEnv.chainId} and account = ${address.toLowerCase()}
       order by block_number desc, log_index desc limit 500`;
  const agg = await sql<{ market_id: string; cost: string; proceeds: string }[]>`
    select market_id,
      coalesce(sum(collateral_in) filter (where action in ('buy','split')), 0)::text as cost,
      coalesce(sum(collateral_out) filter (where action in ('sell','merge','redeem')), 0)::text as proceeds
    from transactions where chain_id = ${publicEnv.chainId} and account = ${address.toLowerCase()} group by market_id`;
  return {
    items: rows.map((r) => ({
      txHash: r.tx_hash, blockNumber: r.block_number, time: r.block_time?.toISOString() ?? null, marketId: Number(r.market_id),
      action: r.action, side: r.side, collateralIn: r.collateral_in, collateralOut: r.collateral_out, shares: r.shares, fee: r.fee,
    })),
    perMarket: new Map(agg.map((a) => [Number(a.market_id), { cost: BigInt(a.cost.split(".")[0]!), proceeds: BigInt(a.proceeds.split(".")[0]!) }])),
  };
}

async function historyFromLogs(address: Address): Promise<HistoryItem[]> {
  if (!publicEnv.markets) return [];
  const c = chainClient();
  const latest = await c.getBlockNumber();
  const items: HistoryItem[] = [];
  const span = 9_999n;
  for (let to = latest, i = 0; i < 5 && to > 0n; i++, to -= span + 1n) {
    const from = to > span ? to - span : 0n;
    const [trades, redeems] = await Promise.all([
      c.getLogs({ address: publicEnv.markets, event: TRADE, args: { trader: address }, fromBlock: from, toBlock: to }),
      c.getLogs({ address: publicEnv.markets, event: REDEEMED, args: { account: address }, fromBlock: from, toBlock: to }),
    ]);
    for (const l of trades) {
      items.push({
        txHash: l.transactionHash, blockNumber: l.blockNumber.toString(), time: null, marketId: Number(l.args.marketId),
        action: l.args.isBuy ? "buy" : "sell", side: l.args.isYes ? "YES" : "NO",
        collateralIn: l.args.isBuy ? String(l.args.collateralAmount) : "0", collateralOut: l.args.isBuy ? "0" : String(l.args.collateralAmount),
        shares: String(l.args.shares), fee: String(l.args.fee),
      });
    }
    for (const l of redeems) {
      items.push({
        txHash: l.transactionHash, blockNumber: l.blockNumber.toString(), time: null, marketId: Number(l.args.marketId),
        action: "redeem", side: null, collateralIn: "0", collateralOut: String(l.args.payout),
        shares: String((l.args.yesBurned ?? 0n) + (l.args.noBurned ?? 0n)), fee: "0",
      });
    }
  }
  return items.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
}

export async function getPortfolio(address: Address): Promise<PortfolioResponse> {
  const markets = await listMarkets();
  const positions: PositionView[] = [];
  let estOpen = 0n;
  let claimableTotal = 0n;
  let feesTotal = 0n;

  const dbHist = await historyFromDb(address).catch(() => null);

  if (publicEnv.lens && markets.length) {
    const c = chainClient();
    for (let i = 0; i < markets.length; i += 100) {
      const chunk = markets.slice(i, i + 100);
      const [yes, no, lp, fees] = (await c.readContract({
        address: publicEnv.lens, abi: stocMoonLensAbi, functionName: "positionsOf",
        args: [address, chunk.map((m) => BigInt(m.id))],
      })) as readonly [readonly bigint[], readonly bigint[], readonly bigint[], readonly bigint[]];
      chunk.forEach((m, j) => {
        const y = yes[j] ?? 0n, n = no[j] ?? 0n, l = lp[j] ?? 0n, f = fees[j] ?? 0n;
        const touched = dbHist?.perMarket.has(m.id);
        if (y === 0n && n === 0n && l === 0n && f === 0n && !touched) return;
        const claim = m.phase === "resolved" ? payoutFor(m.outcome, y, n) : 0n;
        const p = BigInt(Math.round(m.priceYes * 1e6));
        const est = (y * p + n * (1_000_000n - p)) / 1_000_000n;
        let bucket: PositionView["bucket"];
        if (y === 0n && n === 0n && l === 0n && f === 0n) bucket = "closed";
        else if (m.phase === "resolved") bucket = claim > 0n || l > 0n || f > 0n ? "claimable" : "closed";
        else if (m.phase === "trading") bucket = "open";
        else bucket = "pending";
        if (bucket === "open") estOpen += est;
        claimableTotal += claim;
        feesTotal += f;
        const pm = dbHist?.perMarket.get(m.id);
        positions.push({
          market: m, bucket, yes: y.toString(), no: n.toString(), lpShares: l.toString(), lpFees: f.toString(),
          claimable: claim.toString(), estimatedValue: m.phase === "resolved" ? claim.toString() : est.toString(),
          costBasis: pm ? pm.cost.toString() : null, proceeds: pm ? pm.proceeds.toString() : null,
        });
      });
    }
  }

  let history: HistoryItem[] = [];
  let historySource: PortfolioResponse["historySource"] = "none";
  let realizedPnl: string | null = null;
  if (dbHist) {
    history = dbHist.items;
    historySource = "indexer";
    let pnl = 0n;
    for (const p of positions) {
      // realised only: resolved markets with nothing left to claim, or fully exited markets
      if (p.bucket === "closed" && p.costBasis !== null && p.proceeds !== null) pnl += BigInt(p.proceeds) - BigInt(p.costBasis);
    }
    realizedPnl = pnl.toString();
  } else {
    history = await historyFromLogs(address).catch(() => []);
    historySource = history.length ? "recent-logs" : "none";
  }

  return {
    address, positions, history, historySource, realizedPnl,
    totals: { estimatedOpenValue: estOpen.toString(), claimable: claimableTotal.toString(), lpFees: feesTotal.toString() },
  };
}
