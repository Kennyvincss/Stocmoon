// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title OracleAdapter
/// @notice Registry of supported tokenized stocks (keyed by B20 token contract address) and validation of
///         Chainlink reference prices for market opening and settlement.
/// @dev    Settlement validation (`priceAt`) is a pure function of the feed address and parameters that the
///         market snapshotted at creation, so changing the registry never alters an existing market's rules.
contract OracleAdapter is AccessControl {
    bytes32 public constant ASSET_ADMIN_ROLE = keccak256("ASSET_ADMIN_ROLE");

    uint32 public constant MAX_STALENESS_LIMIT = 7 days;

    struct Asset {
        address feed;
        uint32 maxStaleness;
        uint8 decimals;
        bool enabled;
        bool paused;
    }

    mapping(address asset => Asset) private _assets;
    address[] private _assetList;

    event AssetConfigured(
        address indexed asset, address indexed feed, uint32 maxStaleness, uint8 decimals, string symbol
    );
    event AssetStatusChanged(address indexed asset, bool enabled, bool paused, string reason);

    error UnknownAsset(address asset);
    error AssetDisabled(address asset);
    error AssetPaused(address asset);
    error InvalidConfig();
    error InvalidPrice();
    error StalePrice(uint256 updatedAt, uint256 referenceTime, uint32 maxStaleness);
    error InvalidRound(uint80 roundId);
    error RoundAfterTarget(uint80 roundId, uint256 updatedAt, uint256 target);
    error NotSuccessor(uint80 roundId, uint80 nextRoundId);
    error SuccessorNotAfterTarget(uint80 nextRoundId, uint256 updatedAt, uint256 target);
    error NotLatestRound(uint80 roundId, uint80 latestRoundId);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ASSET_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------- admin

    /// @param asset B20 token contract address (Base mainnet) used as the asset identity.
    /// @param feed  Chainlink proxy (mainnet) or MirrorAggregator (testnet).
    function configureAsset(address asset, address feed, uint32 maxStaleness, string calldata symbol)
        external
        onlyRole(ASSET_ADMIN_ROLE)
    {
        if (asset == address(0) || feed == address(0)) revert InvalidConfig();
        if (maxStaleness == 0 || maxStaleness > MAX_STALENESS_LIMIT) revert InvalidConfig();
        uint8 dec = AggregatorV3Interface(feed).decimals();
        if (_assets[asset].feed == address(0)) _assetList.push(asset);
        Asset storage a = _assets[asset];
        a.feed = feed;
        a.maxStaleness = maxStaleness;
        a.decimals = dec;
        a.enabled = true;
        emit AssetConfigured(asset, feed, maxStaleness, dec, symbol);
        emit AssetStatusChanged(asset, true, a.paused, "configured");
    }

    /// @notice Enable/disable or pause an asset for NEW markets and trading. Never affects settlement.
    function setAssetStatus(address asset, bool enabled, bool paused, string calldata reason)
        external
        onlyRole(ASSET_ADMIN_ROLE)
    {
        Asset storage a = _assets[asset];
        if (a.feed == address(0)) revert UnknownAsset(asset);
        a.enabled = enabled;
        a.paused = paused;
        emit AssetStatusChanged(asset, enabled, paused, reason);
    }

    // ---------------------------------------------------------------- views

    function getAsset(address asset) external view returns (Asset memory) {
        return _assets[asset];
    }

    function assetCount() external view returns (uint256) {
        return _assetList.length;
    }

    function assetAt(uint256 i) external view returns (address) {
        return _assetList[i];
    }

    /// @notice Reverts unless the asset is enabled, unpaused and its feed answer is valid and fresh.
    function requireActive(address asset) public view returns (Asset memory a) {
        a = _assets[asset];
        if (a.feed == address(0)) revert UnknownAsset(asset);
        if (!a.enabled) revert AssetDisabled(asset);
        if (a.paused) revert AssetPaused(asset);
    }

    /// @notice Latest valid, fresh price for opening a market.
    function latestPrice(address asset)
        external
        view
        returns (int256 price, uint80 roundId, uint256 updatedAt, address feed, uint32 maxStaleness)
    {
        Asset memory a = requireActive(asset);
        (roundId, price, updatedAt) = _latest(a.feed);
        if (block.timestamp - updatedAt > a.maxStaleness) {
            revert StalePrice(updatedAt, block.timestamp, a.maxStaleness);
        }
        return (price, roundId, updatedAt, a.feed, a.maxStaleness);
    }

    /// @notice Non-reverting status for UIs/keepers.
    function isTradable(address asset) external view returns (bool) {
        Asset memory a = _assets[asset];
        if (a.feed == address(0) || !a.enabled || a.paused) return false;
        try AggregatorV3Interface(a.feed).latestRoundData() returns (uint80, int256 ans, uint256, uint256 upd, uint80) {
            return ans > 0 && upd != 0 && upd <= block.timestamp && block.timestamp - upd <= a.maxStaleness;
        } catch {
            return false;
        }
    }

    /// @notice Price in effect at `target` time, proved by round ids.
    /// @param roundId     Round whose `updatedAt <= target`.
    /// @param nextRoundId Immediate successor of `roundId` with `updatedAt > target`, or 0 if `roundId` is the
    ///                    feed's latest round.
    /// @return price      Feed answer of `roundId`.
    /// @return updatedAt  Timestamp of `roundId`.
    function priceAt(address feed, uint80 roundId, uint80 nextRoundId, uint256 target, uint32 maxStaleness)
        external
        view
        returns (int256 price, uint256 updatedAt)
    {
        (bool ok, int256 ans, uint256 upd) = _round(feed, roundId);
        if (!ok) revert InvalidRound(roundId);
        if (upd > target) revert RoundAfterTarget(roundId, upd, target);
        if (target - upd > maxStaleness) revert StalePrice(upd, target, maxStaleness);

        if (nextRoundId == 0) {
            (uint80 latestId,,) = _latest(feed);
            if (latestId != roundId) revert NotLatestRound(roundId, latestId);
        } else {
            if (!_isSuccessor(feed, roundId, nextRoundId)) revert NotSuccessor(roundId, nextRoundId);
            (bool okNext,, uint256 updNext) = _round(feed, nextRoundId);
            if (!okNext) revert InvalidRound(nextRoundId);
            if (updNext <= target) revert SuccessorNotAfterTarget(nextRoundId, updNext, target);
        }
        return (ans, upd);
    }

    // ---------------------------------------------------------------- internal

    function _latest(address feed) internal view returns (uint80 roundId, int256 price, uint256 updatedAt) {
        (roundId, price,, updatedAt,) = AggregatorV3Interface(feed).latestRoundData();
        if (price <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert InvalidPrice();
    }

    /// @dev Returns ok=false for rounds that revert or carry no data; also rejects non-positive answers.
    function _round(address feed, uint80 roundId) internal view returns (bool ok, int256 answer, uint256 updatedAt) {
        try AggregatorV3Interface(feed).getRoundData(roundId) returns (
            uint80, int256 ans, uint256, uint256 upd, uint80
        ) {
            if (upd == 0) return (false, 0, 0);
            if (ans <= 0) revert InvalidPrice();
            return (true, ans, upd);
        } catch {
            return (false, 0, 0);
        }
    }

    /// @dev Chainlink proxy round ids are `(phaseId << 64) | aggregatorRoundId`. The successor is either the
    ///      next aggregator round in the same phase or, if that does not exist, round 1 of the next phase.
    function _isSuccessor(address feed, uint80 roundId, uint80 nextRoundId) internal view returns (bool) {
        if (nextRoundId == roundId + 1) return true;
        uint80 phase = roundId >> 64;
        uint80 firstOfNextPhase = ((phase + 1) << 64) | 1;
        if (nextRoundId != firstOfNextPhase) return false;
        (bool exists,,) = _round(feed, roundId + 1);
        return !exists;
    }
}
