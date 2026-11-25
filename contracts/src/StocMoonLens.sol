// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StocMoonMarkets} from "./StocMoonMarkets.sol";
import {FPMMMath} from "./libraries/FPMMMath.sol";

/// @title StocMoonLens
/// @notice Read-only quoting helpers for StocMoonMarkets. Uses the exact same FPMM math as the hub, so a quote
///         equals the execution result for an unchanged pool. Quotes are indicative: always pass a min-out.
contract StocMoonLens {
    StocMoonMarkets public immutable markets;

    struct MarketView {
        uint256 id;
        StocMoonMarkets.Market market;
        uint256 priceYes; // 1e18 = 100%
        uint256 yesSupply;
        uint256 noSupply;
    }

    constructor(StocMoonMarkets markets_) {
        markets = markets_;
    }

    function priceYes(uint256 id) public view returns (uint256) {
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        return FPMMMath.priceYes(m.poolYes, m.poolNo);
    }

    /// @return shares  shares received
    /// @return fee     total fee in collateral
    /// @return avgPrice average price per share, 1e18 = 1 collateral unit per share
    function quoteBuy(uint256 id, bool isYes, uint256 amountIn)
        external
        view
        returns (uint256 shares, uint256 fee, uint256 avgPrice)
    {
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        if (m.poolYes == 0 || m.poolNo == 0 || amountIn == 0) return (0, 0, 0);
        fee = FPMMMath.fee(amountIn, uint256(m.lpFeeBps) + m.protocolFeeBps);
        if (amountIn <= fee) return (0, fee, 0);
        shares = FPMMMath.calcBuy(m.poolYes, m.poolNo, amountIn - fee, isYes);
        avgPrice = shares == 0 ? 0 : (amountIn * 1e18) / shares;
    }

    function quoteSell(uint256 id, bool isYes, uint256 shares) external view returns (uint256 amountOut, uint256 fee) {
        StocMoonMarkets.Market memory m = markets.getMarket(id);
        if (m.poolYes == 0 || m.poolNo == 0 || shares == 0) return (0, 0);
        uint256 gross = FPMMMath.calcSell(m.poolYes, m.poolNo, shares, isYes);
        fee = FPMMMath.fee(gross, uint256(m.lpFeeBps) + m.protocolFeeBps);
        amountOut = gross - fee;
    }

    function getMarketView(uint256 id) public view returns (MarketView memory v) {
        v.id = id;
        v.market = markets.getMarket(id);
        v.priceYes = FPMMMath.priceYes(v.market.poolYes, v.market.poolNo);
        v.yesSupply = markets.totalSupply(id * 2);
        v.noSupply = markets.totalSupply(id * 2 + 1);
    }

    /// @notice Paginated market list, newest first.
    function listMarkets(uint256 offset, uint256 limit) external view returns (MarketView[] memory out) {
        uint256 count = markets.marketCount();
        if (offset >= count) return out;
        uint256 n = count - offset < limit ? count - offset : limit;
        out = new MarketView[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = getMarketView(count - offset - i);
        }
    }

    /// @notice A user's position across a list of markets.
    function positionsOf(address user, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory yes, uint256[] memory no, uint256[] memory lp, uint256[] memory lpFees)
    {
        yes = new uint256[](ids.length);
        no = new uint256[](ids.length);
        lp = new uint256[](ids.length);
        lpFees = new uint256[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            yes[i] = markets.balanceOf(user, ids[i] * 2);
            no[i] = markets.balanceOf(user, ids[i] * 2 + 1);
            lp[i] = markets.lpShares(ids[i], user);
            lpFees[i] = markets.pendingLpFees(ids[i], user);
        }
    }
}
