// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "./Base.t.sol";
import {StocMoonMarkets} from "../src/StocMoonMarkets.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract Handler is Test {
    StocMoonMarkets internal markets;
    MockUSDC internal usdc;
    uint256 internal id;
    address[] internal actors;

    constructor(StocMoonMarkets m, MockUSDC u, uint256 id_, address[] memory actors_) {
        markets = m;
        usdc = u;
        id = id_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function buy(uint256 seed, uint256 amount, bool yes) external {
        amount = bound(amount, 1, 5_000e6);
        vm.prank(_actor(seed));
        try markets.buy(id, yes, amount, 0, block.timestamp) {} catch {}
    }

    function sell(uint256 seed, uint256 frac, bool yes) external {
        address a = _actor(seed);
        uint256 bal = markets.balanceOf(a, yes ? id * 2 : id * 2 + 1);
        if (bal == 0) return;
        uint256 amount = bound(frac, 1, bal);
        vm.prank(a);
        try markets.sell(id, yes, amount, 0, block.timestamp) {} catch {}
    }

    function addLiquidity(uint256 seed, uint256 amount) external {
        amount = bound(amount, 1e3, 5_000e6);
        vm.prank(_actor(seed));
        try markets.addLiquidity(id, amount, 0, block.timestamp) {} catch {}
    }

    function removeLiquidity(uint256 seed, uint256 frac) external {
        address a = _actor(seed);
        uint256 lp = markets.lpShares(id, a);
        if (lp == 0) return;
        vm.prank(a);
        try markets.removeLiquidity(id, bound(frac, 1, lp), 0) {} catch {}
    }

    function split(uint256 seed, uint256 amount) external {
        amount = bound(amount, 1, 1_000e6);
        vm.prank(_actor(seed));
        try markets.splitPosition(id, amount) {} catch {}
    }

    function merge(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 y = markets.balanceOf(a, id * 2);
        uint256 n = markets.balanceOf(a, id * 2 + 1);
        uint256 mx = y < n ? y : n;
        if (mx == 0) return;
        vm.prank(a);
        try markets.mergePositions(id, bound(amount, 1, mx)) {} catch {}
    }

    function claimFees(uint256 seed) external {
        vm.prank(_actor(seed));
        try markets.claimLpFees(id) {} catch {}
    }
}

contract InvariantTest is BaseTest {
    Handler internal handler;
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _createUpDown(1_000 * USDC);
        address[] memory actors = new address[](4);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        actors[3] = keeper;
        handler = new Handler(markets, usdc, id, actors);
        targetContract(address(handler));
    }

    function invariant_SharesFullyBacked() public view {
        _assertBacked(id);
    }

    function invariant_Solvent() public view {
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        assertGe(
            usdc.balanceOf(address(markets)), m.collateral + markets.protocolFeesAccrued() + markets.lpFeesOutstanding()
        );
        assertGe(markets.lpFeesOutstanding(), m.lpFeeReserve);
    }

    function invariant_PoolNeverEmptyWhileLpExists() public view {
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        if (m.totalLpShares > 0) {
            assertGt(m.poolYes, 0);
            assertGt(m.poolNo, 0);
        }
    }
}
