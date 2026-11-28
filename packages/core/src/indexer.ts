import type postgres from "postgres";
import { parseEventLogs, type Address, type Log, type PublicClient } from "viem";
import { stocMoonMarketsAbi } from "./abi/StocMoonMarkets";
import { KIND, OUTCOME } from "./markets";
import { MIGRATIONS } from "./migrations";
import { getContractLogsRange } from "./logs";

/**
 * Event indexer shared by the services (long-running) and the web app (on-demand, e.g. on Vercel with Supabase).
 * The chain is the source of truth; every row is keyed by (chain_id, tx_hash, log_index), so re-processing is a no-op.
 */
export type Sql = ReturnType<typeof postgres>;

/** Applies any migrations not yet recorded in schema_migrations. */
export async function ensureSchema(sql: Sql): Promise<string[]> {
  await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version));
  const done: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(m.sql);
      await tx`insert into schema_migrations (version) values (${m.version}) on conflict do nothing`;
    });
    done.push(m.version);
  }
  return done;
}

type Decoded = ReturnType<typeof parseEventLogs<typeof stocMoonMarketsAbi>>[number];

const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const jsonArgs = (args: unknown) => JSON.parse(JSON.stringify(args, (_, v) => str(v)));

export async function applyEvent(sql: Sql, chainId: number, ev: Decoded, time: Date | null) {
  const base = { tx: ev.transactionHash, li: ev.logIndex, block: ev.blockNumber.toString() };
  const a = ev.args as Record<string, unknown>;
  const marketId = a.marketId !== undefined ? (a.marketId as bigint).toString() : null;
  const account = (a.trader ?? a.account ?? a.provider ?? a.creator ?? a.resolver ?? a.guardian ?? a.caller ?? null) as string | null;

  await sql`insert into market_events (chain_id, block_number, block_time, tx_hash, log_index, event_name, market_id, account, args)
    values (${chainId}, ${base.block}, ${time}, ${base.tx}, ${base.li}, ${ev.eventName}, ${marketId}, ${account?.toLowerCase() ?? null}, ${sql.json(jsonArgs(a))})
    on conflict (chain_id, tx_hash, log_index) do nothing`;

  const tx = (action: string, acct: string, side: string | null, cin: bigint, cout: bigint, shares: bigint, fee: bigint) => sql`
    insert into transactions (chain_id, tx_hash, log_index, block_number, block_time, account, market_id, action, side, collateral_in, collateral_out, shares, fee)
    values (${chainId}, ${base.tx}, ${base.li}, ${base.block}, ${time}, ${acct.toLowerCase()}, ${marketId}, ${action}, ${side},
      ${cin.toString()}, ${cout.toString()}, ${shares.toString()}, ${fee.toString()})
    on conflict (chain_id, tx_hash, log_index) do nothing`;

  switch (ev.eventName) {
    case "MarketCreated": {
      const kind = KIND[Number(a.kind)] ?? "UP_DOWN";
      const zero = /^0x0{40}$/i;
      await sql`insert into markets (chain_id, market_id, kind, creator, asset_a, asset_b, open_price_a, open_price_b, open_time, trading_ends_at, close_time, metadata_hash, created_tx)
        values (${chainId}, ${marketId}, ${kind}, ${(a.creator as string).toLowerCase()}, ${(a.assetA as string).toLowerCase()},
          ${zero.test(a.assetB as string) ? null : (a.assetB as string).toLowerCase()}, ${str(a.openPriceA) as string}, ${str(a.openPriceB) as string},
          to_timestamp(${Number(a.openTime)}), to_timestamp(${Number(a.tradingEndsAt)}), to_timestamp(${Number(a.closeTime)}), ${a.metadataHash as string}, ${base.tx})
        on conflict do nothing`;
      if (kind === "BATTLE") {
        await sql`insert into stock_battles (chain_id, market_id, asset_a, asset_b) values (${chainId}, ${marketId}, ${(a.assetA as string).toLowerCase()}, ${(a.assetB as string).toLowerCase()}) on conflict do nothing`;
      }
      break;
    }
    case "MarketParams":
      await sql`update markets set feed_a = ${(a.feedA as string).toLowerCase()}, feed_b = ${(a.feedB as string).toLowerCase()},
        max_staleness = ${Number(a.maxStaleness)}, settlement_delay = ${Number(a.settlementDelay)}, resolution_window = ${Number(a.resolutionWindow)},
        dispute_window = ${Number(a.disputeWindow)}, lp_fee_bps = ${Number(a.lpFeeBps)}, protocol_fee_bps = ${Number(a.protocolFeeBps)}
        where chain_id = ${chainId} and market_id = ${marketId}`;
      break;
    case "EventMarketDetails":
      await sql`update markets set question = ${a.question as string}, rules_uri = ${a.rulesURI as string} where chain_id = ${chainId} and market_id = ${marketId}`;
      await sql`insert into earnings_events (chain_id, market_id, company_address, question, rules_uri)
        select ${chainId}, ${marketId}, asset_a, ${a.question as string}, ${a.rulesURI as string} from markets where chain_id = ${chainId} and market_id = ${marketId}
        on conflict do nothing`;
      break;
    case "Trade": {
      const isBuy = a.isBuy as boolean;
      const amt = a.collateralAmount as bigint;
      await tx(isBuy ? "buy" : "sell", a.trader as string, (a.isYes as boolean) ? "YES" : "NO", isBuy ? amt : 0n, isBuy ? 0n : amt, a.shares as bigint, a.fee as bigint);
      await sql`insert into liquidity_pools (chain_id, market_id, pool_yes, pool_no, updated_block) values (${chainId}, ${marketId}, ${str(a.poolYes) as string}, ${str(a.poolNo) as string}, ${base.block})
        on conflict (chain_id, market_id) do update set pool_yes = excluded.pool_yes, pool_no = excluded.pool_no, updated_block = excluded.updated_block
        where liquidity_pools.updated_block <= excluded.updated_block`;
      break;
    }
    case "PositionsSplit":
      await tx("split", a.account as string, null, a.amount as bigint, 0n, a.amount as bigint, 0n);
      break;
    case "PositionsMerged":
      await tx("merge", a.account as string, null, 0n, a.amount as bigint, a.amount as bigint, 0n);
      break;
    case "LiquidityAdded":
      await tx("add_liquidity", a.provider as string, null, a.amount as bigint, 0n, a.lpShares as bigint, 0n);
      break;
    case "LiquidityRemoved":
      await tx("remove_liquidity", a.provider as string, null, 0n, (a.collateralOut as bigint) + (a.feesOut as bigint), a.lpShares as bigint, 0n);
      break;
    case "LpFeesClaimed":
      await tx("claim_fees", a.provider as string, null, 0n, a.amount as bigint, 0n, 0n);
      break;
    case "Redeemed":
      await tx("redeem", a.account as string, null, 0n, a.payout as bigint, (a.yesBurned as bigint) + (a.noBurned as bigint), 0n);
      break;
    case "OutcomeProposed":
      await sql`update markets set status = 'PROPOSED' where chain_id = ${chainId} and market_id = ${marketId} and status <> 'RESOLVED'`;
      await sql`update earnings_events set proposed_outcome = ${OUTCOME[Number(a.outcome)] ?? null}, evidence_uri = ${a.evidenceURI as string}
        where chain_id = ${chainId} and market_id = ${marketId}`;
      break;
    case "ProposalRejected":
      await sql`update markets set status = 'OPEN' where chain_id = ${chainId} and market_id = ${marketId} and status = 'PROPOSED'`;
      await sql`update earnings_events set proposed_outcome = null, evidence_uri = null where chain_id = ${chainId} and market_id = ${marketId}`;
      break;
    case "MarketResolved": {
      const outcome = OUTCOME[Number(a.outcome)] ?? "NONE";
      await sql`update markets set status = 'RESOLVED', outcome = ${outcome}, close_price_a = ${str(a.closePriceA) as string}, close_price_b = ${str(a.closePriceB) as string},
        resolved_at = ${time} where chain_id = ${chainId} and market_id = ${marketId}`;
      await sql`insert into market_outcomes (chain_id, market_id, outcome, close_price_a, close_price_b, round_a, round_b, tx_hash, log_index)
        values (${chainId}, ${marketId}, ${outcome}, ${str(a.closePriceA) as string}, ${str(a.closePriceB) as string}, ${str(a.roundA) as string}, ${str(a.roundB) as string}, ${base.tx}, ${base.li})
        on conflict do nothing`;
      break;
    }
    default:
      break;
  }
}

