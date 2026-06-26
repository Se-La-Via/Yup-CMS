import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./ratelimit.js";

test("allows up to capacity, then blocks", () => {
  const rl = new RateLimiter(3, 1000);
  assert.equal(rl.check("a", 0).allowed, true);
  assert.equal(rl.check("a", 0).allowed, true);
  assert.equal(rl.check("a", 0).allowed, true);
  const blocked = rl.check("a", 0);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test("keys are independent", () => {
  const rl = new RateLimiter(1, 1000);
  assert.equal(rl.check("a", 0).allowed, true);
  assert.equal(rl.check("b", 0).allowed, true);
  assert.equal(rl.check("a", 0).allowed, false);
});

test("refills over time", () => {
  const rl = new RateLimiter(2, 1000); // refills 2 tokens per 1000ms
  rl.check("a", 0);
  rl.check("a", 0);
  assert.equal(rl.check("a", 0).allowed, false);
  // after 500ms, one token has refilled
  assert.equal(rl.check("a", 500).allowed, true);
  assert.equal(rl.check("a", 500).allowed, false);
});

test("remaining reflects consumed tokens", () => {
  const rl = new RateLimiter(5, 1000);
  assert.equal(rl.check("a", 0).remaining, 4);
  assert.equal(rl.check("a", 0).remaining, 3);
});
