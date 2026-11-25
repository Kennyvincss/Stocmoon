// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {StocMoonMarkets} from "../src/StocMoonMarkets.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {ReentrantReceiver} from "./mocks/ReentrantReceiver.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract StocMoonMarketsTest is BaseTest {
    // ============================================================ creation

    function test_CreateUpDownMarket_SnapshotsParams() public {
        uint256 id = _createUpDown(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        assertEq(id, 1);
        assertEq(uint8(m.kind), uint8(StocMoonMarkets.Kind.UP_DOWN));
        assertEq(uint8(m.status), uint8(StocMoonMarkets.Status.OPEN));
        assertEq(m.assetA, NVDA);
        assertEq(m.feedA, address(feedA));
        assertEq(m.openPriceA, 180e8);
        assertEq(m.openRoundA, feedA.latestId());
        assertEq(m.closeTime, block.timestamp + HOUR);
        assertEq(m.tradingEndsAt, block.timestamp + HOUR - 5 minutes);
        assertEq(m.maxStaleness, STALENESS);
        assertEq(m.lpFeeBps, 150);
        assertEq(m.protocolFeeBps, 50);
        assertEq(m.poolYes, 100 * USDC);
        assertEq(m.poolNo, 100 * USDC);
        assertEq(m.collateral, 100 * USDC);
        assertEq(markets.lpShares(id, keeper), 100 * USDC);
        assertEq(lens.priceYes(id), 5e17);
        assertEq(usdc.balanceOf(address(markets)), 100 * USDC);
    }

    function test_ConfigChangesDoNotAffectExistingMarket() public {
        uint256 id = _createUpDown(100 * USDC);
        vm.startPrank(admin);
        markets.setFees(400, 100);
        markets.setWindows(10 minutes, 3 days, 2 hours);
        oracle.configureAsset(NVDA, address(feedB), 10 minutes, "NVDA");
        vm.stopPrank();
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        assertEq(m.lpFeeBps, 150);
        assertEq(m.protocolFeeBps, 50);
        assertEq(m.settlementDelay, 2 minutes);
        assertEq(m.resolutionWindow, 7 days);
        assertEq(m.feedA, address(feedA));
        assertEq(m.maxStaleness, STALENESS);
    }

    function test_CreateBattleMarket() public {
        uint256 id = _createBattle(50 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        assertEq(uint8(m.kind), uint8(StocMoonMarkets.Kind.BATTLE));
        assertEq(m.assetB, TSLA);
        assertEq(m.openPriceB, 400e8);
    }

    function test_RevertWhen_BattleSameAsset() public {
        vm.prank(keeper);
        vm.expectRevert(StocMoonMarkets.InvalidParams.selector);
        markets.createBattleMarket(NVDA, NVDA, DAY, 50 * USDC);
    }

    function test_RevertWhen_UnauthorizedCreation() public {
        vm.prank(mallory);
        vm.expectRevert(StocMoonMarkets.NotAuthorizedCreator.selector);
        markets.createUpDownMarket(NVDA, HOUR, 100 * USDC);
    }

    function test_OpenCreationAllowsAnyoneButNotEvents() public {
        vm.prank(admin);
        markets.setCreationPolicy(true, 10 * USDC);
        vm.prank(alice);
        uint256 id = markets.createUpDownMarket(NVDA, HOUR, 10 * USDC);
        assertEq(markets.getMarket(id).creator, alice);

        bytes32 role = markets.MARKET_CREATOR_ROLE();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, role));
        markets.createEventMarket(
            NVDA, "q", "ipfs://rules", uint64(block.timestamp + 1 days), uint64(block.timestamp + 2 days), 10 * USDC
        );
    }

    function test_RevertWhen_DurationNotAllowed() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(StocMoonMarkets.DurationNotAllowed.selector, uint32(5 minutes)));
        markets.createUpDownMarket(NVDA, 5 minutes, 100 * USDC);
    }

    function test_RevertWhen_InsufficientInitialLiquidity() public {
        vm.prank(keeper);
        vm.expectRevert(StocMoonMarkets.InsufficientInitialLiquidity.selector);
        markets.createUpDownMarket(NVDA, HOUR, 1 * USDC);
    }

    function test_RevertWhen_StaleOracleOnCreation() public {
        vm.warp(block.timestamp + STALENESS + 1);
        vm.prank(keeper);
        vm.expectPartialRevert(OracleAdapter.StalePrice.selector);
        markets.createUpDownMarket(NVDA, HOUR, 100 * USDC);
    }

    function test_RevertWhen_InvalidOraclePrice() public {
        feedA.push(-1, block.timestamp);
        vm.prank(keeper);
        vm.expectRevert(OracleAdapter.InvalidPrice.selector);
        markets.createUpDownMarket(NVDA, HOUR, 100 * USDC);

        feedA.push(0, block.timestamp);
        vm.prank(keeper);
        vm.expectRevert(OracleAdapter.InvalidPrice.selector);
        markets.createUpDownMarket(NVDA, HOUR, 100 * USDC);
    }

    function test_RevertWhen_FeedUnavailable() public {
        feedA.setRevertLatest(true);
        vm.prank(keeper);
        vm.expectRevert();
        markets.createUpDownMarket(NVDA, HOUR, 100 * USDC);
        assertFalse(oracle.isTradable(NVDA));
    }

    function test_RevertWhen_AssetPausedOrDisabledOrUnknown() public {
        vm.prank(admin);
        oracle.setAssetStatus(NVDA, true, true, "corporate action");
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(OracleAdapter.AssetPaused.selector, NVDA));
        markets.createUpDownMarket(NVDA, HOUR, 100 * USDC);

        vm.prank(admin);
        oracle.setAssetStatus(NVDA, false, false, "delisted");
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(OracleAdapter.AssetDisabled.selector, NVDA));
        markets.createUpDownMarket(NVDA, HOUR, 100 * USDC);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(OracleAdapter.UnknownAsset.selector, address(0xdead)));
        markets.createUpDownMarket(address(0xdead), HOUR, 100 * USDC);
    }

    function test_RevertWhen_CreationWhilePaused() public {
        vm.prank(admin);
        markets.pause();
        vm.prank(keeper);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        markets.createUpDownMarket(NVDA, HOUR, 100 * USDC);
    }

    // ============================================================ trading

    function test_BuyMatchesQuoteAndMovesPrice() public {
        uint256 id = _createUpDown(100 * USDC);
        (uint256 quoted, uint256 fee,) = lens.quoteBuy(id, true, 10 * USDC);
        uint256 shares = _buy(alice, id, true, 10 * USDC);
        assertEq(shares, quoted);
        assertEq(fee, 0.2e6); // 2% of 10
        assertEq(_yes(alice, id), shares);
        assertGt(shares, 9.8e6); // > net because price < 1
        assertGt(lens.priceYes(id), 5e17);
        _assertBacked(id);
    }

    function test_FeeSplitAndProtocolWithdrawal() public {
        uint256 id = _createUpDown(100 * USDC);
        _buy(alice, id, true, 100 * USDC);
        // fee = 2 USDC; lp 1.5, protocol 0.5
        assertEq(markets.protocolFeesAccrued(), 0.5e6);
        assertEq(markets.pendingLpFees(id, keeper), 1.5e6);

        vm.prank(mallory);
        vm.expectRevert();
        markets.withdrawProtocolFees(mallory);

        uint256 before = usdc.balanceOf(admin);
        vm.prank(admin);
        markets.withdrawProtocolFees(admin);
        assertEq(usdc.balanceOf(admin) - before, 0.5e6);
        assertEq(markets.protocolFeesAccrued(), 0);
    }

    function test_RevertWhen_BuySlippage() public {
        uint256 id = _createUpDown(100 * USDC);
        (uint256 quoted,,) = lens.quoteBuy(id, true, 10 * USDC);
        _buy(bob, id, true, 20 * USDC); // front-run moves price
        vm.prank(alice);
        vm.expectRevert(StocMoonMarkets.Slippage.selector);
        markets.buy(id, true, 10 * USDC, quoted, block.timestamp);
    }

    function test_RevertWhen_DeadlinePassed() public {
        uint256 id = _createUpDown(100 * USDC);
        vm.prank(alice);
        vm.expectRevert(StocMoonMarkets.Expired.selector);
        markets.buy(id, true, 10 * USDC, 0, block.timestamp - 1);
    }

    function test_RevertWhen_TradingAfterCutoff() public {
        uint256 id = _createUpDown(100 * USDC);
        _buy(alice, id, true, 10 * USDC);
        vm.warp(markets.getMarket(id).tradingEndsAt);
        vm.prank(bob);
        vm.expectRevert(StocMoonMarkets.TradingClosed.selector);
        markets.buy(id, false, 10 * USDC, 0, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(StocMoonMarkets.TradingClosed.selector);
        markets.sell(id, true, 1 * USDC, 0, block.timestamp);
    }

    function test_RevertWhen_ZeroAmountAndUnknownMarket() public {
        uint256 id = _createUpDown(100 * USDC);
        vm.prank(alice);
        vm.expectRevert(StocMoonMarkets.ZeroAmount.selector);
        markets.buy(id, true, 0, 0, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(StocMoonMarkets.InvalidMarket.selector);
        markets.buy(99, true, 1 * USDC, 0, block.timestamp);
    }

    function test_SellClosesPositionAndMatchesQuote() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 shares = _buy(alice, id, true, 10 * USDC);
        (uint256 quoted,) = lens.quoteSell(id, true, shares);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 out = markets.sell(id, true, shares, quoted, block.timestamp);
        assertEq(out, quoted);
        assertEq(usdc.balanceOf(alice) - before, out);
        assertEq(_yes(alice, id), 0);
        // round trip costs roughly two fees, never profits
        assertLt(out, 10 * USDC);
        assertGt(out, 9.5e6);
        _assertBacked(id);
    }

    function test_RevertWhen_SellMoreThanBalance() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 shares = _buy(alice, id, true, 10 * USDC);
        vm.prank(alice);
        vm.expectRevert();
        markets.sell(id, true, shares + 1, 0, block.timestamp);
    }

    function test_SplitAndMerge() public {
        uint256 id = _createUpDown(100 * USDC);
        vm.prank(alice);
        markets.splitPosition(id, 5 * USDC);
        assertEq(_yes(alice, id), 5 * USDC);
        assertEq(_no(alice, id), 5 * USDC);
        _assertBacked(id);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        markets.mergePositions(id, 5 * USDC);
        assertEq(usdc.balanceOf(alice) - before, 5 * USDC);
        _assertBacked(id);
    }

    // ============================================================ liquidity

    function test_AddLiquidityToImbalancedPoolReturnsExcess() public {
        uint256 id = _createUpDown(100 * USDC);
        _buy(alice, id, true, 50 * USDC);
        uint256 priceBefore = lens.priceYes(id);
        vm.prank(bob);
        uint256 minted = markets.addLiquidity(id, 40 * USDC, 0, block.timestamp);
        assertGt(minted, 0);
        // pool prices unchanged by adding liquidity
        assertApproxEqAbs(lens.priceYes(id), priceBefore, 1e12);
        // bob receives the excess of the over-weighted outcome (YES pool is smaller => he gets YES back)
        assertGt(_yes(bob, id), 0);
        assertEq(_no(bob, id), 0);
        _assertBacked(id);
    }

    function test_RemoveLiquidityMergesAndPaysFees() public {
        uint256 id = _createUpDown(100 * USDC);
        _buy(alice, id, true, 20 * USDC);
        uint256 fees = markets.pendingLpFees(id, keeper);
        assertGt(fees, 0);
        uint256 shares = markets.lpShares(id, keeper);
        uint256 before = usdc.balanceOf(keeper);
        vm.prank(keeper);
        uint256 out = markets.removeLiquidity(id, shares, 0);
        assertEq(usdc.balanceOf(keeper) - before, out + fees);
        // remaining unmatched NO shares (pool was NO-heavy) are minted to the LP
        assertGt(_no(keeper, id), 0);
        assertEq(markets.lpShares(id, keeper), 0);
        _assertBacked(id);
    }

    function test_ClaimLpFeesAndNoDoubleClaim() public {
        uint256 id = _createUpDown(100 * USDC);
        _buy(alice, id, true, 20 * USDC);
        vm.prank(keeper);
        uint256 got = markets.claimLpFees(id);
        assertEq(got, 0.3e6);
        vm.prank(keeper);
        vm.expectRevert(StocMoonMarkets.ZeroAmount.selector);
        markets.claimLpFees(id);
    }

    function test_LpFeesProRata() public {
        uint256 id = _createUpDown(100 * USDC);
        vm.prank(bob);
        markets.addLiquidity(id, 100 * USDC, 0, block.timestamp);
        _buy(alice, id, true, 10 * USDC);
        assertEq(markets.pendingLpFees(id, keeper), markets.pendingLpFees(id, bob));
    }

    function test_RemoveLiquidityAllowedWhilePausedAndAfterResolution() public {
        uint256 id = _createUpDown(100 * USDC);
        _buy(alice, id, true, 20 * USDC);
        vm.prank(admin);
        markets.pause();
        uint256 half = markets.lpShares(id, keeper) / 2;
        vm.prank(keeper);
        markets.removeLiquidity(id, half, 0);
        vm.prank(admin);
        markets.unpause();

        uint80 r = _settleAt(id, 181e8); // UP wins
        assertGt(r, 0);
        uint256 rest = markets.lpShares(id, keeper);
        vm.prank(keeper);
        markets.removeLiquidity(id, rest, 0);
        assertEq(markets.getMarket(id).poolYes, 0);
    }

    function test_RevertWhen_AddLiquiditySlippage() public {
        uint256 id = _createUpDown(100 * USDC);
        vm.prank(bob);
        vm.expectRevert(StocMoonMarkets.Slippage.selector);
        markets.addLiquidity(id, 10 * USDC, 11 * USDC, block.timestamp);
    }

    // ============================================================ settlement helpers

    /// @dev Pushes a round 1s before close then one after close, warps past delay, resolves.
    function _settleAt(uint256 id, int256 closePrice) internal returns (uint80 round) {
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 1);
        round = feedA.push(closePrice, block.timestamp);
        vm.warp(m.closeTime + 10);
        uint80 next = feedA.push(closePrice + 1e8, block.timestamp);
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        markets.resolve(id, round, next, 0, 0);
    }

    // ============================================================ settlement

    function test_Settlement_UpWins_WinnerAndLoserClaims() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 aliceShares = _buy(alice, id, true, 10 * USDC);
        uint256 bobShares = _buy(bob, id, false, 10 * USDC);
        _settleAt(id, 181e8);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        assertEq(uint8(m.outcome), uint8(StocMoonMarkets.Outcome.YES));
        assertEq(m.closePriceA, 181e8);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 payout = markets.redeem(id);
        assertEq(payout, aliceShares);
        assertEq(usdc.balanceOf(alice) - before, aliceShares);

        vm.prank(bob);
        uint256 bobPayout = markets.redeem(id);
        assertEq(bobPayout, 0);
        assertEq(_no(bob, id), 0);
        assertGt(bobShares, 0);
    }

    function test_Settlement_DownWins() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 bobShares = _buy(bob, id, false, 10 * USDC);
        _settleAt(id, 179e8);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(StocMoonMarkets.Outcome.NO));
        vm.prank(bob);
        assertEq(markets.redeem(id), bobShares);
    }

    function test_Settlement_TieIsPush() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 aliceShares = _buy(alice, id, true, 10 * USDC);
        _settleAt(id, 180e8);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(StocMoonMarkets.Outcome.PUSH));
        vm.prank(alice);
        assertEq(markets.redeem(id), aliceShares / 2);
    }

    function test_RevertWhen_DuplicateClaim() public {
        uint256 id = _createUpDown(100 * USDC);
        _buy(alice, id, true, 10 * USDC);
        _settleAt(id, 181e8);
        vm.prank(alice);
        markets.redeem(id);
        vm.prank(alice);
        vm.expectRevert(StocMoonMarkets.NothingToRedeem.selector);
        markets.redeem(id);
    }

    function test_RevertWhen_RedeemBeforeResolution() public {
        uint256 id = _createUpDown(100 * USDC);
        _buy(alice, id, true, 10 * USDC);
        vm.prank(alice);
        vm.expectRevert(StocMoonMarkets.WrongStatus.selector);
        markets.redeem(id);
    }

    function test_RevertWhen_ResolveTooEarly() public {
        uint256 id = _createUpDown(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 1);
        uint80 r = feedA.push(181e8, block.timestamp);
        vm.warp(m.closeTime + 1);
        vm.expectRevert(StocMoonMarkets.TooEarly.selector);
        markets.resolve(id, r, 0, 0, 0);
    }

    function test_RevertWhen_DoubleResolve() public {
        uint256 id = _createUpDown(100 * USDC);
        uint80 r = _settleAt(id, 181e8);
        vm.expectRevert(StocMoonMarkets.WrongStatus.selector);
        markets.resolve(id, r, r + 1, 0, 0);
    }

    function test_Settlement_LatestRoundPath() public {
        uint256 id = _createUpDown(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 30);
        uint80 r = feedA.push(185e8, block.timestamp);
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        markets.resolve(id, r, 0, 0, 0);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(StocMoonMarkets.Outcome.YES));
    }

    function test_RevertWhen_RoundAfterCloseTime() public {
        uint256 id = _createUpDown(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime + 5);
        uint80 r = feedA.push(185e8, block.timestamp);
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        vm.expectPartialRevert(OracleAdapter.RoundAfterTarget.selector);
        markets.resolve(id, r, 0, 0, 0);
    }

    function test_RevertWhen_NotLatestRoundWithoutSuccessor() public {
        uint256 id = _createUpDown(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 100);
        uint80 r1 = feedA.push(185e8, block.timestamp);
        vm.warp(m.closeTime - 50);
        feedA.push(175e8, block.timestamp);
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        // r1 is not the round in effect at close: the later round is
        vm.expectPartialRevert(OracleAdapter.NotLatestRound.selector);
        markets.resolve(id, r1, 0, 0, 0);
        vm.expectPartialRevert(OracleAdapter.SuccessorNotAfterTarget.selector);
        markets.resolve(id, r1, r1 + 1, 0, 0);
    }

    function test_RevertWhen_FakeSuccessor() public {
        uint256 id = _createUpDown(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 100);
        uint80 r1 = feedA.push(185e8, block.timestamp);
        vm.warp(m.closeTime - 50);
        feedA.push(175e8, block.timestamp);
        vm.warp(m.closeTime + 50);
        uint80 r3 = feedA.push(170e8, block.timestamp);
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        vm.expectPartialRevert(OracleAdapter.NotSuccessor.selector);
        markets.resolve(id, r1, r3, 0, 0);
    }

    function test_Settlement_PhaseBoundarySuccessor() public {
        uint256 id = _createUpDown(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 10);
        uint80 r = feedA.push(190e8, block.timestamp);
        uint80 nextPhaseFirst = (uint80(2) << 64) | 1;
        vm.warp(m.closeTime + 10);
        feedA.setRound(nextPhaseFirst, 170e8, block.timestamp);
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        markets.resolve(id, r, nextPhaseFirst, 0, 0);
        assertEq(markets.getMarket(id).closePriceA, 190e8);
    }

    function test_StaleClosePrice_ThenInvalidFallback() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 aliceShares = _buy(alice, id, true, 10 * USDC);
        uint256 bobShares = _buy(bob, id, false, 30 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        // no rounds since creation, and the opening round becomes stale by close (feed frozen)
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        uint80 r = feedA.latestId();
        vm.expectPartialRevert(OracleAdapter.StalePrice.selector);
        markets.resolve(id, r, 0, 0, 0);

        vm.expectRevert(StocMoonMarkets.TooEarly.selector);
        markets.resolveInvalid(id);

        vm.warp(uint256(m.closeTime) + m.resolutionWindow + 1);
        vm.expectRevert(StocMoonMarkets.TooLate.selector);
        markets.resolve(id, r, 0, 0, 0);

        vm.prank(admin);
        markets.pause(); // fallback works even while paused
        vm.prank(carol);
        markets.resolveInvalid(id);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(StocMoonMarkets.Outcome.INVALID));

        vm.prank(alice);
        assertEq(markets.redeem(id), aliceShares / 2);
        vm.prank(bob);
        assertEq(markets.redeem(id), bobShares / 2);
    }

    function test_Battle_PercentageReturnDecides() public {
        uint256 id = _createBattle(100 * USDC);
        uint256 aliceShares = _buy(alice, id, true, 10 * USDC); // NVDA outperforms
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 5);
        // NVDA 180 -> 189 (+5%), TSLA 400 -> 416 (+4%): bigger $ move for TSLA, but NVDA wins on %.
        uint80 ra = feedA.push(189e8, block.timestamp);
        uint80 rb = feedB.push(416e8, block.timestamp);
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        markets.resolve(id, ra, 0, rb, 0);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(StocMoonMarkets.Outcome.YES));
        vm.prank(alice);
        assertEq(markets.redeem(id), aliceShares);
    }

    function test_Battle_EqualReturnsPush() public {
        uint256 id = _createBattle(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 5);
        uint80 ra = feedA.push(198e8, block.timestamp); // +10%
        uint80 rb = feedB.push(440e8, block.timestamp); // +10%
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        markets.resolve(id, ra, 0, rb, 0);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(StocMoonMarkets.Outcome.PUSH));
    }

    function test_Battle_BWins() public {
        uint256 id = _createBattle(100 * USDC);
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        vm.warp(m.closeTime - 5);
        uint80 ra = feedA.push(171e8, block.timestamp); // -5%
        uint80 rb = feedB.push(396e8, block.timestamp); // -1%
        vm.warp(uint256(m.closeTime) + m.settlementDelay);
        markets.resolve(id, ra, 0, rb, 0);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(StocMoonMarkets.Outcome.NO));
    }

    // ============================================================ event markets

    function _createEvent() internal returns (uint256 id) {
        vm.prank(keeper);
        id = markets.createEventMarket(
            NVDA,
            "Will NVIDIA report quarterly revenue above the figure in its prior-quarter guidance?",
            "ipfs://rules",
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 2 days),
            50 * USDC
        );
    }

    function test_EventMarket_ProposeDisputeFinalize() public {
        uint256 id = _createEvent();
        uint256 shares = _buy(alice, id, true, 10 * USDC);

        vm.prank(resolver);
        vm.expectRevert(StocMoonMarkets.TooEarly.selector);
        markets.proposeOutcome(id, StocMoonMarkets.Outcome.YES, "https://investor.example/q3");

        vm.warp(block.timestamp + 2 days);
        vm.prank(mallory);
        vm.expectRevert();
        markets.proposeOutcome(id, StocMoonMarkets.Outcome.YES, "x");

        vm.prank(resolver);
        markets.proposeOutcome(id, StocMoonMarkets.Outcome.NO, "https://wrong");
        vm.prank(admin);
        markets.rejectProposal(id, "evidence contradicts filing");
        assertEq(uint8(markets.getMarket(id).status), uint8(StocMoonMarkets.Status.OPEN));

        vm.prank(resolver);
        markets.proposeOutcome(id, StocMoonMarkets.Outcome.YES, "https://sec.gov/filing");
        vm.expectRevert(StocMoonMarkets.TooEarly.selector);
        markets.finalizeOutcome(id);
        vm.warp(block.timestamp + 1 days);
        vm.prank(admin);
        vm.expectRevert(StocMoonMarkets.TooLate.selector);
        markets.rejectProposal(id, "late");
        markets.finalizeOutcome(id);
        vm.prank(alice);
        assertEq(markets.redeem(id), shares);
    }

    function test_EventMarket_CannotUseOracleResolve() public {
        uint256 id = _createEvent();
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(StocMoonMarkets.WrongKind.selector);
        markets.resolve(id, 1, 0, 0, 0);
    }

    function test_RevertWhen_ProposeOnPriceMarket() public {
        uint256 id = _createUpDown(100 * USDC);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(resolver);
        vm.expectRevert(StocMoonMarkets.WrongKind.selector);
        markets.proposeOutcome(id, StocMoonMarkets.Outcome.YES, "x");
    }

    // ============================================================ emergency & access control

    function test_EmergencyInvalidate() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 shares = _buy(alice, id, true, 10 * USDC);
        vm.prank(mallory);
        vm.expectRevert();
        markets.emergencyInvalidate(id, "x");
        vm.prank(admin);
        markets.emergencyInvalidate(id, "oracle incident");
        vm.prank(alice);
        assertEq(markets.redeem(id), shares / 2);
        vm.prank(admin);
        vm.expectRevert(StocMoonMarkets.WrongStatus.selector);
        markets.emergencyInvalidate(id, "again");
    }

    function test_PauseBlocksRiskButNotExits() public {
        uint256 id = _createUpDown(100 * USDC);
        vm.prank(alice);
        markets.splitPosition(id, 4 * USDC);
        vm.prank(admin);
        markets.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        markets.buy(id, true, 1 * USDC, 0, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        markets.sell(id, true, 1 * USDC, 0, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        markets.addLiquidity(id, 1 * USDC, 0, block.timestamp);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        markets.resolve(id, 1, 0, 0, 0);

        vm.prank(alice);
        markets.mergePositions(id, 4 * USDC); // exit still works
        assertEq(_yes(alice, id), 0);
    }

    function test_RevertWhen_UnauthorizedAdminCalls() public {
        bytes[] memory calls = new bytes[](9);
        calls[0] = abi.encodeCall(StocMoonMarkets.setFees, (1, 1));
        calls[1] = abi.encodeCall(StocMoonMarkets.setWindows, (1, 2 days, 2 hours));
        calls[2] = abi.encodeCall(StocMoonMarkets.setDuration, (uint32(300), true, uint32(0)));
        calls[3] = abi.encodeCall(StocMoonMarkets.setCreationPolicy, (true, 1));
        calls[4] = abi.encodeCall(StocMoonMarkets.setEligibilityRequired, (true));
        calls[5] = abi.encodeCall(StocMoonMarkets.pause, ());
        calls[6] = abi.encodeCall(StocMoonMarkets.setURI, ("x"));
        address[] memory accts = new address[](1);
        accts[0] = mallory;
        calls[7] = abi.encodeCall(StocMoonMarkets.setEligibility, (accts, true));
        calls[8] = abi.encodeCall(StocMoonMarkets.withdrawProtocolFees, (mallory));
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(mallory);
            (bool ok, bytes memory ret) = address(markets).call(calls[i]);
            assertFalse(ok);
            assertEq(bytes4(ret), IAccessControl.AccessControlUnauthorizedAccount.selector);
        }
        vm.prank(mallory);
        vm.expectRevert();
        oracle.configureAsset(NVDA, address(feedB), 1, "X");
        vm.prank(mallory);
        vm.expectRevert();
        oracle.setAssetStatus(NVDA, true, true, "x");
    }

    function test_RevertWhen_FeeAboveCapOrBadWindows() public {
        vm.startPrank(admin);
        vm.expectRevert(StocMoonMarkets.InvalidParams.selector);
        markets.setFees(400, 101);
        vm.expectRevert(StocMoonMarkets.InvalidParams.selector);
        markets.setWindows(2 days, 7 days, 1 days);
        vm.expectRevert(StocMoonMarkets.InvalidParams.selector);
        markets.setDuration(HOUR, true, HOUR);
        vm.stopPrank();
    }

    // ============================================================ eligibility

    function test_EligibilityGate() public {
        uint256 id = _createUpDown(100 * USDC);
        uint256 shares = _buy(alice, id, true, 10 * USDC);
        vm.startPrank(admin);
        markets.grantRole(markets.ELIGIBILITY_ROLE(), admin);
        markets.setEligibilityRequired(true);
        address[] memory list = new address[](1);
        list[0] = bob;
        markets.setEligibility(list, true);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StocMoonMarkets.NotEligible.selector, alice));
        markets.buy(id, true, 1 * USDC, 0, block.timestamp);

        _buy(bob, id, true, 1 * USDC);

        // ineligible users can still exit
        vm.prank(alice);
        markets.sell(id, true, shares / 2, 0, block.timestamp);

        // shares can't be sent to ineligible accounts
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StocMoonMarkets.NotEligible.selector, carol));
        markets.safeTransferFrom(alice, carol, id * 2, 1, "");
        vm.prank(alice);
        markets.safeTransferFrom(alice, bob, id * 2, 1, "");
    }

    // ============================================================ reentrancy

    function test_Reentrancy_FromERC1155HookIsBlocked() public {
        uint256 id = _createUpDown(100 * USDC);
        ReentrantReceiver attacker = new ReentrantReceiver(markets, usdc);
        usdc.mint(address(attacker), 1000 * USDC);

        for (uint8 mode = 1; mode <= 5; ++mode) {
            attacker.arm(id, mode);
            attacker.doBuy(5 * USDC);
            assertTrue(attacker.attempted());
            assertTrue(attacker.reentryBlocked());
        }
        // liquidity path with outcome-share refund also re-enters through the hook
        _buy(alice, id, true, 30 * USDC);
        attacker.arm(id, 1);
        attacker.doAddLiquidity(10 * USDC);
        assertTrue(attacker.reentryBlocked());
        _assertBacked(id);
    }

    // ============================================================ solvency end-to-end

    function test_FullLifecycleSolvency() public {
        uint256 id = _createUpDown(200 * USDC);
        _buy(alice, id, true, 37 * USDC);
        _buy(bob, id, false, 81 * USDC);
        vm.prank(carol);
        markets.addLiquidity(id, 55 * USDC, 0, block.timestamp);
        _buy(alice, id, false, 13 * USDC);
        vm.prank(bob);
        markets.sell(id, false, 20 * USDC, 0, block.timestamp);
        _settleAt(id, 181e8);

        address[4] memory holders = [keeper, alice, bob, carol];
        for (uint256 i; i < holders.length; ++i) {
            uint256 lp = markets.lpShares(id, holders[i]);
            if (lp > 0) {
                vm.prank(holders[i]);
                markets.removeLiquidity(id, lp, 0);
            }
            if (_yes(holders[i], id) + _no(holders[i], id) > 0) {
                vm.prank(holders[i]);
                markets.redeem(id);
            }
        }
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        assertEq(m.collateral, 0);
        assertGe(usdc.balanceOf(address(markets)), markets.protocolFeesAccrued() + markets.lpFeesOutstanding());
    }
}
