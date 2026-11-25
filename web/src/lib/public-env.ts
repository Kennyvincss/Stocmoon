import type { Address } from "viem";
import { USDC_ADDRESSES } from "@stocmoon/core";

const addr = (v: string | undefined): Address | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);

/** Values safe to expose to the browser. Never put secrets in NEXT_PUBLIC_* variables. */
export const publicEnv = {
  chainId,
  markets: addr(process.env.NEXT_PUBLIC_MARKETS_ADDRESS),
  lens: addr(process.env.NEXT_PUBLIC_LENS_ADDRESS),
  oracle: addr(process.env.NEXT_PUBLIC_ORACLE_ADDRESS),
  usdc: addr(process.env.NEXT_PUBLIC_USDC_ADDRESS) ?? USDC_ADDRESSES[chainId],
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || undefined,
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined,
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
};

export const contractsConfigured = Boolean(publicEnv.markets && publicEnv.lens && publicEnv.oracle && publicEnv.usdc);
export const isTestnet = chainId !== 8453;
