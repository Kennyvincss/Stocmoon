import { erc20Abi, getAddress, maxUint256, type Address } from "viem";
import {
  canScheduleMarket, findSettlementProof, normalizeMarket, oracleAdapterAbi, stocMoonLensAbi, stocMoonMarketsAbi,
  type MarketData, type RawMarket,
} from "@stocmoon/core";
import { deployment, env, log, loop, optEnv, privateKey } from "./lib/env";
import { appClient, walletFor } from "./lib/clients";

/**
 * Keeper:
 *  - opens rolling UP/DOWN markets per (asset, duration) only when the feed is fresh AND the close falls in a feed session
 *  - opens configured battles (KEEPER_BATTLES="0xA:0xB:86400,...")
 *  - settles expired markets with the round proof (the contract verifies it), invalidates past the resolution window
 *  - finalizes event-market proposals after the dispute window
 * The keeper has MARKET_CREATOR_ROLE only; it cannot change existing markets.
 */
const DURATIONS = (optEnv("KEEPER_DURATIONS") ?? "86400,604800").split(",").map(Number);
const LIQUIDITY = BigInt(env("KEEPER_LIQUIDITY", "50000000")); // 50 USDC
const BATTLES = (optEnv("KEEPER_BATTLES") ?? "").split(",").filter(Boolean).map((s) => {
  const [a, b, dur] = s.split(":");
  return { a: getAddress(a!.toLowerCase()) as Address, b: getAddress(b!.toLowerCase()) as Address, duration: Number(dur) };
});

async function main() {
  const d = deployment();
  const client = appClient();
  const wallet = walletFor(privateKey("KEEPER_PRIVATE_KEY"));
  const me = wallet.account.address;
  const send = async (functionName: string, args: readonly unknown[]) => {
    const { request } = await client.simulateContract({ address: d.markets, abi: stocMoonMarketsAbi, functionName: functionName as never, args: args as never, account: wallet.account });
    const hash = await wallet.writeContract(request as never);
    const r = await client.waitForTransactionReceipt({ hash });
    log("keeper", functionName, { args, tx: hash, status: r.status });
    return r.status === "success";
  };

  const allowance = await client.readContract({ address: d.usdc, abi: erc20Abi, functionName: "allowance", args: [me, d.markets] });
  if (allowance < LIQUIDITY * 100n) {
    const hash = await wallet.writeContract({ address: d.usdc, abi: erc20Abi, functionName: "approve", args: [d.markets, maxUint256], chain: wallet.chain, account: wallet.account });
    await client.waitForTransactionReceipt({ hash });
    log("keeper", "approved collateral", { tx: hash });
  }

  await loop("keeper", Number(env("KEEPER_INTERVAL_MS", "30000")), async () => {
    // chain time is what the contract enforces
    const now = Number((await client.getBlock()).timestamp);
    const count = Number(await client.readContract({ address: d.markets, abi: stocMoonMarketsAbi, functionName: "marketCount" }));
    const views = count
      ? ((await client.readContract({ address: d.lens, abi: stocMoonLensAbi, functionName: "listMarkets", args: [0n, 200n] })) as readonly {
          id: bigint; market: RawMarket; priceYes: bigint; yesSupply: bigint; noSupply: bigint;
        }[])
      : [];
    const markets: MarketData[] = views.map((v) => normalizeMarket(v.id, v.market, v));

    // ---- settlement
    for (const m of markets) {
      if (m.status === "OPEN" && m.kind !== "EVENT" && now >= m.closeTime + m.settlementDelay) {
        if (now > m.closeTime + m.resolutionWindow) {
          await send("resolveInvalid", [BigInt(m.id)]).catch((e) => log("keeper", "invalidate failed", { id: m.id, error: (e as Error).message }));
          continue;
        }
        try {
          const a = await findSettlementProof(client, m.feedA, BigInt(m.closeTime));
          const b = m.kind === "BATTLE" ? await findSettlementProof(client, m.feedB, BigInt(m.closeTime)) : null;
          const staleA = m.closeTime - Number(a.updatedAt) > m.maxStaleness;
          const staleB = b ? m.closeTime - Number(b.updatedAt) > m.maxStaleness : false;
          if (staleA || staleB) {
            log("keeper", "close price stale; waiting for resolution window", { id: m.id });
            continue;
          }
          await send("resolve", [BigInt(m.id), a.roundId, a.nextRoundId, b?.roundId ?? 0n, b?.nextRoundId ?? 0n]);
        } catch (e) {
          log("keeper", "resolve failed", { id: m.id, error: (e as Error).message.slice(0, 200) });
        }
      }
      if (m.status === "PROPOSED" && now >= m.proposedAt + m.disputeWindow) {
        await send("finalizeOutcome", [BigInt(m.id)]).catch(() => {});
      }
    }

    // ---- rolling market creation
    const balance = await client.readContract({ address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] });
    const assetCount = await client.readContract({ address: d.oracleAdapter, abi: oracleAdapterAbi, functionName: "assetCount" });
    const assets: Address[] = [];
    for (let i = 0n; i < assetCount; i++) assets.push(await client.readContract({ address: d.oracleAdapter, abi: oracleAdapterAbi, functionName: "assetAt", args: [i] }));
    const onlyAssets = optEnv("KEEPER_ASSETS")?.toLowerCase().split(",");
    let budget = balance;

    const open = (pred: (m: MarketData) => boolean) => markets.some((m) => m.status === "OPEN" && now < m.tradingEndsAt && pred(m));
    for (const asset of assets) {
      if (onlyAssets && !onlyAssets.includes(asset.toLowerCase())) continue;
      const tradable = await client.readContract({ address: d.oracleAdapter, abi: oracleAdapterAbi, functionName: "isTradable", args: [asset] });
      if (!tradable) continue;
      for (const duration of DURATIONS) {
        const [enabled] = await client.readContract({ address: d.markets, abi: stocMoonMarketsAbi, functionName: "durations", args: [duration] });
        if (!enabled) continue;
        if (open((m) => m.kind === "UP_DOWN" && m.assetA.toLowerCase() === asset.toLowerCase() && m.closeTime - m.openTime === duration)) continue;
        if (!canScheduleMarket(now * 1000, (now + duration) * 1000)) continue;
        if (budget < LIQUIDITY) {
          log("keeper", "insufficient USDC for new market", { balance: budget });
          return;
        }
        if (await send("createUpDownMarket", [asset, duration, LIQUIDITY]).catch((e) => (log("keeper", "create failed", { error: (e as Error).message.slice(0, 200) }), false))) {
          budget -= LIQUIDITY;
        }
      }
    }
    for (const bt of BATTLES) {
      if (open((m) => m.kind === "BATTLE" && m.assetA.toLowerCase() === bt.a.toLowerCase() && m.assetB.toLowerCase() === bt.b.toLowerCase() && m.closeTime - m.openTime === bt.duration)) continue;
      if (!canScheduleMarket(now * 1000, (now + bt.duration) * 1000) || budget < LIQUIDITY) continue;
      if (await send("createBattleMarket", [bt.a, bt.b, bt.duration, LIQUIDITY]).catch((e) => (log("keeper", "battle create failed", { error: (e as Error).message.slice(0, 200) }), false))) budget -= LIQUIDITY;
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
