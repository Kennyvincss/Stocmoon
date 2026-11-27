// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StocMoonMarkets} from "../src/StocMoonMarkets.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {MirrorAggregator} from "../src/MirrorAggregator.sol";

/// @notice TESTNET: adds intraday (5m–4H) settlement feeds. For each chosen stock it deploys a feed written by the
///         operator with Alpaca IEX last-trade prices, registers it in the OracleAdapter under a deterministic pseudo
///         asset id (the token's own Chainlink entry is untouched), and enables the intraday durations.
///         Must be run by the admin (ASSET_ADMIN_ROLE on the adapter, CONFIG_ROLE on the markets).
///
/// env INTRADAY_SYMBOLS        comma-separated, from config/assets.json (default "NVDA,TSLA"); existing ones are skipped
/// env RELAYER_ADDRESS         operator wallet that publishes prices
/// env INTRADAY_MAX_STALENESS  seconds (default 300)
/// env INTRADAY_MIN_LIQUIDITY  min seed per market in USDC units (default 5 USDC)
contract DeployIntraday is Script {
    struct AssetEntry {
        uint8 decimals;
        address feed;
        uint256 maxStaleness;
        string symbol;
        address token;
    }

    function intradayAssetId(address token) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked("stocmoon.intraday", token)))));
    }

    function run() external {
        string memory root = vm.projectRoot();
        string memory dep = vm.readFile(string.concat(root, "/deployments/", vm.toString(block.chainid), ".json"));
        StocMoonMarkets markets = StocMoonMarkets(vm.parseJsonAddress(dep, ".markets"));
        OracleAdapter oracle = OracleAdapter(vm.parseJsonAddress(dep, ".oracleAdapter"));
        AssetEntry[] memory assets =
            abi.decode(vm.parseJson(vm.readFile(string.concat(root, "/config/assets.json")), ".assets"), (AssetEntry[]));

        string[] memory symbols = vm.split(vm.envOr("INTRADAY_SYMBOLS", string("NVDA,TSLA")), ",");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        uint32 staleness = uint32(vm.envOr("INTRADAY_MAX_STALENESS", uint256(300)));
        uint256 minLiquidity = vm.envOr("INTRADAY_MIN_LIQUIDITY", uint256(5e6));

        vm.startBroadcast();
        (, address admin,) = vm.readCallers();
        for (uint256 i; i < symbols.length; ++i) {
            address token;
            for (uint256 j; j < assets.length; ++j) {
                if (keccak256(bytes(assets[j].symbol)) == keccak256(bytes(symbols[i]))) token = assets[j].token;
            }
            require(token != address(0), string.concat("unknown symbol ", symbols[i]));
            address pseudo = intradayAssetId(token);
            // never replace an existing intraday feed (open markets keep their snapshotted feed, but new ones would move)
            if (oracle.getAsset(pseudo).feed != address(0)) {
                console2.log(symbols[i], "already has an intraday feed, skipped");
                continue;
            }
            MirrorAggregator feed = new MirrorAggregator(
                admin, relayer, 8, string.concat(symbols[i], " / USD (Alpaca IEX intraday)"), 0, address(0)
            );
            oracle.configureAsset(pseudo, address(feed), staleness, string.concat(symbols[i], "-INTRADAY"));
            console2.log(symbols[i], address(feed), pseudo);
        }
        markets.setDuration(5 minutes, true, 1 minutes);
        markets.setDuration(15 minutes, true, 2 minutes);
        markets.setDuration(30 minutes, true, 3 minutes);
        markets.setDuration(1 hours, true, 5 minutes);
        markets.setDuration(4 hours, true, 15 minutes);
        markets.setCreationPolicy(markets.openCreation(), minLiquidity);
        vm.stopBroadcast();
        // The operator discovers intraday feeds onchain (OracleAdapter.getAsset(intradayAssetId(token))).
    }
}
