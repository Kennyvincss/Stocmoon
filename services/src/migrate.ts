import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, log } from "./lib/env";
import { closeDb, db } from "./lib/db";

/** Applies db/migrations/*.sql in lexical order, once each. */
async function main() {
  const sql = db(true)!;
  await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
  const dir = join(ROOT, "db/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await sql<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version));
  for (const f of files) {
    if (applied.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, f), "utf8"));
      await tx`insert into schema_migrations (version) values (${f})`;
    });
    log("migrate", "applied", { file: f });
  }
  log("migrate", "up to date", { count: files.length });
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
