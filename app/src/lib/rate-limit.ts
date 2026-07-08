/**
 * rate-limit.ts — a minimal in-process token-bucket. INTERIM (see design/DECISIONS.md):
 * per Node instance, not distributed, so it caps a single share-link's burst against
 * one server but not across a horizontally-scaled fleet. Good enough to blunt agent
 * spam from one token; a durable limiter (Redis) is a later hardening item.
 */
interface Bucket { tokens: number; last: number }
const buckets = new Map<string, Bucket>();

/**
 * Consume one token for `key`. Returns false when the bucket is empty. Default: burst
 * of 8, refilling one token every 3s (~20/min sustained).
 */
export function allowRequest(key: string, capacity = 8, refillPerSec = 1 / 3): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, last: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  b.last = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

/** Test-only: reset a key's bucket. */
export function resetRateLimit(key?: string): void {
  if (key) buckets.delete(key); else buckets.clear();
}
