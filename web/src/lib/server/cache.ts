interface Entry<T> {
  value: T;
  at: number;
}
const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * TTL cache with single-flight. On loader failure the last good value is returned with `stale: true`
 * (never invented data). Throws if there was never a good value.
 */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<{ value: T; at: number; stale: boolean; error?: string }> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return { value: hit.value, at: hit.at, stale: false };
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = loader();
    inflight.set(key, p);
  }
  try {
    const value = await p;
    const entry = { value, at: Date.now() };
    store.set(key, entry);
    return { ...entry, stale: false };
  } catch (e) {
    if (hit) return { value: hit.value, at: hit.at, stale: true, error: (e as Error).message };
    throw e;
  } finally {
    inflight.delete(key);
  }
}

export function invalidate(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
