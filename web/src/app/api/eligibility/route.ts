import { createWalletClient, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { chainFor, ELIGIBILITY_MESSAGE, isCountryBlocked, stocMoonMarketsAbi } from "@stocmoon/core";
import { bad, ipHash, json, rateLimit, requestCountry } from "@/lib/server/http";
import { serverEnv } from "@/lib/server/env";
import { chainClient } from "@/lib/server/chain";
import { db } from "@/lib/server/db";
import { verifySigned } from "@/lib/server/signed";
import { publicEnv } from "@/lib/public-env";

export const dynamic = "force-dynamic";

async function geo() {
  const country = await requestCountry();
  const blocked = country ? isCountryBlocked(country, serverEnv.blockedCountries) : !serverEnv.allowUnknownCountry;
  return {
    country,
    blocked,
    reason: blocked
      ? country
        ? `Trading is not available in your jurisdiction (${country}).`
        : "We could not determine your jurisdiction, so trading is disabled."
      : null,
  };
}

async function onchainStatus(address?: string) {
  if (!publicEnv.markets) return { eligibilityRequired: false, onchainEligible: null as boolean | null };
  const c = chainClient();
  const required = await c
    .readContract({ address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "eligibilityRequired" })
    .catch(() => false);
  const eligible = address
    ? await c
        .readContract({ address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "isEligible", args: [getAddress(address)] })
        .catch(() => null)
    : null;
  return { eligibilityRequired: required, onchainEligible: eligible };
}

export async function GET(req: Request) {
  const limited = await rateLimit("eligibility", 60);
  if (limited) return limited;
  const address = new URL(req.url).searchParams.get("address") ?? undefined;
  if (address && !isAddress(address, { strict: false })) return bad("Invalid address");
  const g = await geo();
  let attested = false;
  const sql = db();
  if (sql && address) {
    const rows = await sql`select 1 from eligibility_attestations where address = ${address.toLowerCase()} limit 1`;
    attested = rows.length > 0;
  }
  return json({ ...g, attested, ...(await onchainStatus(address)) });
}

const Body = z.object({
  address: z.string().refine((a) => isAddress(a, { strict: false })),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  nonce: z.string(),
  issuedAt: z.string(),
});

export async function POST(req: Request) {
  const limited = await rateLimit("eligibility-post", 10);
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Invalid request");
  const g = await geo();
  if (g.blocked) return bad(g.reason ?? "Restricted", 451);
  const address = getAddress(parsed.data.address);
  const country = g.country ?? "unknown";
  const message = ELIGIBILITY_MESSAGE(address, country, parsed.data.nonce, parsed.data.issuedAt);
  const v = await verifySigned({
    address, message, signature: parsed.data.signature as Hex, nonce: parsed.data.nonce, issuedAt: parsed.data.issuedAt,
  });
  if (!v.ok) return bad(v.error, 401);

  let txHash: string | null = null;
  const status = await onchainStatus(address);
  if (status.eligibilityRequired && !status.onchainEligible && serverEnv.eligibilitySignerKey && publicEnv.markets) {
    const account = privateKeyToAccount(serverEnv.eligibilitySignerKey as Hex);
    const wallet = createWalletClient({ account, chain: chainFor(publicEnv.chainId), transport: http(serverEnv.rpcUrl) });
    txHash = await wallet.writeContract({
      address: publicEnv.markets, abi: stocMoonMarketsAbi, functionName: "setEligibility", args: [[address], true],
    });
  }
  const sql = db();
  if (sql) {
    await sql`insert into eligibility_attestations (address, country, message, signature, nonce, ip_hash, onchain_tx)
      values (${address.toLowerCase()}, ${country}, ${message}, ${parsed.data.signature}, ${parsed.data.nonce}, ${await ipHash()}, ${txHash})
      on conflict (nonce) do nothing`;
  }
  return json({ ok: true, txHash, eligibilityRequired: status.eligibilityRequired, persisted: Boolean(sql) });
}
