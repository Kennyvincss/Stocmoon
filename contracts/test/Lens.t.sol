// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {StocMoonLens} from "../src/StocMoonLens.sol";

contract LensTest is BaseTest {
    function test_ListMarketsNewestFirstAndPaginates() public {
        _createUpDown(100 * USDC);
        _createBattle(100 * USDC);
        _createUpDown(100 * USDC);
        StocMoonLens.MarketView[] memory page = lens.listMarkets(0, 2);
        assertEq(page.length, 2);
        assertEq(page[0].id, 3);
        assertEq(page[1].id, 2);
        page = lens.listMarkets(2, 10);
        assertEq(page.length, 1);
        assertEq(page[0].id, 1);
        assertEq(lens.listMarkets(5, 10).length, 0);
    }

    function test_PositionsOfAndSupplies() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 shares = _buy(alice, id, false, 5 * USDC);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        (uint256[] memory y, uint256[] memory n, uint256[] memory lp, uint256[] memory fees) =
            lens.positionsOf(alice, ids);
        assertEq(y[0], 0);
        assertEq(n[0], shares);
        assertEq(lp[0], 0);
        assertEq(fees[0], 0);
        (,, lp, fees) = lens.positionsOf(keeper, ids);
        assertEq(lp[0], 100 * USDC);
        assertGt(fees[0], 0);
        StocMoonLens.MarketView memory v = lens.getMarketView(id);
        assertEq(v.noSupply, shares);
        assertLt(v.priceYes, 5e17);
    }

    function test_QuotesOnEmptyOrZero() public view {
        (uint256 s, uint256 f, uint256 p) = lens.quoteBuy(42, true, 1e6);
        assertEq(s + f + p, 0);
        (uint256 o, uint256 f2) = lens.quoteSell(42, true, 1e6);
        assertEq(o + f2, 0);
        assertEq(lens.priceYes(42), 5e17);
    }
}
