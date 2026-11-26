import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { erc20Abi, maxUint256, type Address } from "viem";
import {
  canScheduleIntraday, findSettlementProof, isRegularSession, mirrorAggregatorAbi, oracleAdapterAbi, stocMoonMarketsAbi,
} from "@stocmoon/core";
import { ROOT, deployment, env, log, optEnv, privateKey, sleep } from "./lib/env";
import { appClient, walletFor } from "./lib/clients";
import { listMarkets, recycleLiquidity } from "./lib/ops";

/**
 * StocMoon intraday operator — runs on any computer with Node.js (Windows, macOS, Linux):
 *
 *   pnpm operator
 *
 * Settings come from services/.env (see services/.env.example). During US regular trading hours it:
 *   1. publishes Alpaca IEX last-trade prices into each stock's intraday feed (every ~30s, plus a heartbeat)
 *   2. opens 5m–4H UP/DOWN markets that close inside the same session
 *   3. settles expired intraday markets with round proofs (the contract verifies them)
 *   4. withdraws its seed liquidity from resolved markets so the USDC is reused
 * Outside trading hours it only settles and recycles. Safe to stop and restart at any time.
 *
 * TESTNET trust assumption: the operator is the source of intraday prices (like the testnet Chainlink mirror).
 */
const envFile = join(ROOT, "services/.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

interface IntradayEntry {
  token: Address;
  intradayAsset: Address;
  feed: Address;
}

const ALPACA_DATA = process.env.ALPACA_DATA_URL || "https://data.alpaca.markets";
/** LOCAL TESTING ONLY: treat every moment as regular trading hours. */
const IGNORE_HOURS = process.env.INTRADAY_IGNORE_MARKET_HOURS === "true";
const inSession = (ms: number) => IGNORE_HOURS || isRegularSession(ms);
const canSchedule = (now: number, close: number) => IGNORE_HOURS || canScheduleIntraday(now, close);

async function alpacaLatest(symbols: string[]): Promise<Record<string, { p: number; t: number }>> {
  const url = `${ALPACA_DATA}/v2/stocks/trades/latest?symbols=${symbols.join(",")}&feed=${process.env.ALPACA_FEED || "iex"}`;
  const res = await fetch(url, {
    headers: { "APCA-API-KEY-ID": env("ALPACA_API_KEY_ID"), "APCA-API-SECRET-KEY": env("ALPACA_API_SECRET") },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`Alpaca rejected the API keys (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`Alpaca HTTP ${res.status}`);
  const body = (await res.json()) as { trades?: Record<string, { p?: number; t?: string }> };
  const out: Record<string, { p: number; t: number }> = {};
  for (const [sym, tr] of Object.entries(body.trades ?? {})) {
    if (tr.p && tr.p > 0 && tr.t) out[sym] = { p: tr.p, t: Math.floor(Date.parse(tr.t) / 1000) };
  }
  return out;
}

async function main() {
  const d = deployment();
  const file = join(ROOT, "contracts/deployments", `${d.chainId}-intraday.json`);
  if (!existsSync(file)) throw new Error(`${file} not found — run script/DeployIntraday.s.sol first`);
  const cfg = JSON.parse(readFileSync(file, "utf8")) as Record<string, IntradayEntry>;
  const symbols = Object.keys(cfg);
  const durations = (optEnv("INTRADAY_DURATIONS") ?? "300,900,3600").split(",").map(Number).sort((a, b) => a - b);
  const liquidity = BigInt(env("INTRADAY_LIQUIDITY", "5000000"));
  const pushEvery = Number(env("INTRADAY_PUSH_INTERVAL_MS", "30000"));
  const heartbeat = Number(env("INTRADAY_HEARTBEAT_S", "120"));
  const keeperEvery = Number(env("INTRADAY_KEEPER_INTERVAL_MS", "20000"));
  const key = process.env.OPERATOR_PRIVATE_KEY ? privateKey("OPERATOR_PRIVATE_KEY") : privateKey("KEEPER_PRIVATE_KEY");
  env("ALPACA_API_KEY_ID");
  env("ALPACA_API_SECRET");

  const client = appClient();
  const wallet = walletFor(key);
  const me = wallet.account.address;
  const pseudo = new Map(symbols.map((s) => [cfg[s]!.intradayAsset.toLowerCase(), s]));
  log("operator", "started", { operator: me, symbols, durations, liquidityUsdc: Number(liquidity) / 1e6 });

  const send = async (functionName: string, args: readonly unknown[], address: Address = d.markets, abi: readonly unknown[] = stocMoonMarketsAbi) => {
    const { request } = await client.simulateContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, account: wallet.account });
    const hash = await wallet.writeContract(request as never);
    const r = await client.waitForTransactionReceipt({ hash });
    log("operator", functionName, { args, tx: hash, status: r.status });
    return r.status === "success";
  };

  const allowance = await client.readContract({ address: d.usdc, abi: erc20Abi, functionName: "allowance", args: [me, d.markets] });
  if (allowance < liquidity * 100n) {
    const hash = await wallet.writeContract({ address: d.usdc, abi: erc20Abi, functionName: "approve", args: [d.markets, maxUint256], chain: wallet.chain, account: wallet.account });
    await client.waitForTransactionReceipt({ hash });
    log("operator", "approved USDC", { tx: hash });
  }

  // last published timestamp per symbol, from chain
  const lastTs: Record<string, number> = {};
  for (const s of symbols) {
    const round = await client.readContract({ address: cfg[s]!.feed, abi: mirrorAggregatorAbi, functionName: "latestRound" });
    lastTs[s] = round > 0n ? Number((await client.readContract({ address: cfg[s]!.feed, abi: mirrorAggregatorAbi, functionName: "latestRoundData" }))[3]) : 0;
  }

  async function publishPrices(blockTs: number) {
    const trades = await alpacaLatest(symbols);
    for (const s of symbols) {
      const tr = trades[s];
      if (!tr) continue;
      let updatedAt: number;
      if (tr.t > lastTs[s]!) updatedAt = Math.min(tr.t, blockTs);
      else if (blockTs - lastTs[s]! >= heartbeat) updatedAt = blockTs; // still the price in effect now
      else continue;
      if (updatedAt <= lastTs[s]!) continue;
      const answer = BigInt(Math.round(tr.p * 1e8));
      const ok = await send("pushRound", [BigInt(updatedAt), answer, BigInt(updatedAt), BigInt(updatedAt)], cfg[s]!.feed, mirrorAggregatorAbi).catch((e) => {
        log("operator", "push failed", { symbol: s, error: (e as Error).message.slice(0, 160) });
        return false;
      });
      if (ok) lastTs[s] = updatedAt;
    }
  }

  async function keeperTick(blockTs: number) {
    const markets = (await listMarkets(client, d.lens, d.markets)).filter((m) => pseudo.has(m.assetA.toLowerCase()));
    // settle
    for (const m of markets.filter((x) => x.status === "OPEN" && blockTs >= x.closeTime + x.settlementDelay)) {
      try {
        if (blockTs > m.closeTime + m.resolutionWindow) {
          await send("resolveInvalid", [BigInt(m.id)]);
          continue;
        }
        const p = await findSettlementProof(client, m.feedA, BigInt(m.closeTime));
        if (m.closeTime - Number(p.updatedAt) > m.maxStaleness) {
          log("operator", "no fresh price at close; market will become INVALID after the window", { id: m.id });
          continue;
        }
        await send("resolve", [BigInt(m.id), p.roundId, p.nextRoundId, 0n, 0n]);
      } catch (e) {
        log("operator", "resolve failed", { id: m.id, error: (e as Error).message.slice(0, 160) });
      }
    }
    // recycle seed liquidity
    await recycleLiquidity(client, d.markets, me, markets, (fn, args) => send(fn, args));
    // open new markets
    let balance = await client.readContract({ address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] });
    for (const dur of durations) {
      if (!canSchedule(blockTs * 1000, (blockTs + dur) * 1000)) continue;
      const [enabled] = await client.readContract({ address: d.markets, abi: stocMoonMarketsAbi, functionName: "durations", args: [dur] });
      if (!enabled) continue;
      for (const s of symbols) {
        const asset = cfg[s]!.intradayAsset;
        const open = markets.some((m) => m.assetA.toLowerCase() === asset.toLowerCase() && m.status === "OPEN" && blockTs < m.tradingEndsAt && m.closeTime - m.openTime === dur);
        if (open) continue;
        const fresh = await client.readContract({ address: d.oracleAdapter, abi: oracleAdapterAbi, functionName: "isTradable", args: [asset] });
        if (!fresh) continue;
        if (balance < liquidity) {
          log("operator", "not enough USDC to open more markets", { balanceUsdc: Number(balance) / 1e6 });
          return;
        }
        if (await send("createUpDownMarket", [asset, dur, liquidity]).catch((e) => (log("operator", "create failed", { symbol: s, dur, error: (e as Error).message.slice(0, 160) }), false))) {
          balance -= liquidity;
        }
      }
    }
  }

  let lastPush = 0;
  let lastKeep = 0;
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  let announcedClosed = false;
  while (!stop) {
    try {
      const blockTs = Number((await client.getBlock()).timestamp);
      const open = inSession(Date.now());
      if (!open && !announcedClosed) log("operator", "US market closed: settling and recycling only (prices resume 09:30 ET)");
      announcedClosed = !open;
      if (open && Date.now() - lastPush >= pushEvery) {
        lastPush = Date.now();
        await publishPrices(blockTs);
      }
      if (Date.now() - lastKeep >= keeperEvery) {
        lastKeep = Date.now();
        await keeperTick(Number((await client.getBlock()).timestamp));
      }
    } catch (e) {
      log("operator", "tick failed", { error: (e as Error).message.slice(0, 200) });
    }
    await sleep(2_000);
  }
  log("operator", "stopped");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
