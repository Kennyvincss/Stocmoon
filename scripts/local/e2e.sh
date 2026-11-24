#!/usr/bin/env bash
# Local end-to-end run of the full StocMoon stack on two anvil chains.
#   :8545  "app chain"   (stands in for Base Sepolia; chain 31337)
#   :8546  "source chain" (stands in for Base mainnet Chainlink feeds; chain 8453) with MockAggregators
# Uses SYNTHETIC fixture tokens (scripts/local/fixture-api.mjs). Requires: foundry, node, pnpm, postgres (DATABASE_URL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
: "${DATABASE_URL:?set DATABASE_URL to an empty test database}"
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil account 0 (public test key)
ME=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
APP=http://127.0.0.1:8545; SRC=http://127.0.0.1:8546
LOGS="${E2E_LOG_DIR:-$ROOT/.e2e}"; mkdir -p "$LOGS"

anvil --port 8545 --chain-id 31337 --silent > "$LOGS/anvil-app.log" 2>&1 & echo $! > "$LOGS/anvil-app.pid"
anvil --port 8546 --chain-id 8453 --silent > "$LOGS/anvil-src.log" 2>&1 & echo $! > "$LOGS/anvil-src.pid"
sleep 2

cd "$ROOT/contracts"
deploy() { local c=$1 r=$2; shift 2; forge create "$c" --rpc-url "$r" --private-key $PK --broadcast ${1:+--constructor-args "$@"} 2>&1 | awk '/Deployed to/ {print $3}'; }
FEED_A=$(deploy test/mocks/MockAggregator.sol:MockAggregator $SRC 8)
FEED_B=$(deploy test/mocks/MockAggregator.sol:MockAggregator $SRC 8)
MC=$(deploy test/mocks/Multicall3Lite.sol:Multicall3Lite $SRC)
cast rpc anvil_setCode 0xcA11bde05977b3631167028862bE2a173976CA11 "$(cast code $MC --rpc-url $SRC)" --rpc-url $SRC > /dev/null
NOW=$(cast block latest -f timestamp --rpc-url $APP)
cast send $FEED_A "push(int256,uint256)" 18000000000 $((NOW-30)) --rpc-url $SRC --private-key $PK > /dev/null
cast send $FEED_B "push(int256,uint256)" 40000000000 $((NOW-30)) --rpc-url $SRC --private-key $PK > /dev/null
USDC=$(deploy test/mocks/MockUSDC.sol:MockUSDC $APP)
[ -n "$FEED_A" ] && [ -n "$FEED_B" ] && [ -n "$USDC" ] || { echo "mock deployment failed"; exit 1; }
cast send $USDC "mint(address,uint256)" $ME 1000000000000 --rpc-url $APP --private-key $PK > /dev/null

TOKEN_A=0x00000000000000000000000000000000F1A70001
TOKEN_B=0x00000000000000000000000000000000F1A70002
cat > config/assets.json <<JSON
{"assets":[
 {"symbol":"FIXTA","token":"$TOKEN_A","feed":"$FEED_A","decimals":8,"maxStaleness":7200},
 {"symbol":"FIXTB","token":"$TOKEN_B","feed":"$FEED_B","decimals":8,"maxStaleness":7200}]}
JSON
USDC_ADDRESS=$USDC KEEPER_ADDRESS=$ME ENABLE_SHORT_DURATIONS=false \
  forge script script/Deploy.s.sol --rpc-url $APP --private-key $PK --broadcast > "$LOGS/deploy.log" 2>&1
cat deployments/31337.json
rm config/assets.json

export FIXTURE_TOKENS="[
 {\"contract_address\":\"$TOKEN_A\",\"symbol\":\"FIXTA\",\"name\":\"Fixture Token A (synthetic)\",\"decimals\":18,\"total_supply\":\"1000\",\"multiplier\":1.02,\"nav_price\":180,\"nav_price_updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"first_mint_date\":\"2026-08-24T00:00:00Z\"},
 {\"contract_address\":\"$TOKEN_B\",\"symbol\":\"FIXTB\",\"name\":\"Fixture Token B (synthetic)\",\"decimals\":18,\"total_supply\":\"500\",\"multiplier\":1,\"nav_price\":400,\"nav_price_updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},
 {\"contract_address\":\"0x00000000000000000000000000000000F1A70003\",\"symbol\":\"FIXTP\",\"name\":\"Fixture Paused (synthetic)\",\"nav_price\":10,\"nav_price_updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"paused_features\":[0]},
 {\"contract_address\":\"0x00000000000000000000000000000000F1A70004\",\"symbol\":\"FIXTN\",\"name\":\"Fixture No NAV (synthetic)\"}]"
node "$ROOT/scripts/local/fixture-api.mjs" > "$LOGS/fixture.log" 2>&1 & echo $! > "$LOGS/fixture.pid"

export CHAIN_ID=31337 RPC_URL=$APP SOURCE_RPC_URL=$SRC SOURCE_CHAIN_ID=8453
export RELAYER_PRIVATE_KEY=$PK KEEPER_PRIVATE_KEY=$PK KEEPER_DURATIONS=3600,86400 KEEPER_LIQUIDITY=100000000
export KEEPER_BATTLES="$TOKEN_A:$TOKEN_B:86400" TOKENIZED_STOCKS_API_URL=http://127.0.0.1:4010
cd "$ROOT"
pnpm -s db:migrate
pnpm -s relayer -- --once
pnpm -s keeper -- --once
pnpm -s indexer -- --once
echo "stack ready. logs in $LOGS"
