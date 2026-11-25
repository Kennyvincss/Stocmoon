import type { Address, Hex } from "viem";
import { chainClient } from "./chain";
import { db } from "./db";

const MAX_AGE_MS = 10 * 60_000;

/**
 * Verifies a wallet signature over `message` (EOA, ERC-1271 and ERC-6492 smart wallets via viem),
 * checks freshness and consumes the nonce (replay protection).
 */
export async function verifySigned(opts: { address: Address; message: string; signature: Hex; nonce: string; issuedAt: string }) {
  const issued = Date.parse(opts.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > MAX_AGE_MS) return { ok: false as const, error: "Signature expired" };
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(opts.nonce)) return { ok: false as const, error: "Bad nonce" };
  const valid = await chainClient()
    .verifyMessage({ address: opts.address, message: opts.message, signature: opts.signature })
    .catch(() => false);
  if (!valid) return { ok: false as const, error: "Invalid signature" };
  const sql = db();
  if (sql) {
    const res = await sql`insert into used_nonces (nonce, address) values (${opts.nonce}, ${opts.address.toLowerCase()}) on conflict do nothing`;
    if (res.count === 0) return { ok: false as const, error: "Nonce already used" };
  } else {
    if (usedInMemory.has(opts.nonce)) return { ok: false as const, error: "Nonce already used" };
    usedInMemory.add(opts.nonce);
  }
  return { ok: true as const };
}

const usedInMemory = new Set<string>();

export { PROFILE_MESSAGE } from "../messages";
