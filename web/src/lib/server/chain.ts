import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import { chainFor } from "@stocmoon/core";
import { publicEnv } from "../public-env";
import { serverEnv } from "./env";

let appClient: PublicClient | undefined;
let mainClient: PublicClient | undefined;

/** Client for the chain the markets are deployed on (Base Sepolia by default). */
export function chainClient(): PublicClient {
  appClient ??= createPublicClient({
    chain: chainFor(publicEnv.chainId),
    transport: http(serverEnv.rpcUrl, { timeout: 10_000, retryCount: 2 }),
    batch: { multicall: true },
  }) as PublicClient;
  return appClient;
}

/** Base mainnet client, read-only, used for real Chainlink reference data. */
export function mainnetClient(): PublicClient {
  mainClient ??= createPublicClient({
    chain: base,
    transport: http(serverEnv.mainnetRpcUrl, { timeout: 10_000, retryCount: 2 }),
    batch: { multicall: true },
  }) as PublicClient;
  return mainClient;
}
