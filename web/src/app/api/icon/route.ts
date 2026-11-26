import { NextResponse } from "next/server";
import { bad, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Same-origin proxy for Coinbase stock icons. metadata.coinbase.com serves them as `binary/octet-stream` with
 * `x-content-type-options: nosniff`, which Safari / iOS wallets refuse to render as images. Only that host is
 * allowed (no open proxy / SSRF), responses are size-capped, typed from magic bytes and cached for a day.
 */
const ALLOWED_HOST = "metadata.coinbase.com";
const MAX_BYTES = 2_000_000;

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null; // SVG and anything else is refused (SVG can carry script)
}

export async function GET(req: Request) {
  const limited = await rateLimit("icon", 600);
  if (limited) return limited;
  const src = new URL(req.url).searchParams.get("src");
  let url: URL;
  try {
    url = new URL(src ?? "");
  } catch {
    return bad("Invalid src");
  }
  if (url.protocol !== "https:" || url.hostname !== ALLOWED_HOST) return bad("Host not allowed", 403);
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!res || !res.ok) return bad("Icon unavailable", 502);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) return bad("Icon too large", 502);
  const type = sniff(buf);
  if (!type) return bad("Unsupported image", 502);
  return new NextResponse(buf, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
    },
  });
}
