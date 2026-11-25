# StocMoon — Development Checklist

Status legend: ✅ done and verified · 🟡 done in code, needs an external step · ⏳ not done yet

Verification notes: "verified" means exercised by automated tests and/or the local end-to-end run
(`scripts/local/e2e.sh`: two anvil chains, real deploy script, relayer, keeper, indexer, Postgres, `next start`).
The build environment could not reach the Coinbase API or Base RPC, so live-network items are 🟡.

## Phase 1 — Foundation
- ✅ Monorepo (contracts / packages/core / web / services / db), CI workflow
- ✅ Responsive UI: desktop sidebar, mobile bottom nav, trade panel directly under the chart on phones
- ✅ Wallet connection (RainbowKit + wagmi; injected + Coinbase Wallet, WalletConnect when a project id is set)
- ✅ Base / Base Sepolia network config
- ✅ Tokenized Stocks API client: cursor pagination, repeated-token guard, every field optional, contract-address
  identity, multiplier → share-equivalent supply, `paused_features`, missing NAV ≠ price (unit tested)
- 🟡 Live Coinbase API data in the app — code path verified against a fixture with the documented shape; live
  endpoint not reachable from the build environment
- ✅ Stale-data fallback: in-memory last-good → Postgres → "unavailable" banner (verified by killing the API)
- ✅ Stock discovery: popular, gainers, losers (only when verifiable), recent, A–Z, search, categories, tradable filter
- ✅ Stock pages + Lightweight Charts with only data-backed timeframes enabled

## Phase 2 — Core market engine
- ✅ `StocMoonMarkets`: UP/DOWN markets, allowlisted durations, USDC collateral, ERC-1155 outcome shares
- ✅ `OracleAdapter`: freshness, positive answers, round-proof settlement incl. Chainlink phase boundaries
- ✅ Settlement methodology incl. tie = PUSH and INVALID fallback (docs/ARCHITECTURE.md)
- ✅ `MirrorAggregator` + relayer for testnet reference prices (auditable source round ids)
- 🟡 Base mainnet Chainlink feed list — only AAPL/AMZN addresses found; `pnpm assets:sync` verifies before use.
  Add the remaining feeds from the official Base/Chainlink tables
- ✅ Keeper opens markets only inside 24/5 feed sessions (NYSE holidays included); settles with proofs

## Phase 3 — AMM & portfolio
- ✅ Native FPMM (buy, sell = early exit, add/remove liquidity, LP fee accumulator, protocol fees, 5% fee cap)
- ✅ Slippage (`minSharesOut` / `minAmountOut`), deadlines, quotes via `StocMoonLens`
- ✅ Claims (redeem), double-claim protection, LP withdrawals always open
- ✅ Portfolio: open / pending settlement / claimable / closed, history, realised P&L from events, explorer links

## Phase 4 — Differentiation
- ✅ Stock Battles (percentage-return comparison, exact cross-multiplication), 24H/7D/30D
- ✅ Earnings / event markets: propose → dispute window → finalize; `create-event` admin CLI
- 🟡 No earnings markets created — each needs a real, verifiable source; none are invented
- ✅ Leaderboards (daily/weekly/monthly/all-time, realised P&L or accuracy, minimums against manipulation)
- ✅ Profiles (signed username/avatar, replay-protected), public profile stats
- ✅ Share cards (`/api/og/market/:id`) and share links

## Phase 5 — Testing & deployment
- ✅ 68 Foundry tests (unit, fuzz, invariant, reentrancy, access control, oracle edge cases); 97% line coverage on the hub
- ✅ 20 TypeScript unit tests (API client, calendar, settlement search, formatting)
- ✅ Local end-to-end: deploy → relay → keeper creates 5 markets → user trades → settlement → redeem → indexer → stats
- ✅ Compliance flows verified: US blocked (451), signed attestation, nonce replay rejected, bad signature rejected
- 🟡 Base Sepolia deployment — needs a funded deployer key (see README "Deploy")
- 🟡 Basescan verification — `forge script ... --verify` with `ETHERSCAN_API_KEY`
- ⏳ External security audit (contracts are unaudited)
- ⏳ Legal/compliance review before any real-money use

## Deliberate deviations from the original brief
- **Redis**: not used. Caching is an in-process TTL cache with single-flight + Postgres persistence; add Redis when
  running multiple web instances.
- **shadcn/ui**: components follow shadcn conventions (Radix + cva + tailwind-merge) but were written by hand because
  the shadcn registry was not reachable from the build environment.
- **Contract layout**: `MarketFactory/PredictionMarket/AMM/SettlementManager/PositionManager/FeeManager` are merged into
  one audited-surface hub (`StocMoonMarkets`) + `OracleAdapter` + `StocMoonLens`. One USDC approval, one indexer target,
  no cross-contract trust between factory and markets.
- **pm-AMM**: not used (Solana-only). FPMM is isolated in `FPMMMath` so pricing can be swapped later.
- **`user_preferences` / `leaderboard_records` tables**: dropped — nothing writes them; leaderboard is computed live.
