import { getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";
import { bad, json, rateLimit } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { verifySigned } from "@/lib/server/signed";
import { PROFILE_MESSAGE } from "@/lib/messages";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = await rateLimit("profile", 120);
  if (limited) return limited;
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !isAddress(address, { strict: false })) return bad("Invalid address");
  const sql = db();
  if (!sql) return json({ profile: null, available: false });
  const [row] = await sql<{ username: string | null; avatar_url: string | null }[]>`
    select username, avatar_url from users where address = ${address.toLowerCase()}`;
  return json({ profile: row ? { username: row.username, avatarUrl: row.avatar_url } : null, available: true });
}

const Body = z.object({
  address: z.string().refine((a) => isAddress(a, { strict: false })),
  username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, "3–20 letters, numbers or _"),
  avatarUrl: z.union([z.literal(""), z.string().url().startsWith("https://").max(500)]),
  nonce: z.string(),
  issuedAt: z.string(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export async function POST(req: Request) {
  const limited = await rateLimit("profile-post", 10);
  if (limited) return limited;
  const sql = db();
  if (!sql) return bad("Profiles need the database (DATABASE_URL) to be configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Invalid request");
  const { username, avatarUrl, nonce, issuedAt, signature } = parsed.data;
  const address = getAddress(parsed.data.address);
  const message = PROFILE_MESSAGE(address, username, avatarUrl, nonce, issuedAt);
  const v = await verifySigned({ address, message, signature: signature as Hex, nonce, issuedAt });
  if (!v.ok) return bad(v.error, 401);
  try {
    await sql`insert into users (address, username, avatar_url) values (${address.toLowerCase()}, ${username}, ${avatarUrl || null})
      on conflict (address) do update set username = excluded.username, avatar_url = excluded.avatar_url, updated_at = now()`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return bad("Username already taken", 409);
    throw e;
  }
  return json({ ok: true });
}
