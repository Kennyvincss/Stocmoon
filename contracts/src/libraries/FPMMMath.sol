// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title FPMMMath
/// @notice Binary fixed-product market maker math over outcome-share balances (y = YES pool, n = NO pool).
///         All rounding favours the pool.
library FPMMMath {
    uint256 internal constant BPS = 10_000;

    error InvariantViolation();

    /// @notice Fee charged on `amount` at `feeBps`, rounded up.
    function fee(uint256 amount, uint256 feeBps) internal pure returns (uint256) {
        if (feeBps == 0) return 0;
        return Math.mulDiv(amount, feeBps, BPS, Math.Rounding.Ceil);
    }

    /// @notice Shares bought with `net` collateral (after fee). The pool mints `net` complete sets and keeps
    ///         y·n constant: shares = y + net − ⌈y·n / (n + net)⌉ for YES (symmetric for NO).
    function calcBuy(uint256 y, uint256 n, uint256 net, bool isYes) internal pure returns (uint256) {
        if (isYes) {
            uint256 newY = Math.mulDiv(y, n, n + net, Math.Rounding.Ceil);
            return y + net - newY;
        }
        uint256 newN = Math.mulDiv(y, n, y + net, Math.Rounding.Ceil);
        return n + net - newN;
    }

    /// @notice Complete sets released (gross collateral) when selling exactly `s` shares. Solves
    ///         (a + s − c)(b − c) = a·b for the smaller root c, with a = pool of the sold side, b = other side.
    ///         sqrt is rounded up (c rounded down); the invariant is re-checked.
    function calcSell(uint256 y, uint256 n, uint256 s, bool isYes) internal pure returns (uint256 c) {
        (uint256 a, uint256 b) = isYes ? (y, n) : (n, y);
        uint256 sum = a + s + b;
        uint256 disc = sum * sum - 4 * s * b;
        uint256 root = Math.sqrt(disc, Math.Rounding.Ceil);
        c = (sum - root) / 2;
        if (c >= b) revert InvariantViolation();
        if ((a + s - c) * (b - c) < a * b) revert InvariantViolation();
    }

    /// @notice Marginal YES probability, 1e18 = 100%.
    function priceYes(uint256 y, uint256 n) internal pure returns (uint256) {
        uint256 sum = y + n;
        if (sum == 0) return 5e17;
        return Math.mulDiv(n, 1e18, sum);
    }
}
