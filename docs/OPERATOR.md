# Running the StocMoon intraday operator

The operator publishes live Alpaca (IEX) prices for intraday markets and opens, settles and recycles the
5m–4H markets. It runs on **any computer** with Node.js — Windows, macOS or Linux — and only needs to be on
during extended US trading hours (04:00–20:00 ET, Mon–Fri; 17:00 on half days). The 24H/7D/30D markets keep running on
GitHub Actions and do not depend on it.

## Option A (recommended): run it on GitHub Actions — no computer needed

The repository is public, so GitHub Actions is free. `.github/workflows/intraday-operator.yml` starts the operator
automatically every weekday during extended trading hours, 04:00–20:00 ET (three back-to-back runs, because a GitHub job is limited to 6 hours). A stock only gets new markets while it is actually trading on IEX (a trade in the last 15 minutes), so thin pre-market/after-hours periods don't produce frozen-price markets.

1. GitHub → repository **Settings → Secrets and variables → Actions** → make sure these secrets exist:
   `OPERATOR_PRIVATE_KEY` (already added for the 5-minute job), `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET`.
2. That's it. Check progress under **Actions → Intraday operator**. Start a run manually with **Run workflow**.

Do not run the PC operator at the same time — two copies would send duplicate transactions from the same wallet.

## Option B: run it on a computer

### One-time setup (per computer)

1. Install **Node.js 22 LTS** from nodejs.org and **Git** (Windows: git-scm.com, use Git Bash).
2. Install pnpm and get the code:
   ```bash
   npm install -g pnpm
   git clone https://github.com/Kennyvincss/Stocmoon.git stocmoon-operator
   cd stocmoon-operator
   pnpm install --filter services...
   ```
   (If you already have the repo from the deploy step, `cd stocmoon && git pull && pnpm install --filter services...`.)
3. Create `services/.env` (copy `services/.env.example`) and fill in:
   ```
   CHAIN_ID=84532
   RPC_URL=https://sepolia.base.org
   OPERATOR_PRIVATE_KEY=<operator wallet private key>
   ALPACA_API_KEY_ID=<from Alpaca>
   ALPACA_API_SECRET=<from Alpaca>
   ```
   `services/.env` is git-ignored. Keep it private; it holds the operator key.

### Run

```bash
pnpm operator
```

Leave the window open. Stop with **Ctrl+C**; restart any time — it resumes from onchain state.
Outside market hours it only settles and recycles, so it is safe to leave running.

### Moving to another computer

Repeat the one-time setup there and copy `services/.env`. Run only **one** operator at a time (two copies would
send duplicate transactions from the same wallet).

## Costs

Base Sepolia gas only (fractions of a cent per transaction) plus test USDC: each new market is seeded with
`INTRADAY_LIQUIDITY` (default 5 USDC), returned when it settles. Top up from faucet.circle.com when the log
says "not enough USDC".

## Adding stocks to intraday markets

Intraday feeds are discovered onchain, so adding stocks is one admin command (run where the admin keystore lives):

```bash
cd stocmoon/contracts && git pull
set -a; source deploy.base-sepolia.env; set +a
INTRADAY_SYMBOLS=AAPL,AMZN,ANT,CRCL,GOOGL,INTC,META,MSFT,MSTR,NVDA,SNDK,SPCX,TSLA \
  forge script script/DeployIntraday.s.sol --rpc-url base_sepolia --account stocmoon-admin --broadcast
```

Stocks that already have an intraday feed are skipped. The operator picks up the new ones on its next start.
Symbols that Alpaca does not list (no IEX trades) are logged and simply get no intraday markets.

Each open market locks `INTRADAY_LIQUIDITY` (5 USDC) until it settles; with all 13 stocks × 5m/15m/1H that is up to
195 test USDC. With less, the operator opens the shortest durations first and fills in as USDC is recycled.
