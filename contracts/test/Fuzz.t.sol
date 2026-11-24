// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {FPMMMath} from "../src/libraries/FPMMMath.sol";

contract FPMMHarness {
    function calcSell(uint256 y, uint256 n, uint256 s, bool isYes) external pure returns (uint256) {
        return FPMMMath.calcSell(y, n, s, isYes);
    }
}

contract FuzzTest is BaseTest {
    FPMMHarness internal h;

    function setUp() public override {
        super.setUp();
        h = new FPMMHarness();
    }

    function testFuzz_BuyThenSellNeverProfits(uint256 liquidity, uint256 amount, bool isYes) public {
        liquidity = bound(liquidity, 10 * USDC, 100_000 * USDC);
        amount = bound(amount, 1, 50_000 * USDC);
        vm.prank(keeper);
        uint256 id = markets.createUpDownMarket(NVDA, HOUR, liquidity);
        uint256 before = usdc.balanceOf(alice);
        (uint256 quoted,,) = lens.quoteBuy(id, isYes, amount);
        vm.assume(quoted > 0);
        uint256 shares = _buy(alice, id, isYes, amount);
        assertEq(shares, quoted);
        (uint256 out,) = lens.quoteSell(id, isYes, shares);
        vm.assume(out > 0);
        vm.prank(alice);
        markets.sell(id, isYes, shares, 0, block.timestamp);
        assertLe(usdc.balanceOf(alice), before, "round trip profit");
        _assertBacked(id);
    }

    function testFuzz_SellMathInvariant(uint256 y, uint256 n, uint256 s, bool isYes) public view {
        y = bound(y, 1e3, 1e15);
        n = bound(n, 1e3, 1e15);
        s = bound(s, 1, 1e15);
        uint256 c = h.calcSell(y, n, s, isYes);
        (uint256 a, uint256 b) = isYes ? (y, n) : (n, y);
        assertLt(c, b);
        assertGe((a + s - c) * (b - c), a * b, "pool value decreased");
        // c is (near) maximal: releasing 2 more units would break the invariant
        if (c + 2 < b) assertLt((a + s - (c + 2)) * (b - (c + 2)), a * b, "c not tight");
    }

    function testFuzz_BuyNeverMintsMoreThanBacked(uint256 a1, uint256 a2, bool y1, bool y2) public {
        a1 = bound(a1, 1e3, 10_000 * USDC);
        a2 = bound(a2, 1e3, 10_000 * USDC);
        uint256 id = _createUpDown(1_000 * USDC);
        _buy(alice, id, y1, a1);
        _buy(bob, id, y2, a2);
        _assertBacked(id);
        uint256 p = lens.priceYes(id);
        assertGt(p, 0);
        assertLt(p, 1e18);
    }

    function testFuzz_SettlementPayoutsNeverExceedCollateral(uint256 a1, uint256 a2, int256 move) public {
        a1 = bound(a1, 1e3, 10_000 * USDC);
        a2 = bound(a2, 1e3, 10_000 * USDC);
        move = bound(move, -10e8, 10e8);
        uint256 id = _createUpDown(500 * USDC);
        _buy(alice, id, true, a1);
        _buy(bob, id, false, a2);
        uint256 closeTime = markets.getMarket(id).closeTime;
        vm.warp(closeTime - 1);
        uint80 r = feedA.push(180e8 + move, block.timestamp);
        vm.warp(closeTime + 2 minutes);
        markets.resolve(id, r, 0, 0, 0);
        vm.prank(alice);
        markets.redeem(id);
        vm.prank(bob);
        markets.redeem(id);
        uint256 lp = markets.lpShares(id, keeper);
        vm.prank(keeper);
        markets.removeLiquidity(id, lp, 0);
        assertLe(markets.getMarket(id).collateral, 1, "dust only");
        assertGe(usdc.balanceOf(address(markets)), markets.protocolFeesAccrued() + markets.lpFeesOutstanding());
    }
}
