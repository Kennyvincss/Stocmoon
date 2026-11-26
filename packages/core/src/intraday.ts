import { encodePacked, getAddress, keccak256, type Address } from "viem";

/**
 * Intraday (5m–4H) markets settle on a separate, faster feed per stock (testnet: Alpaca IEX last trade published
 * onchain by the operator). Each such feed is registered in the OracleAdapter under a deterministic pseudo asset id,
 * so the B20 token's own entry (Chainlink) is untouched and both can coexist without a contract change.
 *
 *   intradayAssetId(token) = address(uint160(uint256(keccak256(abi.encodePacked("stocmoon.intraday", token)))))
 */
export function intradayAssetId(token: Address): Address {
  const h = keccak256(encodePacked(["string", "address"], ["stocmoon.intraday", getAddress(token)]));
  return getAddress(`0x${h.slice(-40)}`);
}

/** Durations served by intraday feeds (seconds). Longer durations settle on Chainlink. */
export const INTRADAY_DURATIONS = [300, 900, 1800, 3600, 14400] as const;
export const isIntradayDuration = (d: number) => (INTRADAY_DURATIONS as readonly number[]).includes(d);
