/**
 * In-memory token-bucket rate limiter. Pure logic (the clock is passed in), so
 * it is deterministic and unit-testable.
 *
 * Per-key buckets refill continuously at `capacity / windowMs` tokens per ms, so
 * a client may burst up to `capacity` requests, then is paced to roughly
 * `capacity` requests per window thereafter.
 *
 * This is per-process. A single instance behind one proxy is fine; for a
 * horizontally-scaled fleet you'd back this with a shared store (e.g. Redis).
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {
    this.refillPerMs = capacity / windowMs;
  }

  check(key: string, now: number): RateLimitResult {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };

    // Refill for elapsed time, capped at capacity.
    const elapsed = Math.max(0, now - b.updatedAt);
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
    b.updatedAt = now;

    let result: RateLimitResult;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      result = { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
    } else {
      const needed = 1 - b.tokens;
      result = {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.ceil(needed / this.refillPerMs),
      };
    }

    this.buckets.set(key, b);
    if (this.buckets.size > this.maxKeys) this.prune(now);
    return result;
  }

  /** Drop fully-refilled (idle) buckets to bound memory. */
  private prune(now: number): void {
    for (const [key, b] of this.buckets) {
      const refilled = Math.min(
        this.capacity,
        b.tokens + (now - b.updatedAt) * this.refillPerMs,
      );
      if (refilled >= this.capacity) this.buckets.delete(key);
    }
  }

  get limit(): number {
    return this.capacity;
  }
}

/**
 * Build a limiter from env, or null if disabled. `CMS_RATE_LIMIT<=0` disables it.
 * Defaults: 120 requests per 60s window.
 */
export function createLimiterFromEnv(): RateLimiter | null {
  const limit = Number(process.env.CMS_RATE_LIMIT ?? 120);
  const windowMs = Number(process.env.CMS_RATE_WINDOW_MS ?? 60_000);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return new RateLimiter(limit, windowMs);
}
