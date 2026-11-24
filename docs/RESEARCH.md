# StocMoon — Technical Feasibility Research

Date of research: 2026-11-24. Track: **Base Stocks Maxxing — Programmable Stock Markets**.

This document records what was verified, from which source, and what is still unverified.
Anything marked **UNVERIFIED** must be checked against the primary source before mainnet use.

> Research constraint: the build environment could not reach `docs.base.org`, `api.coinbase.com`
> or Base RPC directly. Chainlink's docs were read verbatim from the official
> `smartcontractkit/documentation` GitHub repository. Base docs facts were gathered from search
> snippets of the official pages (URLs listed). Every integration in code reads the live source at
> runtime — nothing below is hardcoded as a substitute for live data.

---

## A. Base Stocks Maxxing requirements

Sources: <https://www.base.org/stocksmaxxing>, <https://cryptobriefing.com/base-tokenized-stock-builder-competition/>

| Item | Finding |
| --- | --- |
| Timeline | Applications open Nov 5 2026; build/launch Nov 13 – Dec 5; submissions due **Dec 5 2026** |
| Tracks | Meme & Community Economies · Agentic Stock Finance · **Programmable Stock Markets** |
| Judging | **50% traction (real onchain usage)**, 25% product, 25% build-in-public |
| Eligibility | 18+; teams with previously launched tokens need a demonstrable stock-linked product |
| US users | Project brief states products enabling trading for US users are not eligible. The official rules PDF was not retrievable here — **UNVERIFIED wording**; StocMoon blocks US by default regardless. |

Implication: traction counts real onchain usage, so the product must work on Base for real users.
We ship testnet first (Base Sepolia, chain 84532) and keep the contracts mainnet-ready (Base, 8453).

## B. Base Tokenized Stocks API

Sources: <https://docs.base.org/sdks/tokenized-stocks/overview>,
<https://docs.base.org/sdks/tokenized-stocks/api-reference/list-tokenized-stocks>,
<https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base>

- Base URL: `https://api.coinbase.com/v1/tokenized-stocks` — public, read-only, **no API key**.
- Response: `{ "tokens": [ ... ], "next_page_token": "..." }`.
- Pagination: cursor based. Pass `next_page_token` as `page_token`; continue until `next_page_token`
  is absent. `page_size` default 100 (docs PR states max not published; one source says capped at 500).
  Malformed `page_size`/cursor → HTTP 400.
- Token fields seen in the reference: `contract_address`, `symbol`, `name`, `decimals`, `icon_url`,
  `total_supply`, `multiplier`, `nav_price`, `nav_price_updated_at`, `paused_features` (int array),
  `first_mint_date`, ISIN/description metadata.
- **Default-valued fields are omitted** (zero `total_supply`, empty `paused_features`, unset timestamps).
  ⇒ every field is optional in our parser; missing NAV is "no price", never 0.
- `nav_price` = most recent Chainlink-based NAV/reference value. **Not** a bid/ask or execution price.
- `multiplier` in the API is already de-WAD'ed (1 = no adjustment). Onchain it is WAD (1e18).
- The list may not include every onchain token; new tokens can take time to appear.
- The API has no wallet positions or P&L.
- `paused_features` integer meaning: the B20 pause guide lists TRANSFER(0), MINT(1), BURN(2), SEIZE(3).
  Mapping to the API integers is **UNVERIFIED**; we treat *any* paused feature as "not tradable"
  (conservative) and show the raw codes.

## C. B20 token standard

Sources: <https://docs.base.org/base-chain/network-information/b20-token-standard>,
<https://www.base.org/blog/b20-tokenized-stocks-on-base>, Chainlink Coinbase page (verbatim).

- B20 = Base-native RWA token standard, ERC-20 compatible extension, implemented as **precompiles**
  (one audited implementation shared by all tokens).
- Holder balances never rebase. Corporate actions change the **multiplier** (WAD).
  Dividends are converted into shares → multiplier increases (e.g. 1.00 → 1.02). Splits: 1.0 → 10.0.
- Events: `MultiplierUpdated`, `Announcement` / `EndAnnouncement`.
- Pausable features (transfer/mint/burn/seize) and issuer compliance controls exist.
- Testnet: hackathon projects report **no official Coinbase B20 stock tokens and no Chainlink equity
  feeds on Base Sepolia** (one project reports precompiles via a factory on Sepolia — conflicting,
  UNVERIFIED). StocMoon does not need to hold or transfer B20 tokens: it settles on reference prices
  and uses USDC collateral, so this does not block us.

## D. Chainlink NAV / reference feeds (read verbatim from Chainlink docs repo)

Source: `smartcontractkit/documentation` → `src/content/data-feeds/tokenized-equity-feeds/coinbase.mdx`
and `index.mdx` (<https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase>).

- Feed reports **Total Return Value**: `Token Price = Underlying Equity Market Price × Multiplier`.
- Standard **AggregatorV3Interface** (`latestRoundData()`), **push-based**, read through the proxy.
- Multiplier and pause flag are read by the feed from Coinbase's onchain oracle registry
  (registry address per Base docs snippet: `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD` — ABI not
  published in what we could read, so StocMoon **does not call it**).
