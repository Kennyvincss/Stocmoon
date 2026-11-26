# StocMoon

**Programmable stock markets on Base.** Pick a tokenized stock, call **UP** or **DOWN**, choose a duration, and settle
onchain against Chainlink reference prices — USDC in, USDC out.

Built for the **Base Stocks Maxxing** hackathon, *Programmable Stock Markets* track.

> StocMoon is independent and not affiliated with or endorsed by Base, Coinbase, Moon, Chainlink, Circle or any stock
> issuer. The current target is **Base Sepolia testnet**: test USDC and outcome shares have no monetary value.
> Not available to US persons or restricted jurisdictions.

## What it does

| Feature | How |
| --- | --- |
| Stock discovery | Real Coinbase-issued B20 tokens from the public [Base Tokenized Stocks API](https://docs.base.org/sdks/tokenized-stocks/overview), paginated, identified by contract address |
| UP/DOWN markets | Binary markets on a stock's Chainlink **reference price** (underlying × multiplier). UP wins if close > open, DOWN if lower, tie = push |
| Onchain AMM | Fixed-product market maker over YES/NO shares, 1:1 USDC-backed ERC-1155 outcome tokens, slippage + deadline protection |
| Early exit | Sell shares back to the AMM until trading closes |
| Settlement | Permissionless: anyone submits the feed round in effect at close; the contract verifies it. Stale/unavailable price ⇒ INVALID (0.50/share) |
| Stock Battles | Two stocks, higher **percentage** return wins (exact cross-multiplication onchain) |
| Earnings markets | YES/NO with fixed public source, resolver + dispute window |
| Portfolio & leaderboard | Positions read from chain; realised P&L, accuracy and rankings from indexed events only |
| Compliance | Geo-blocking (US + sanctioned by default), signed eligibility attestation, optional onchain allowlist |

## Repository layout

```
contracts/         Foundry: StocMoonMarkets, OracleAdapter, StocMoonLens, MirrorAggregator, FPMMMath + tests + deploy script
packages/core/     Shared TS: Tokenized Stocks API client, feed calendar, settlement proofs, market helpers, ABIs
web/               Next.js 16 app (UI + API routes)
services/          Node services: migrate, assets:sync, indexer, keeper, relayer, snapshotter, create-event
db/migrations/     PostgreSQL schema (Supabase compatible)
docs/              RESEARCH.md · ARCHITECTURE.md · CHECKLIST.md
scripts/local/     Local end-to-end harness (two anvil chains + synthetic fixture API)
```

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the component diagram and the full **settlement methodology**,
[`docs/RESEARCH.md`](docs/RESEARCH.md) for what was verified (and what wasn't), and
[`docs/CHECKLIST.md`](docs/CHECKLIST.md) for feature status.

## Smart contracts

| Contract | Role |
| --- | --- |
| `StocMoonMarkets` | Market creation (UP/DOWN, battle, event), FPMM trading, liquidity, settlement, redemption, fees, pause, eligibility. All settlement parameters are snapshotted per market and immutable |
| `OracleAdapter` | Asset registry (B20 token address → feed), freshness checks, round-proof validation (`priceAt`) incl. Chainlink phase boundaries |
| `StocMoonLens` | Read-only quotes (same math as execution), paginated market lists, positions |
| `MirrorAggregator` | **Testnet only.** AggregatorV3 mirror of a Base mainnet Chainlink feed, written by a relayer; every round stores its mainnet round id |
| `FPMMMath` | Pool-favouring FPMM buy/sell math |

Roles: `CONFIG_ROLE` (new-market parameters only), `MARKET_CREATOR_ROLE` (keeper), `RESOLVER_ROLE` (event proposals),
`GUARDIAN_ROLE` (pause new risk, reject event proposals in the dispute window, emergency-invalidate — all evented),
`ELIGIBILITY_ROLE`, `TREASURY_ROLE`. Exits (redeem, merge, withdraw liquidity) are never blocked; after the
resolution window anyone can invalidate an unsettled market, so funds can't be locked.

Tests: **68 Foundry tests** — unit, fuzz (round-trip never profits, sell-math invariant, payouts ≤ collateral),
invariants (shares fully backed, solvency), reentrancy via ERC-1155 hooks, stale/invalid/phase-boundary oracle data,
access control, paused markets, double claims.

```bash
cd contracts
forge test                 # all suites
forge coverage --ir-minimum --report summary
```

## Getting started

Requirements: Node ≥ 20, pnpm 10, Foundry, PostgreSQL 15+ (optional but needed for history, leaderboard, profiles).

```bash
git clone --recurse-submodules <repo> && cd stocmoon
pnpm install
pnpm contracts:test && pnpm -r test
cp web/.env.example web/.env.local      # fill in addresses after deploying
pnpm dev                                # http://localhost:3000
```

### Run the full stack locally (no testnet needed)

```bash
createdb stocmoon_e2e
DATABASE_URL=postgres://localhost/stocmoon_e2e scripts/local/e2e.sh
```

This starts two anvil chains (app chain + a stand-in "mainnet" with mock Chainlink feeds), deploys StocMoon with the real
deploy script, mirrors prices with the relayer, lets the keeper open markets, and indexes events. It uses **synthetic
fixture tokens** (`FIXTA`, `FIXTB`, …) — never point a public deployment at the fixture server.

## Deploy to Base Sepolia

1. **Fund wallets** — deployer, keeper and relayer need Base Sepolia ETH; the keeper needs test USDC
   ([faucet.circle.com](https://faucet.circle.com)) to seed market liquidity.
2. **Verify feeds and build the asset list** (reads the live API and Base mainnet):
   ```bash
   MAINNET_RPC_URL=https://mainnet.base.org pnpm assets:sync   # writes contracts/config/assets.json
   ```
   Add feed proxies to `contracts/config/feeds.base-mainnet.json` from the official
   [Base](https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base) /
   [Chainlink](https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase) tables. The sync rejects feeds whose
   description, freshness or price don't match the API.
3. **Deploy & verify**:
   ```bash
   cd contracts && cp .env.example .env && source .env
   cast wallet import deployer --interactive
   forge script script/Deploy.s.sol --rpc-url base_sepolia --account deployer --broadcast --verify
   ```
   Addresses are written to `contracts/deployments/84532.json`.
4. **Database**: `DATABASE_URL=... pnpm db:migrate`
5. **Services** (long-running; see `services/.env.example`):
   ```bash
   pnpm relayer      # mirror mainnet Chainlink rounds to testnet (RELAYER_PRIVATE_KEY)
   pnpm keeper       # open rolling markets + settle (KEEPER_PRIVATE_KEY)
   pnpm indexer      # events -> Postgres
   pnpm snapshotter  # API NAV history -> Postgres
   ```
6. **Web**: set `NEXT_PUBLIC_*` addresses from the deployment file, then `pnpm build && pnpm --filter web start`
   (or deploy `web/` to Vercel; Vercel's `x-vercel-ip-country` header powers geo-blocking).

## Environment variables

| Where | Variable | Purpose |
| --- | --- | --- |
| web (public) | `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_MARKETS_ADDRESS`, `NEXT_PUBLIC_LENS_ADDRESS`, `NEXT_PUBLIC_ORACLE_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS` | Contracts (no secrets) |
| web (public) | `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_APP_URL` | Wallet transport, WalletConnect, share links |
| web (server) | `RPC_URL`, `MAINNET_RPC_URL`, `DATABASE_URL`, `DEPLOY_BLOCK` | Reads, history, persistence |
| web (server) | `PYTH_API_KEY` | Optional: live second-by-second chart prices (display only). Without it the chart shows the Chainlink reference price |
| web (server) | `BLOCKED_COUNTRIES`, `ALLOW_UNKNOWN_COUNTRY`, `ELIGIBILITY_SIGNER_PRIVATE_KEY`, `IP_HASH_SALT` | Compliance |
| services | `KEEPER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `KEEPER_*`, `INDEXER_*`, `RELAYER_*` | See `services/.env.example` |
| contracts | `ETHERSCAN_API_KEY`, `USDC_ADDRESS`, `KEEPER_ADDRESS`, `RELAYER_ADDRESS`, `ENABLE_SHORT_DURATIONS` | See `contracts/.env.example` |

Private keys live only in server/service environments — never in `NEXT_PUBLIC_*` variables or the repo.

## API routes (web)

`GET /api/stocks` · `GET /api/stocks/:address` · `GET /api/stocks/:address/history?range=1H|4H|1D|1W|1M|1Y` ·
`GET /api/markets?kind=&asset=&phase=` · `GET /api/markets/:id` · `GET /api/markets/:id/proof` · `GET /api/config` ·
`GET /api/portfolio/:address` · `GET /api/leaderboard?period=&sort=` · `GET /api/users/:address` ·
`GET|POST /api/eligibility` · `GET|POST /api/profile` · `GET /api/tokens/:id` (ERC-1155 metadata) ·
`GET /api/og/market/:id` (share card) · `GET /api/health`

All inputs are validated (zod / address checks), routes are rate-limited per IP, signed requests are nonce-protected.

## Known limitations

- **Reference price ≠ execution price.** Settlement uses Chainlink's tokenized-equity Total Return Value.
- **Market hours.** Feeds are 24/5 and freeze on weekends, holidays and corporate-action pauses. The keeper only opens
  markets that close inside a feed session; the contract's staleness bound is the hard guarantee (else INVALID).
- **Only 24H / 7D / 30D markets are enabled by default.** Chainlink's Coinbase feeds update on a 0.5% move or a 24h
  heartbeat, so 1H/4H markets would usually settle on the opening round (push). Enable them with
  `ENABLE_INTRADAY_DURATIONS=true` (and 5m–30m with `ENABLE_SHORT_DURATIONS=true`) only if that trade-off is acceptable.
- **Testnet price mirror is a trust assumption** (relayer key). Every mirrored round is auditable against mainnet.
- **13 stocks** have verified feeds (`contracts/config/assets.json`). COIN has a Chainlink feed but no token in the
  Tokenized Stocks API; the 24/7 smoothed feeds are excluded because their off-hours methodology differs.
- **Website gating isn't contract gating.** Enable `setEligibilityRequired(true)` to enforce eligibility onchain.
- **Unaudited contracts**; LP withdrawals may return part of the position as outcome shares.
- Pagination limit of the API isn't officially documented; the client uses `page_size=100` and follows cursors.
- Caching is in-process (add Redis for multi-instance deployments).
