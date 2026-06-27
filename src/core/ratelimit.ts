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
 * A limiter usable by the server. `check` is async so it can be backed by Redis
 * (shared across instances) as well as in-memory.
 */
export interface Limiter {
  readonly limit: number;
  check(key: string, now: number): Promise<RateLimitResult>;
}

/**
 * Redis-backed token bucket — a single shared limit across a horizontally-scaled
 * fleet. The refill+consume is done atomically in a Lua script. ioredis is
 * imported lazily so memory-only deployments never load it.
 */
const LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = now end
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + elapsed * refillPerMs)
local allowed = 0
local retry = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry = math.ceil((1 - tokens) / refillPerMs)
end
redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttl)
return {allowed, math.floor(tokens), retry}
`;

class RedisRateLimiter implements Limiter {
  readonly limit: number;
  private readonly windowMs: number;
  private readonly url: string;
  private client?: Promise<import("ioredis").Redis>;

  constructor(limit: number, windowMs: number, url: string) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.url = url;
  }

  private conn() {
    if (!this.client) {
      this.client = import("ioredis").then((m) => new m.default(this.url));
    }
    return this.client;
  }

  async check(key: string, now: number): Promise<RateLimitResult> {
    const client = await this.conn();
    const refillPerMs = this.limit / this.windowMs;
    const ttl = Math.ceil(this.windowMs * 2);
    const [allowed, remaining, retry] = (await client.eval(
      LUA,
      1,
      "rl:" + key,
      String(this.limit),
      String(refillPerMs),
      String(now),
      String(ttl),
    )) as [number, number, number];
    return { allowed: allowed === 1, remaining, retryAfterMs: retry };
  }
}

/**
 * Build a limiter from env, or null if disabled. `CMS_RATE_LIMIT<=0` disables it.
 * Defaults: 120 requests per 60s window, in-memory. Set `CMS_RATE_BACKEND=redis`
 * (with `CMS_REDIS_URL`) for a shared limit across instances.
 */
export function createLimiterFromEnv(): Limiter | null {
  const limit = Number(process.env.CMS_RATE_LIMIT ?? 120);
  const windowMs = Number(process.env.CMS_RATE_WINDOW_MS ?? 60_000);
  if (!Number.isFinite(limit) || limit <= 0) return null;

  if ((process.env.CMS_RATE_BACKEND ?? "memory") === "redis") {
    return new RedisRateLimiter(
      limit,
      windowMs,
      process.env.CMS_REDIS_URL ?? "redis://localhost:6379",
    );
  }

  const rl = new RateLimiter(limit, windowMs);
  return { limit, check: async (key, now) => rl.check(key, now) };
}