- When the registry is paused (corporate action), the feed **holds the last value** until unpaused.
- **24/5**: regular, pre-market (04:00–09:30 ET), post-market (16:00–20:00 ET), overnight (20:00–04:00 ET).
  Weekend Fri 20:00 → Sun 20:00 ET: no data. Holidays: holds last close.
- "These feeds **do not have heartbeats during off-hours**." Integrators must implement staleness bounds.
- Overnight price is an EMA (smoothed) — lags during fast moves. Issuer risk is not priced.
- Chainlink asks integrators to contact Chainlink Labs before integrating tokenized equity feeds.
- Feed proxy addresses (Base mainnet) seen in Base docs snippet: AAPL `0x787f13dEa48Db0897CbCDD985de77809D837F988`,
  AMZN `0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295` (COIN, CRCL also listed). **UNVERIFIED until
  `pnpm assets:sync` checks them onchain** (decimals, description, freshness).
- Heartbeat/deviation for on-hours: conflicting secondary reports (one says 24h / 0.5%). **UNVERIFIED**.
  ⇒ short durations (5m/15m/30m) are **disabled by default** until measured update frequency
  supports them (`services` logs observed round intervals per feed).

## E. Base-compatible prediction-market AMMs

| Candidate | Base status | Verdict |
| --- | --- | --- |
| Gnosis Conditional Tokens + FPMM (Omen) | No maintained official Base deployment found | Design reused (FPMM math), **re-implemented** natively, minimal |
| Polymarket CTF exchange | Polygon, order book (CLOB), not AMM | Not suitable |
| Paradigm **pm-AMM** (Moallemi & Robinson) | Implementations found are **Solana-only** (Anchor programs, `@pm-amm/sdk`) | Not usable on Base |
| LMSR | Needs exp/ln fixed point + subsidy | Possible, more complex than needed for MVP |

## F. The previously shared "Predict pm-AMM"

- Repos found (`sparkfun-labs/pm-amm` forks, `@pm-amm/sdk`, predict-pm-amm.dev) are **Solana programs**
  with SPL collateral and Solana SDK dependencies.
- No Base deployment, no EVM/Solidity implementation found. A cross-chain bridge to a Solana AMM would
  add bridge risk, latency and a second chain for a Base-first product.
- **Decision:** do not import it. Implement a Base-native binary **FPMM** (constant product over
  YES/NO outcome balances, Gnosis-style). pm-AMM math (uniform LVR for time-bounded markets) is a
  documented future upgrade; the market hub isolates pricing in internal functions for that reason.

## G. Testnet assets, faucets, RPC, deployment

| Need | Choice |
| --- | --- |
| Chain | Base Sepolia (84532), Base mainnet (8453) for read-only price data |
| RPC | `https://sepolia.base.org`, `https://mainnet.base.org` (public, rate-limited; use a provider key via env for production) |
| USDC (Base Sepolia) | Circle test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` — faucet <https://faucet.circle.com> |
| Gas | Base Sepolia ETH faucets (Coinbase CDP faucet) |
| Explorer / verify | `https://sepolia.basescan.org` via Etherscan V2 API (`ETHERSCAN_API_KEY`) |
| Price feeds on testnet | **None official.** StocMoon runs a transparent `MirrorAggregator` per asset on Sepolia, updated by a relayer that copies Base **mainnet** Chainlink rounds (every round carries the mainnet round id + timestamp, publicly auditable). On mainnet the same contracts read the real Chainlink proxy directly. |

## H/I. Limitations that shape the design

1. **Reference price ≠ execution price.** We never call it a "price you can trade at".
2. **Market hours.** Feeds are 24/5 and frozen on weekends/holidays. Markets whose close time falls
   outside the feed session are not created (keeper calendar) and the contract's staleness check
   is the hard backstop.
3. **No guaranteed update frequency.** Durations are allowlisted onchain; short ones are off by default.
4. **Corporate-action pauses freeze the feed.** Staleness checks make such markets resolve via the
   documented fallback (PUSH refund) instead of settling on a frozen price.
5. **Testnet price bridge is a trust assumption** (relayer). It is labelled in the UI and every mirrored
   round is verifiable against mainnet.
6. **Earnings markets need a human resolver.** They use propose → dispute window → finalize, with
   the source and rules fixed at creation.

## J. Minimum viable market mechanism

Binary **UP/DOWN** market on one stock's Chainlink reference price, USDC collateral, FPMM liquidity:

- Open price = feed answer at creation (must be fresh). Close price = the feed round **in effect at
  `closeTime`** (proved onchain via round ids). UP wins if close > open, DOWN if close < open,
  **equal ⇒ PUSH** (every share redeems 0.50 USDC). No valid close price within the resolution window
  ⇒ INVALID (same 0.50 redemption). All parameters are snapshotted into the market at creation.
- Full methodology: [ARCHITECTURE.md § Settlement](./ARCHITECTURE.md#settlement-methodology).
