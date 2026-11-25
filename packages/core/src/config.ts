import { base, baseSepolia, foundry } from "viem/chains";
import type { Address, Chain } from "viem";

export const SUPPORTED_CHAINS = { [base.id]: base, [baseSepolia.id]: baseSepolia, [foundry.id]: foundry } as const;

export const EXPLORERS: Record<number, string> = {
  [base.id]: "https://basescan.org",
  [baseSepolia.id]: "https://sepolia.basescan.org",
  [foundry.id]: "",
};

/** Circle USDC. Base Sepolia test USDC has no value. */
export const USDC_ADDRESSES: Record<number, Address> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export const COLLATERAL_DECIMALS = 6;

export interface Deployment {
  chainId: number;
  markets: Address;
  lens: Address;
  oracleAdapter: Address;
  usdc: Address;
  deployBlock: bigint;
}

export function chainFor(id: number): Chain {
  const c = SUPPORTED_CHAINS[id as keyof typeof SUPPORTED_CHAINS];
  if (!c) throw new Error(`Unsupported chain ${id}`);
  return c;
}

export function explorerTx(chainId: number, hash: string): string | null {
  const e = EXPLORERS[chainId];
  return e ? `${e}/tx/${hash}` : null;
}

export function explorerAddress(chainId: number, addr: string): string | null {
  const e = EXPLORERS[chainId];
  return e ? `${e}/address/${addr}` : null;
}

/** Jurisdictions blocked by default: US (Base Stocks Maxxing rule) + comprehensively sanctioned countries. */
export const DEFAULT_BLOCKED_COUNTRIES = ["US", "CU", "IR", "KP", "SY"];

export function parseCountryList(v: string | undefined): string[] {
  if (!v) return DEFAULT_BLOCKED_COUNTRIES;
  return v
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
}

export function isCountryBlocked(country: string | null | undefined, blocked: string[]): boolean {
  // Unknown country => blocked (fail closed) unless explicitly allowed by deployment config.
  if (!country) return true;
  return blocked.includes(country.toUpperCase());
}

export const ELIGIBILITY_MESSAGE = (address: string, country: string, nonce: string, issuedAt: string) =>
  [
    "StocMoon eligibility attestation",
    "",
    `Wallet: ${address}`,
    `Detected country: ${country}`,
    "",
    "I confirm that I am not a resident or citizen of the United States or any restricted jurisdiction,",
    "that I am at least 18 years old, and that I have read the StocMoon Terms and Risk Disclosure.",
    "This signature does not authorize any transaction or spend any funds.",
    "",
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
