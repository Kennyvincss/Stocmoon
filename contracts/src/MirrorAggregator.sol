// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title MirrorAggregator
/// @notice TESTNET ONLY. Chainlink tokenized-equity feeds for Coinbase B20 stocks exist on Base mainnet
///         but not on Base Sepolia. This contract mirrors rounds of one mainnet feed onto testnet so the
///         StocMoon market contracts can be exercised end-to-end with real reference prices.
/// @dev    Trust assumption: the RELAYER_ROLE copies rounds faithfully. Every mirrored round records the
///         source (mainnet) round id and the source `updatedAt`, so anyone can audit it against the
///         mainnet proxy `getRoundData(sourceRoundId)`. On mainnet StocMoon reads the Chainlink proxy
///         directly and this contract is not deployed.
contract MirrorAggregator is AggregatorV3Interface, AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    struct MirroredRound {
        int256 answer;
        uint64 startedAt;
        uint64 updatedAt;
        uint80 sourceRoundId;
    }

    uint8 public immutable override decimals;
    /// @notice Chain id of the source feed (8453 for Base mainnet).
    uint256 public immutable sourceChainId;
    /// @notice Address of the source Chainlink proxy on `sourceChainId`.
    address public immutable sourceFeed;
    string private _description;

    uint80 public latestRound;
    uint80 public lastSourceRoundId;
    mapping(uint80 => MirroredRound) private _rounds;

    event RoundMirrored(
        uint80 indexed roundId, uint80 indexed sourceRoundId, int256 answer, uint256 startedAt, uint256 updatedAt
    );

    error NoDataPresent();
    error InvalidAnswer();
    error NonMonotonicRound();
    error TimestampInFuture();

    constructor(
        address admin,
        address relayer,
        uint8 decimals_,
        string memory description_,
        uint256 sourceChainId_,
        address sourceFeed_
    ) {
        decimals = decimals_;
        _description = description_;
        sourceChainId = sourceChainId_;
        sourceFeed = sourceFeed_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RELAYER_ROLE, relayer);
    }

    function description() external view override returns (string memory) {
        return string.concat("StocMoon testnet mirror: ", _description);
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    /// @notice Mirror one source round. Rounds must be pushed in source order.
    function pushRound(uint80 sourceRoundId, int256 answer, uint256 startedAt, uint256 updatedAt)
        external
        onlyRole(RELAYER_ROLE)
    {
        if (answer <= 0) revert InvalidAnswer();
        if (updatedAt > block.timestamp) revert TimestampInFuture();
        if (sourceRoundId <= lastSourceRoundId) revert NonMonotonicRound();
        if (latestRound != 0 && updatedAt <= _rounds[latestRound].updatedAt) revert NonMonotonicRound();
        if (startedAt > updatedAt) startedAt = updatedAt;

        uint80 id = latestRound + 1;
        _rounds[id] = MirroredRound({
            answer: answer, startedAt: uint64(startedAt), updatedAt: uint64(updatedAt), sourceRoundId: sourceRoundId
        });
        latestRound = id;
        lastSourceRoundId = sourceRoundId;
        emit RoundMirrored(id, sourceRoundId, answer, startedAt, updatedAt);
    }

    function sourceRoundOf(uint80 roundId) external view returns (uint80) {
        if (roundId == 0 || roundId > latestRound) revert NoDataPresent();
        return _rounds[roundId].sourceRoundId;
    }

    function getRoundData(uint80 roundId) public view override returns (uint80, int256, uint256, uint256, uint80) {
        if (roundId == 0 || roundId > latestRound) revert NoDataPresent();
        MirroredRound memory r = _rounds[roundId];
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return getRoundData(latestRound);
    }
}
