# Running the StocMoon intraday operator

The operator publishes live Alpaca (IEX) prices for intraday markets and opens, settles and recycles the
5m–4H markets. It runs on **any computer** with Node.js — Windows, macOS or Linux — and only needs to be on
during US market hours (09:30–16:00 ET, Mon–Fri; 14:30–21:00 UTC). The 24H/7D/30D markets keep running on
GitHub Actions and do not depend on it.

## One-time setup (per computer)

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

## Run

```bash
pnpm operator
```

Leave the window open. Stop with **Ctrl+C**; restart any time — it resumes from onchain state.
Outside market hours it only settles and recycles, so it is safe to leave running.

## Moving to another computer

Repeat the one-time setup there and copy `services/.env`. Run only **one** operator at a time (two copies would
send duplicate transactions from the same wallet).

## Costs

Base Sepolia gas only (fractions of a cent per transaction) plus test USDC: each new market is seeded with
`INTRADAY_LIQUIDITY` (default 5 USDC), returned when it settles. Top up from faucet.circle.com when the log
says "not enough USDC".
