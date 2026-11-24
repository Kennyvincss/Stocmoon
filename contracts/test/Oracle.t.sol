// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {MirrorAggregator} from "../src/MirrorAggregator.sol";

contract OracleTest is Test {
    OracleAdapter internal oracle;
    MirrorAggregator internal mirror;
    address internal admin = makeAddr("admin");
    address internal relayer = makeAddr("relayer");
    address internal constant AAPL = address(0xAAA1);

    function setUp() public {
        vm.warp(1_800_000_000);
        oracle = new OracleAdapter(admin);
        mirror = new MirrorAggregator(admin, relayer, 8, "AAPL / USD", 8453, address(0xFEED));
    }

    function test_MirrorPushAndRead() public {
        vm.prank(relayer);
        mirror.pushRound(100, 200e8, block.timestamp - 10, block.timestamp - 5);
        (uint80 id, int256 ans,, uint256 upd,) = mirror.latestRoundData();
        assertEq(id, 1);
        assertEq(ans, 200e8);
        assertEq(upd, block.timestamp - 5);
        assertEq(mirror.sourceRoundOf(1), 100);
        assertEq(mirror.decimals(), 8);
    }

    function test_MirrorRejectsBadRounds() public {
        vm.startPrank(relayer);
        mirror.pushRound(100, 200e8, block.timestamp - 10, block.timestamp - 5);
        vm.expectRevert(MirrorAggregator.NonMonotonicRound.selector);
        mirror.pushRound(100, 201e8, block.timestamp, block.timestamp);
        vm.expectRevert(MirrorAggregator.NonMonotonicRound.selector);
        mirror.pushRound(101, 201e8, block.timestamp - 6, block.timestamp - 6);
        vm.expectRevert(MirrorAggregator.InvalidAnswer.selector);
        mirror.pushRound(101, 0, block.timestamp, block.timestamp);
        vm.expectRevert(MirrorAggregator.TimestampInFuture.selector);
        mirror.pushRound(101, 1, block.timestamp, block.timestamp + 1);
        vm.stopPrank();

        vm.prank(admin);
        vm.expectRevert();
        mirror.pushRound(102, 1, block.timestamp, block.timestamp);

        vm.expectRevert(MirrorAggregator.NoDataPresent.selector);
        mirror.getRoundData(2);
    }

    function test_AdapterWithMirrorSettlementProof() public {
        vm.prank(relayer);
        mirror.pushRound(100, 200e8, block.timestamp - 10, block.timestamp - 10);
        vm.prank(admin);
        oracle.configureAsset(AAPL, address(mirror), 1 hours, "AAPL");
        (int256 p, uint80 r,,,) = oracle.latestPrice(AAPL);
        assertEq(p, 200e8);
        assertEq(r, 1);
        assertTrue(oracle.isTradable(AAPL));

        uint256 target = 1_800_000_100; // absolute: via-IR may re-read block.timestamp after warp
        vm.warp(target + 20);
        vm.prank(relayer);
        mirror.pushRound(101, 210e8, target + 10, target + 10);
        (int256 settled,) = oracle.priceAt(address(mirror), 1, 2, target, 1 hours);
        assertEq(settled, 200e8);
    }

    function test_AdapterConfigValidation() public {
        vm.startPrank(admin);
        vm.expectRevert(OracleAdapter.InvalidConfig.selector);
        oracle.configureAsset(address(0), address(mirror), 1 hours, "X");
        vm.expectRevert(OracleAdapter.InvalidConfig.selector);
        oracle.configureAsset(AAPL, address(mirror), 0, "X");
        vm.expectRevert(OracleAdapter.InvalidConfig.selector);
        oracle.configureAsset(AAPL, address(mirror), 8 days, "X");
        vm.expectRevert(abi.encodeWithSelector(OracleAdapter.UnknownAsset.selector, AAPL));
        oracle.setAssetStatus(AAPL, true, false, "x");
        vm.stopPrank();
        assertFalse(oracle.isTradable(AAPL));
    }
}
