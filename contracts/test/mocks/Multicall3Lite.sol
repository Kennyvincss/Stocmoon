// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice LOCAL TESTING ONLY: minimal Multicall3 (`aggregate3`) installed at the canonical address on anvil so viem's
///         multicall batching works like on Base. Not deployed to any public network.
contract Multicall3Lite {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData) {
        returnData = new Result[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call(calls[i].callData);
            require(ok || calls[i].allowFailure, "Multicall3: call failed");
            returnData[i] = Result(ok, ret);
        }
    }
}
