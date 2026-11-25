import postgres from "postgres";
import { serverEnv } from "./env";

type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __stocmoonSql?: Sql | null };

/** Returns a pooled client, or null when DATABASE_URL is not configured (features degrade with a notice). */
export function db(): Sql | null {
  if (g.__stocmoonSql !== undefined) return g.__stocmoonSql;
  g.__stocmoonSql = serverEnv.databaseUrl
    ? postgres(serverEnv.databaseUrl, { max: 5, idle_timeout: 30, connect_timeout: 5, prepare: false })
    : null;
  return g.__stocmoonSql;
}
