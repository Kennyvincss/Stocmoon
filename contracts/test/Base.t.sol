// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StocMoonMarkets} from "../src/StocMoonMarkets.sol";
import {StocMoonLens} from "../src/StocMoonLens.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

abstract contract BaseTest is Test {
    StocMoonMarkets internal markets;
    StocMoonLens internal lens;
    OracleAdapter internal oracle;
    MockUSDC internal usdc;
    MockAggregator internal feedA;
    MockAggregator internal feedB;

    address internal admin = makeAddr("admin");
    address internal keeper = makeAddr("keeper");
    address internal resolver = makeAddr("resolver");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal mallory = makeAddr("mallory");

    // asset identities are token addresses (arbitrary here; real deployments use B20 mainnet addresses)
    address internal constant NVDA = address(0xA11CE0001);
    address internal constant TSLA = address(0xA11CE0002);

    uint32 internal constant HOUR = 1 hours;
    uint32 internal constant DAY = 1 days;
    uint32 internal constant STALENESS = 1 hours;
    uint256 internal constant USDC = 1e6;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        feedA = new MockAggregator(8);
        feedB = new MockAggregator(8);
        feedA.push(180e8, block.timestamp - 60);
        feedB.push(400e8, block.timestamp - 60);

        vm.startPrank(admin);
        oracle = new OracleAdapter(admin);
        oracle.configureAsset(NVDA, address(feedA), STALENESS, "NVDA");
        oracle.configureAsset(TSLA, address(feedB), STALENESS, "TSLA");
        markets = new StocMoonMarkets(usdc, oracle, admin, "https://stocmoon.app/api/tokens/{id}.json");
        markets.grantRole(markets.MARKET_CREATOR_ROLE(), keeper);
        markets.grantRole(markets.RESOLVER_ROLE(), resolver);
        markets.setDuration(HOUR, true, 5 minutes);
        markets.setDuration(DAY, true, 30 minutes);
        vm.stopPrank();
        lens = new StocMoonLens(markets);

        address[5] memory users = [keeper, alice, bob, carol, mallory];
        for (uint256 i; i < users.length; ++i) {
            usdc.mint(users[i], 1_000_000 * USDC);
            vm.prank(users[i]);
            usdc.approve(address(markets), type(uint256).max);
        }
    }

    function _createUpDown(uint256 liquidity) internal returns (uint256 id) {
        vm.prank(keeper);
        id = markets.createUpDownMarket(NVDA, HOUR, liquidity);
    }

    function _createBattle(uint256 liquidity) internal returns (uint256 id) {
        vm.prank(keeper);
        id = markets.createBattleMarket(NVDA, TSLA, DAY, liquidity);
    }

    function _buy(address who, uint256 id, bool yes, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return markets.buy(id, yes, amount, 0, block.timestamp);
    }

    function _yes(address who, uint256 id) internal view returns (uint256) {
        return markets.balanceOf(who, id * 2);
    }

    function _no(address who, uint256 id) internal view returns (uint256) {
        return markets.balanceOf(who, id * 2 + 1);
    }

    /// @dev Pushes a round on `feed` at `ts` and returns its id.
    function _push(MockAggregator feed, int256 answer, uint256 ts) internal returns (uint80) {
        return feed.push(answer, ts);
    }

    function _assertBacked(uint256 id) internal view {
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        if (m.status != StocMoonMarkets.Status.RESOLVED) {
            assertEq(m.collateral, markets.totalSupply(id * 2) + m.poolYes, "YES backing");
            assertEq(m.collateral, markets.totalSupply(id * 2 + 1) + m.poolNo, "NO backing");
        }
    }
}
