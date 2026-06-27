/**
 * Smoke test for the Redis-backed rate limiter (needs CMS_RATE_BACKEND=redis
 * and a reachable CMS_REDIS_URL). No database required.
 *
 *   CMS_RATE_BACKEND=redis CMS_RATE_LIMIT=3 npm run smoke:ratelimit-redis
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createLimiterFromEnv } from "../core/ratelimit.js";

async function main() {
  const limiter = createLimiterFromEnv();
  assert.ok(limiter, "limiter should be configured (CMS_RATE_LIMIT > 0)");

  const key = "smoke-" + Date.now();
  const now = Date.now();
  const r1 = await limiter!.check(key, now);
  const r2 = await limiter!.check(key, now);
  const r3 = await limiter!.check(key, now);
  const r4 = await limiter!.check(key, now);

  assert.ok(r1.allowed && r2.allowed && r3.allowed, "first 3 should be allowed");
  assert.equal(r4.allowed, false, "4th should be throttled");
  assert.ok(r4.retryAfterMs > 0, "throttled response carries a retry delay");

  // A different key has its own bucket.
  assert.equal((await limiter!.check(key + "-other", now)).allowed, true);

  console.log("✓ redis rate limiter verified: burst of 3 allowed, 4th throttled");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
