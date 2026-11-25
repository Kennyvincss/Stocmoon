import { publicEnv } from "../public-env";
import { db } from "./db";

export type Period = "daily" | "weekly" | "monthly" | "all";
export type SortKey = "pnl" | "accuracy";

export interface LeaderRow {
  rank: number;
  account: string;
  username: string | null;
  avatarUrl: string | null;
  resolvedMarkets: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  volume: string;
  realizedPnl: string;
}

const INTERVALS: Record<Period, string | null> = { daily: "1 day", weekly: "7 days", monthly: "30 days", all: null };

/** Minimums to be ranked (anti-manipulation). */
export const MIN_RESOLVED = 3;
export const MIN_VOLUME = 10_000_000n; // 10 USDC

/**
 * Realised-only leaderboard from indexed onchain events. Only RESOLVED markets count; LP activity is excluded;
 * direction = side with the larger net share purchase; PUSH/INVALID markets don't count toward accuracy.
 */
export async function leaderboard(period: Period, sort: SortKey): Promise<{ rows: LeaderRow[]; available: boolean }> {
  const sql = db();
  if (!sql) return { rows: [], available: false };
  const interval = INTERVALS[period];
  const rows = await sql<{
    account: string; username: string | null; avatar_url: string | null; resolved: number; correct: number; incorrect: number;
    volume: string; pnl: string;
  }[]>`
    with per as (
      select t.account, t.market_id, m.outcome,
        coalesce(sum(t.collateral_in) filter (where t.action in ('buy','split')), 0) as cost,
        coalesce(sum(t.collateral_out) filter (where t.action in ('sell','merge','redeem')), 0) as proceeds,
        coalesce(sum(t.collateral_in) filter (where t.action = 'buy'), 0) as volume,
        coalesce(sum(case when t.action = 'buy' and t.side = 'YES' then t.shares when t.action = 'sell' and t.side = 'YES' then -t.shares else 0 end), 0) as net_yes,
        coalesce(sum(case when t.action = 'buy' and t.side = 'NO' then t.shares when t.action = 'sell' and t.side = 'NO' then -t.shares else 0 end), 0) as net_no
      from transactions t
      join markets m on m.chain_id = t.chain_id and m.market_id = t.market_id
      where t.chain_id = ${publicEnv.chainId}
        and m.status = 'RESOLVED'
        and t.action in ('buy','sell','split','merge','redeem')
        and (${interval}::interval is null or m.resolved_at >= now() - ${interval}::interval)
      group by t.account, t.market_id, m.outcome
    ),
    scored as (
      select *, case when net_yes > net_no then 'YES' when net_no > net_yes then 'NO' else null end as side from per
    )
    select s.account, u.username, u.avatar_url,
      count(*)::int as resolved,
      count(*) filter (where s.side is not null and s.outcome in ('YES','NO') and s.side = s.outcome)::int as correct,
      count(*) filter (where s.side is not null and s.outcome in ('YES','NO') and s.side <> s.outcome)::int as incorrect,
      sum(s.volume)::text as volume,
      sum(s.proceeds - s.cost)::text as pnl
    from scored s left join users u on u.address = s.account
    group by s.account, u.username, u.avatar_url
    having count(*) >= ${MIN_RESOLVED} and sum(s.volume) >= ${MIN_VOLUME.toString()}::numeric
    limit 500`;
  const mapped = rows.map((r) => {
    const decided = r.correct + r.incorrect;
    return {
      rank: 0, account: r.account, username: r.username, avatarUrl: r.avatar_url, resolvedMarkets: r.resolved, correct: r.correct,
      incorrect: r.incorrect, accuracy: decided ? r.correct / decided : null, volume: r.volume.split(".")[0]!, realizedPnl: r.pnl.split(".")[0]!,
    };
  });
  mapped.sort((a, b) =>
    sort === "accuracy"
      ? (b.accuracy ?? -1) - (a.accuracy ?? -1) || Number(BigInt(b.realizedPnl) - BigInt(a.realizedPnl))
      : Number(BigInt(b.realizedPnl) - BigInt(a.realizedPnl)),
  );
  mapped.forEach((r, i) => (r.rank = i + 1));
  return { rows: mapped.slice(0, 100), available: true };
}

/** Verified stats for one account (no ranking minimums). */
export async function userStats(account: string) {
  const sql = db();
  if (!sql) return null;
  const [row] = await sql<{ markets: number; resolved: number; correct: number; incorrect: number; pnl: string | null; volume: string | null }[]>`
    with per as (
      select t.market_id, m.status, m.outcome,
        coalesce(sum(t.collateral_in) filter (where t.action in ('buy','split')), 0) as cost,
        coalesce(sum(t.collateral_out) filter (where t.action in ('sell','merge','redeem')), 0) as proceeds,
        coalesce(sum(t.collateral_in) filter (where t.action = 'buy'), 0) as volume,
        coalesce(sum(case when t.action = 'buy' and t.side = 'YES' then t.shares when t.action = 'sell' and t.side = 'YES' then -t.shares else 0 end), 0) as net_yes,
        coalesce(sum(case when t.action = 'buy' and t.side = 'NO' then t.shares when t.action = 'sell' and t.side = 'NO' then -t.shares else 0 end), 0) as net_no
      from transactions t join markets m on m.chain_id = t.chain_id and m.market_id = t.market_id
      where t.chain_id = ${publicEnv.chainId} and t.account = ${account.toLowerCase()}
        and t.action in ('buy','sell','split','merge','redeem')
      group by t.market_id, m.status, m.outcome
    ), scored as (
      select *, case when net_yes > net_no then 'YES' when net_no > net_yes then 'NO' else null end as side from per
    )
    select count(*)::int as markets,
      count(*) filter (where status = 'RESOLVED')::int as resolved,
      count(*) filter (where status = 'RESOLVED' and outcome in ('YES','NO') and side = outcome)::int as correct,
      count(*) filter (where status = 'RESOLVED' and outcome in ('YES','NO') and side is not null and side <> outcome)::int as incorrect,
      (sum(proceeds - cost) filter (where status = 'RESOLVED'))::text as pnl,
      sum(volume)::text as volume
    from scored`;
  if (!row) return null;
  const decided = row.correct + row.incorrect;
  return {
    markets: row.markets, resolved: row.resolved, correct: row.correct, incorrect: row.incorrect,
    accuracy: decided ? row.correct / decided : null,
    realizedPnl: (row.pnl ?? "0").split(".")[0]!, volume: (row.volume ?? "0").split(".")[0]!,
  };
}
