import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env ${name}`);
  return v;
}

export const optEnv = (name: string) => (process.env[name] ? process.env[name] : undefined);

export function privateKey(name: string): Hex {
  const v = env(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} is not a 32-byte hex private key`);
  return v as Hex;
}

export interface DeploymentFile {
  chainId: number;
  markets: Address;
  lens: Address;
  oracleAdapter: Address;
  usdc: Address;
  deployBlock: number;
}

/** Contract addresses from env, or from contracts/deployments/<chainId>.json. */
export function deployment(): DeploymentFile {
  const chainId = Number(env("CHAIN_ID", "84532"));
  const file = optEnv("DEPLOYMENT_FILE") ?? join(ROOT, "contracts/deployments", `${chainId}.json`);
  const fromFile = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<DeploymentFile>) : {};
  const pick = (k: keyof DeploymentFile, e: string) => (optEnv(e) ?? fromFile[k]) as never;
  const d: DeploymentFile = {
    chainId,
    markets: pick("markets", "MARKETS_ADDRESS"),
    lens: pick("lens", "LENS_ADDRESS"),
    oracleAdapter: pick("oracleAdapter", "ORACLE_ADDRESS"),
    usdc: pick("usdc", "USDC_ADDRESS"),
    deployBlock: Number(optEnv("DEPLOY_BLOCK") ?? fromFile.deployBlock ?? 0),
  };
  for (const k of ["markets", "lens", "oracleAdapter", "usdc"] as const) {
    if (!d[k] || !/^0x[0-9a-fA-F]{40}$/.test(d[k])) throw new Error(`Deployment address ${k} missing (set ${k.toUpperCase()} env or ${file})`);
  }
  return d;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function log(service: string, msg: string, extra?: Record<string, unknown>) {
  const line = { t: new Date().toISOString(), service, msg, ...extra };
  console.log(JSON.stringify(line, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** Runs `tick` forever with a fixed interval; errors are logged, never fatal. `--once` runs a single tick. */
export async function loop(service: string, intervalMs: number, tick: () => Promise<void>) {
  const once = process.argv.includes("--once");
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  do {
    const started = Date.now();
    try {
      await tick();
    } catch (e) {
      log(service, "tick failed", { error: (e as Error).message });
      if (once) process.exitCode = 1;
    }
    if (once) break;
    await sleep(Math.max(1_000, intervalMs - (Date.now() - started)));
  } while (!stop);
}