/** Recomputes derived per-(market, account) aggregates for accounts touched in this batch. */
export async function refreshPositions(sql: Sql, chainId: number, block: bigint, window = 4000n) {
  await sql`
    insert into positions (chain_id, market_id, account, cost_basis, proceeds, lp_shares, updated_block)
    select chain_id, market_id, account,
      coalesce(sum(collateral_in) filter (where action in ('buy','split')), 0),
      coalesce(sum(collateral_out) filter (where action in ('sell','merge','redeem')), 0),
      coalesce(sum(shares) filter (where action = 'add_liquidity'), 0) - coalesce(sum(shares) filter (where action = 'remove_liquidity'), 0),
      ${block.toString()}
    from transactions where chain_id = ${chainId}
      and (market_id, account) in (select market_id, account from transactions where chain_id = ${chainId} and block_number > ${(block - window).toString()})
    group by chain_id, market_id, account
    on conflict (chain_id, market_id, account) do update set cost_basis = excluded.cost_basis, proceeds = excluded.proceeds,
      lp_shares = excluded.lp_shares, updated_block = excluded.updated_block`;
}


export interface SyncOptions {
  chainId: number;
  markets: Address;
  deployBlock: bigint;
  /** stop after this many blocks in one call (keeps web requests short); 0 = until head */
  maxBlocks?: bigint;
  confirmations?: bigint;
  /** re-scan this many already-indexed blocks each time (covers explorer indexing lag; inserts are idempotent) */
  rescan?: bigint;
  /** explorer logs API override ("none" = RPC only) */
  logsApi?: string;
  /** when the explorer is unavailable, read at most this many blocks per call from the RPC (default 20k) */
  maxRpcBlocks?: bigint;
}

