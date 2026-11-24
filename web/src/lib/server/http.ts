import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { serverEnv } from "./env";

const buckets = new Map<string, { tokens: number; at: number }>();

/** Token-bucket rate limit per client IP (per server instance; use an edge/WAF limiter in production too). */
export async function rateLimit(name: string, perMinute: number): Promise<NextResponse | null> {
  const ip = await clientIp();
  const key = `${name}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": "10" } });
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) buckets.clear();
  return null;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function ipHash(): Promise<string> {
  return createHash("sha256").update(serverEnv.ipHashSalt + (await clientIp())).digest("hex").slice(0, 32);
}

/** Country from common edge geo headers (Vercel, Cloudflare, CloudFront, Fastly). */
export async function requestCountry(): Promise<string | null> {
  const h = await headers();
  const c =
    h.get("x-vercel-ip-country") || h.get("cf-ipcountry") || h.get("cloudfront-viewer-country") || h.get("fastly-geo-country");
  if (!c || c === "XX" || c === "T1") return null;
  return c.toUpperCase();
}

export function json<T>(data: T, init?: { status?: number; maxAge?: number }) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: init?.maxAge ? { "cache-control": `public, s-maxage=${init.maxAge}, stale-while-revalidate=${init.maxAge * 4}` } : {},
  });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function serialize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}
