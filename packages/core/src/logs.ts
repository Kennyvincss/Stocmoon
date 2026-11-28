import type { Address, Hex, Log, PublicClient } from "viem";

/**
 * Contract event history. Public Base RPCs cap eth_getLogs to small block ranges (Base Sepolia: 200 blocks), so
 * history is read from the chain's Blockscout explorer API (no key, no range limit, includes timestamps) and falls
 * back to the RPC in adaptively sized chunks. Results are viem-compatible logs, oldest first.
 */
export const LOGS_APIS: Record<number, string> = {
  84532: "https://base-sepolia.blockscout.com/api",
  8453: "https://base.blockscout.com/api",
};

export interface LogsQuery {
  client: PublicClient;
  chainId: number;
  address: Address;
  fromBlock: bigint;
  toBlock: bigint;
  /** topics[0..3]; null = any */
  topics?: (Hex | null)[];
  /** explorer API base (default per chain); "none" disables it */
  logsApi?: string;
  rpcChunk?: bigint;
}

export interface TimedLog extends Log {
  /** unix seconds when the explorer provided it */
  timestamp?: number;
}

interface ExplorerLog {
  address: string;
  topics: (string | null)[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  timeStamp: string;
}

const hexNum = (h: string) => (h && h !== "0x" ? Number(BigInt(h)) : 0);

async function fromExplorer(api: string, q: LogsQuery): Promise<TimedLog[]> {
  const out: TimedLog[] = [];
  const seen = new Set<string>();
  let from = q.fromBlock;
  for (let page = 0; page < 200; page++) {
    const u = new URL(api);
    u.searchParams.set("module", "logs");
    u.searchParams.set("action", "getLogs");
    u.searchParams.set("address", q.address);
    u.searchParams.set("fromBlock", from.toString());
    u.searchParams.set("toBlock", q.toBlock.toString());
    const topics = q.topics ?? [];
    const set = topics.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    for (const i of set) u.searchParams.set(`topic${i}`, topics[i]!);
    for (let a = 0; a < set.length; a++) {
      for (let b = a + 1; b < set.length; b++) u.searchParams.set(`topic${set[a]}_${set[b]}_opr`, "and");
    }
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`explorer logs HTTP ${res.status}`);
    const body = (await res.json()) as { status: string; message: string; result: ExplorerLog[] | null };
    const rows = Array.isArray(body.result) ? body.result : [];
    if (body.status !== "1" && rows.length === 0 && !/no logs found/i.test(body.message)) {
      throw new Error(`explorer logs: ${body.message}`);
    }
    for (const r of rows) {
      const key = `${r.transactionHash}:${r.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        address: r.address as Address,
        topics: r.topics.filter((t): t is string => Boolean(t)) as [Hex, ...Hex[]],
        data: r.data as Hex,
        blockNumber: BigInt(r.blockNumber),
        blockHash: null,
        transactionHash: r.transactionHash as Hex,
        transactionIndex: hexNum(r.transactionIndex),
        logIndex: hexNum(r.logIndex),
        removed: false,
        timestamp: hexNum(r.timeStamp),
      } as unknown as TimedLog);
    }
    if (rows.length < 1000) break; // last page
    const last = BigInt(rows[rows.length - 1]!.blockNumber);
    if (last <= from) break;
    from = last; // continue from the last block (duplicates are skipped)
  }
  return out.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);
}

async function fromRpc(q: LogsQuery): Promise<TimedLog[]> {
  let chunk = q.rpcChunk ?? 2_000n;
  const out: TimedLog[] = [];
  for (let from = q.fromBlock; from <= q.toBlock; ) {
    const to = from + chunk - 1n > q.toBlock ? q.toBlock : from + chunk - 1n;
    try {
      const logs = await q.client.getLogs({ address: q.address, fromBlock: from, toBlock: to, topics: q.topics as never } as never);
      out.push(...(logs as TimedLog[]));
      from = to + 1n;
    } catch (e) {
      // e.g. "eth_getLogs is limited to a 200 range" -> shrink and retry
      const m = /limited to a (\d+)/i.exec((e as Error).message ?? "");
      const next = m ? BigInt(m[1]!) : chunk / 4n;
      if (next >= chunk || next < 1n) throw e;
      chunk = next;
    }
  }
  return out;
}

export async function getContractLogs(q: LogsQuery): Promise<TimedLog[]> {
  return (await getContractLogsRange(q)).logs;
}

/**
 * Like getContractLogs, but when it has to fall back to the RPC it reads at most `maxRpcBlocks` blocks and reports
 * the block it actually reached, so callers (the indexer) can continue next time instead of hanging.
 */
export async function getContractLogsRange(q: LogsQuery & { maxRpcBlocks?: bigint }): Promise<{ logs: TimedLog[]; toBlock: bigint }> {
  if (q.toBlock < q.fromBlock) return { logs: [], toBlock: q.toBlock };
  const api = q.logsApi === "none" ? undefined : (q.logsApi ?? LOGS_APIS[q.chainId]);
  if (api) {
    try {
      return { logs: await fromExplorer(api, q), toBlock: q.toBlock };
    } catch {
      /* fall back to the RPC */
    }
  }
  const cap = q.maxRpcBlocks && q.fromBlock + q.maxRpcBlocks - 1n < q.toBlock ? q.fromBlock + q.maxRpcBlocks - 1n : q.toBlock;
  return { logs: await fromRpc({ ...q, toBlock: cap }), toBlock: cap };
}
