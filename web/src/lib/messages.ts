/** Messages users sign (off-chain, no transaction). Shared by client and server. */
export const PROFILE_MESSAGE = (address: string, username: string, avatarUrl: string, nonce: string, issuedAt: string) =>
  ["StocMoon profile update", "", `Wallet: ${address}`, `Username: ${username}`, `Avatar: ${avatarUrl || "-"}`, "",
    "This signature does not authorize any transaction.", `Nonce: ${nonce}`, `Issued at: ${issuedAt}`].join("\n");
