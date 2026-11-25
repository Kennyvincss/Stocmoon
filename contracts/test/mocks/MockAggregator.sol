// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

/// @notice Test aggregator with explicit round ids (supports Chainlink phase-encoded ids). Missing rounds revert,
///         like OCR2 aggregators behind a proxy.
contract MockAggregator is AggregatorV3Interface {
    struct R {
        int256 answer;
        uint256 updatedAt;
        bool exists;
    }

    uint8 public immutable override decimals;
    uint80 public latestId;
    bool public revertLatest;
    mapping(uint80 => R) public rounds;

    constructor(uint8 d) {
        decimals = d;
    }

    function description() external pure returns (string memory) {
        return "MOCK / USD";
    }

    function version() external pure returns (uint256) {
        return 4;
    }

    function setRound(uint80 id, int256 answer, uint256 updatedAt) public {
        rounds[id] = R(answer, updatedAt, true);
        if (id > latestId) latestId = id;
    }

    /// @notice Push next round in the current phase.
    function push(int256 answer, uint256 updatedAt) external returns (uint80 id) {
        id = latestId == 0 ? (uint80(1) << 64) | 1 : latestId + 1;
        setRound(id, answer, updatedAt);
    }

    function setRevertLatest(bool v) external {
        revertLatest = v;
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        R memory r = rounds[id];
        require(r.exists, "No data present");
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!revertLatest, "down");
        R memory r = rounds[latestId];
        return (latestId, r.answer, r.updatedAt, r.updatedAt, latestId);
    }
}
