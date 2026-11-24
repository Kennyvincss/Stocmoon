import { parseCountryList } from "@stocmoon/core";

/** Server-only configuration. Do not import from client components. */
export const serverEnv = {
  databaseUrl: process.env.DATABASE_URL || undefined,
  rpcUrl: process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || undefined,
  mainnetRpcUrl: process.env.MAINNET_RPC_URL || "https://mainnet.base.org",
  blockedCountries: parseCountryList(process.env.BLOCKED_COUNTRIES),
  /** Development only: treat requests without geo headers as allowed. Never enable in production. */
  allowUnknownCountry: process.env.ALLOW_UNKNOWN_COUNTRY === "true",
  eligibilitySignerKey: process.env.ELIGIBILITY_SIGNER_PRIVATE_KEY || undefined,
  deployBlock: BigInt(process.env.DEPLOY_BLOCK || "0"),
  tokenizedStocksApi: process.env.TOKENIZED_STOCKS_API_URL || undefined,
  ipHashSalt: process.env.IP_HASH_SALT || "stocmoon",
};
