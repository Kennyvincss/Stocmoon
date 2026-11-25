import postgres from "postgres";
import { optEnv } from "./env";

export type Sql = ReturnType<typeof postgres>;
let sql: Sql | null | undefined;

export function db(required = false): Sql | null {
  if (sql === undefined) {
    const url = optEnv("DATABASE_URL");
    sql = url ? postgres(url, { max: 5, prepare: false, onnotice: () => {} }) : null;
  }
  if (required && !sql) throw new Error("DATABASE_URL is required for this service");
  return sql;
}

export async function closeDb() {
  if (sql) await sql.end({ timeout: 5 });
  sql = undefined;
}
