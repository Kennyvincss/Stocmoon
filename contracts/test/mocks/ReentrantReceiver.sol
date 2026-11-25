// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StocMoonMarkets} from "../../src/StocMoonMarkets.sol";

/// @notice Attempts to re-enter the hub from the ERC-1155 receive hook.
contract ReentrantReceiver is IERC1155Receiver {
    StocMoonMarkets public immutable markets;
    uint256 public marketId;
    uint8 public mode; // 1 = buy, 2 = sell, 3 = redeem, 4 = removeLiquidity, 5 = merge
    bool public attempted;
    bool public reentryBlocked;

    constructor(StocMoonMarkets m, IERC20 usdc) {
        markets = m;
        usdc.approve(address(m), type(uint256).max);
    }

    function arm(uint256 id, uint8 mode_) external {
        marketId = id;
        mode = mode_;
        attempted = false;
        reentryBlocked = false;
    }

    function doBuy(uint256 amount) external {
        markets.buy(marketId, true, amount, 0, block.timestamp);
    }

    function doRemoveLiquidity(uint256 shares) external {
        markets.removeLiquidity(marketId, shares, 0);
    }

    function doAddLiquidity(uint256 amount) external {
        markets.addLiquidity(marketId, amount, 0, block.timestamp);
    }

    function _reenter() internal {
        if (attempted || mode == 0) return;
        attempted = true;
        bytes memory data;
        if (mode == 1) data = abi.encodeCall(StocMoonMarkets.buy, (marketId, true, 1e6, 0, block.timestamp));
        else if (mode == 2) data = abi.encodeCall(StocMoonMarkets.sell, (marketId, true, 1e5, 0, block.timestamp));
        else if (mode == 3) data = abi.encodeCall(StocMoonMarkets.redeem, (marketId));
        else if (mode == 4) data = abi.encodeCall(StocMoonMarkets.removeLiquidity, (marketId, 1, 0));
        else data = abi.encodeCall(StocMoonMarkets.mergePositions, (marketId, 1));
        (bool ok, bytes memory ret) = address(markets).call(data);
        if (!ok && ret.length >= 4 && bytes4(ret) == bytes4(keccak256("ReentrancyGuardReentrantCall()"))) {
            reentryBlocked = true;
        }
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        _reenter();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        returns (bytes4)
    {
        _reenter();
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC1155Receiver).interfaceId || id == 0x01ffc9a7;
    }
}
