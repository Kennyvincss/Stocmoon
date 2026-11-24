import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { chainFor } from "@stocmoon/core";
import { env } from "./env";

export function appClient(): PublicClient {
  const chain = chainFor(Number(env("CHAIN_ID", "84532")));
  return createPublicClient({ chain, transport: http(env("RPC_URL", chain.rpcUrls.default.http[0])), batch: { multicall: true } }) as PublicClient;
}

/** Source of real Chainlink data (Base mainnet). Overridable for local tests. */
export function sourceClient(): PublicClient {
  const url = env("SOURCE_RPC_URL", env("MAINNET_RPC_URL", "https://mainnet.base.org"));
  const chainId = Number(env("SOURCE_CHAIN_ID", "8453"));
  return createPublicClient({ chain: chainId === 8453 ? base : chainFor(chainId), transport: http(url), batch: { multicall: true } }) as PublicClient;
}

export function walletFor(key: Hex): WalletClient & { account: ReturnType<typeof privateKeyToAccount> } {
  const chain = chainFor(Number(env("CHAIN_ID", "84532")));
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain, transport: http(env("RPC_URL", chain.rpcUrls.default.http[0])) }) as never;
}
