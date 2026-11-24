-- StocMoon schema. PostgreSQL 15+ (Supabase compatible).
-- The blockchain is the source of truth for markets, positions and settlement. Chain-derived rows carry
-- (chain_id, tx_hash, log_index) with a UNIQUE constraint so the indexer is idempotent.

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ identity
create table if not exists users (
  address        text primary key check (address ~ '^0x[0-9a-f]{40}$'),
  username       text unique check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  avatar_url     text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists eligibility_attestations (
  id             bigserial primary key,
  address        text not null,
  country        text not null,
  message        text not null,
  signature      text not null,
  nonce          text not null unique,
  ip_hash        text,
  onchain_tx     text,
  created_at     timestamptz not null default now()
);
create index if not exists eligibility_address_idx on eligibility_attestations(address);

-- signed-request replay protection (profile updates, attestations)
create table if not exists used_nonces (
  nonce          text primary key,
  address        text not null,
  used_at        timestamptz not null default now()
);

-- ------------------------------------------------------------------ stocks & prices
create table if not exists stocks (
  address              text primary key,           -- B20 token contract address (Base mainnet), lowercase
  symbol               text not null,
  name                 text not null,
  description          text,
  decimals             integer,
  icon_url             text,
  isin                 text,
  total_supply         numeric,
  multiplier           numeric,
  nav_price            numeric,                     -- null = unavailable (never 0)
  nav_price_updated_at timestamptz,
  paused_features      integer[] not null default '{}',
  first_mint_date      timestamptz,
  category             text,
  raw                  jsonb not null,
  first_seen_at        timestamptz not null default now(),
  last_synced_at       timestamptz not null default now()
);
create index if not exists stocks_symbol_idx on stocks(symbol);

create table if not exists api_sync_runs (
  id            bigserial primary key,
  source        text not null,
  ok            boolean not null,
  pages         integer,
  records       integer,
  skipped       integer,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- one row per observed reference price (API NAV or Chainlink round)
create table if not exists price_snapshots (
  id            bigserial primary key,
  stock_address text not null,
  source        text not null check (source in ('api_nav', 'chainlink_round')),
  price         numeric not null check (price > 0),
  observed_at   timestamptz not null,               -- nav_price_updated_at or round updatedAt
  round_id      numeric,
  created_at    timestamptz not null default now(),
  unique (stock_address, source, observed_at)
);
create index if not exists price_snapshots_lookup on price_snapshots(stock_address, observed_at desc);

-- ------------------------------------------------------------------ markets (indexed from chain)
create table if not exists markets (
  chain_id          integer not null,
  market_id         bigint not null,
  kind              text not null check (kind in ('UP_DOWN', 'BATTLE', 'EVENT')),
  creator           text not null,
  asset_a           text,
  asset_b           text,
  feed_a            text,
  feed_b            text,
  open_price_a      numeric,
  open_price_b      numeric,
  open_time         timestamptz not null,
  trading_ends_at   timestamptz not null,
  close_time        timestamptz not null,
  metadata_hash     text,
  question          text,
  rules_uri         text,
  lp_fee_bps        integer,
  protocol_fee_bps  integer,
  max_staleness     integer,
  settlement_delay  integer,
  resolution_window integer,
  dispute_window    integer,
  status            text not null default 'OPEN',
  outcome           text not null default 'NONE',
  close_price_a     numeric,
  close_price_b     numeric,
  resolved_at       timestamptz,
  created_tx        text not null,
  primary key (chain_id, market_id)
);
create index if not exists markets_status_idx on markets(chain_id, status, close_time);
create index if not exists markets_asset_idx on markets(chain_id, asset_a);

create table if not exists market_outcomes (
  chain_id      integer not null,
  market_id     bigint not null,
  outcome       text not null,
  close_price_a numeric,
  close_price_b numeric,
  round_a       numeric,
  round_b       numeric,
  tx_hash       text not null,
  log_index     integer not null,
  created_at    timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index)
);

create table if not exists stock_battles (
  chain_id      integer not null,
  market_id     bigint not null,
  asset_a       text not null,
  asset_b       text not null,
  primary key (chain_id, market_id),
  foreign key (chain_id, market_id) references markets(chain_id, market_id) on delete cascade
);

create table if not exists earnings_events (
  chain_id        integer not null,
  market_id       bigint not null,
  company_address text,
  question        text not null,
  rules_uri       text not null,
  proposed_outcome text,
  evidence_uri    text,
  primary key (chain_id, market_id),
  foreign key (chain_id, market_id) references markets(chain_id, market_id) on delete cascade
);

create table if not exists liquidity_pools (
  chain_id        integer not null,
  market_id       bigint not null,
  pool_yes        numeric not null,
  pool_no         numeric not null,
  total_lp_shares numeric not null default 0,
  updated_block   bigint not null,
  primary key (chain_id, market_id)
);

-- every decoded contract event, raw
create table if not exists market_events (
  id            bigserial primary key,
  chain_id      integer not null,
  block_number  bigint not null,
  block_time    timestamptz,
  tx_hash       text not null,
  log_index     integer not null,
  event_name    text not null,
  market_id     bigint,
  account       text,
  args          jsonb not null,
  unique (chain_id, tx_hash, log_index)
);
create index if not exists market_events_market_idx on market_events(chain_id, market_id, block_number);
create index if not exists market_events_account_idx on market_events(account, block_number desc);

-- user cash flows per market (derived from events)
create table if not exists transactions (
  id            bigserial primary key,
  chain_id      integer not null,
  tx_hash       text not null,
  log_index     integer not null,
  block_number  bigint not null,
  block_time    timestamptz,
  account       text not null,
  market_id     bigint not null,
  action        text not null check (action in ('buy', 'sell', 'split', 'merge', 'add_liquidity', 'remove_liquidity', 'claim_fees', 'redeem')),
  side          text check (side in ('YES', 'NO')),
  collateral_in numeric not null default 0,   -- USDC units paid by the user
  collateral_out numeric not null default 0,  -- USDC units received by the user
  shares        numeric not null default 0,
  fee           numeric not null default 0,
  unique (chain_id, tx_hash, log_index)
);
create index if not exists transactions_account_idx on transactions(account, block_number desc);
create index if not exists transactions_market_idx on transactions(chain_id, market_id);

-- per (account, market) cash-flow aggregates (derived; recomputable from transactions).
-- Live share balances are always read from the chain (ERC-1155 balances), never from this table.
create table if not exists positions (
  chain_id        integer not null,
  market_id       bigint not null,
  account         text not null,
  cost_basis      numeric not null default 0,  -- buys + splits
  proceeds        numeric not null default 0,  -- sells + merges + redemptions
  lp_shares       numeric not null default 0,
  updated_block   bigint not null,
  primary key (chain_id, market_id, account)
);

create table if not exists indexer_state (
  chain_id      integer not null,
  contract      text not null,
  last_block    bigint not null,
  updated_at    timestamptz not null default now(),
  primary key (chain_id, contract)
);

-- relayer audit log (testnet mirror)
create table if not exists relayed_rounds (
  chain_id         integer not null,
  mirror           text not null,
  source_feed      text not null,
  source_round_id  numeric not null,
  answer           numeric not null,
  updated_at_src   timestamptz not null,
  tx_hash          text not null,
  created_at       timestamptz not null default now(),
  primary key (chain_id, mirror, source_round_id)
);
