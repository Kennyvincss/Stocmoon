// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployIntraday} from "../script/DeployIntraday.s.sol";

contract IntradayIdTest is Test {
    function test_PseudoAssetIdMatchesTypeScript() public {
        DeployIntraday s = new DeployIntraday();
        // value produced by packages/core intradayAssetId() for the NVDA B20 token
        assertEq(s.intradayAssetId(0xb20000000000000000000078ee7ce2fE4908108C), 0x7B0CeC177f409dB546fd0D3644fD7Ef0245aFC3B);
    }
}
