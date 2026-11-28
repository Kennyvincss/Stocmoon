import { ensureSchema, syncIndex } from "@stocmoon/core";
import { publicEnv } from "../public-env";
import { chainClient } from "./chain";
import { db } from "./db";
import { serverEnv } from "./env";

/**
 * On-demand indexing for serverless hosting (e.g. Vercel + a free Supabase Postgres): no separate indexer process.
 * The first request creates the schema; afterwards requests catch up on new contract events at most every 15s,
 * a bounded number of blocks per call so pages stay fast. Safe to call from many requests (single-flight).
 */
let schema: Promise<unknown> | null = null;
let lastSync = 0;
let inflight: Promise<void> | null = null;

export async function withSchema(): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  schema ??= ensureSchema(sql).catch((e) => {
    schema = null;
    throw e;
  });
  await schema;
  return true;
}

export async function ensureIndexed(): Promise<void> {
  if (!publicEnv.markets) return;
  try {
    if (!(await withSchema())) return;
    if (Date.now() - lastSync < 15_000) return;
    inflight ??= (async () => {
      try {
        await syncIndex(db()!, chainClient(), {
          chainId: publicEnv.chainId, markets: publicEnv.markets!, deployBlock: serverEnv.deployBlock, maxBlocks: 0n,
        });
        lastSync = Date.now();
      } finally {
        inflight = null;
      }
    })();
    await inflight;
  } catch (e) {
    // indexing problems must never break the page; it retries on the next request
    console.error("[sync] indexing failed:", (e as Error).message.slice(0, 200));
  }
}