const blockTimes = new Map<bigint, Date>();

/** Indexes new StocMoonMarkets events since the last indexed block. Returns how far it got. */
export async function syncIndex(sql: Sql, client: PublicClient, o: SyncOptions): Promise<{ from: bigint; to: bigint; events: number; caughtUp: boolean }> {
  const key = o.markets.toLowerCase();
  const [state] = await sql<{ last_block: string }[]>`select last_block from indexer_state where chain_id = ${o.chainId} and contract = ${key}`;
  const rescan = o.rescan ?? 300n;
  const start = state ? (BigInt(state.last_block) + 1n - rescan > o.deployBlock ? BigInt(state.last_block) + 1n - rescan : o.deployBlock) : o.deployBlock;
  const head = (await client.getBlockNumber()) - (o.confirmations ?? 3n);
  const limit = o.maxBlocks && o.maxBlocks > 0n ? start + o.maxBlocks - 1n : head;
  let end = limit < head ? limit : head;
  if (end < start) return { from: start, to: end, events: 0, caughtUp: true };

  const got = await getContractLogsRange({
    client, chainId: o.chainId, address: o.markets, fromBlock: start, toBlock: end, logsApi: o.logsApi, maxRpcBlocks: o.maxRpcBlocks ?? 20_000n,
  });
  const logs = got.logs;
  end = got.toBlock;
  const decoded = parseEventLogs({ abi: stocMoonMarketsAbi, logs: logs as Log[], strict: false });
  const ts = new Map(logs.map((l) => [`${l.transactionHash}:${l.logIndex}`, l.timestamp]));
  for (const ev of decoded) {
    const t = ts.get(`${ev.transactionHash}:${ev.logIndex}`);
    if (t) blockTimes.set(ev.blockNumber, new Date(t * 1000));
    else if (!blockTimes.has(ev.blockNumber)) blockTimes.set(ev.blockNumber, new Date(Number((await client.getBlock({ blockNumber: ev.blockNumber })).timestamp) * 1000));
  }
  await sql.begin(async (tx) => {
    for (const ev of decoded) await applyEvent(tx as unknown as Sql, o.chainId, ev as Decoded, blockTimes.get(ev.blockNumber) ?? null);
    await tx`insert into indexer_state (chain_id, contract, last_block) values (${o.chainId}, ${key}, ${end.toString()})
      on conflict (chain_id, contract) do update set last_block = greatest(indexer_state.last_block, excluded.last_block), updated_at = now()`;
  });
  if (decoded.length) await refreshPositions(sql, o.chainId, end, end - start + 1n);
  if (blockTimes.size > 10_000) blockTimes.clear();
  return { from: start, to: end, events: decoded.length, caughtUp: end >= head };
}
