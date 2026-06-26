import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBackoffMs, isExhausted, MAX_ATTEMPTS } from "./backoff.js";

test("backoff increases then clamps to the longest delay", () => {
  assert.equal(nextBackoffMs(1), 10_000);
  assert.equal(nextBackoffMs(2), 30_000);
  assert.equal(nextBackoffMs(5), 1_800_000);
  // beyond the schedule, clamp to the last delay
  assert.equal(nextBackoffMs(99), 1_800_000);
});

test("backoff handles out-of-range input defensively", () => {
  assert.equal(nextBackoffMs(0), 10_000);
  assert.equal(nextBackoffMs(-3), 10_000);
});

test("attempt budget is exhausted at MAX_ATTEMPTS", () => {
  assert.equal(isExhausted(MAX_ATTEMPTS - 1), false);
  assert.equal(isExhausted(MAX_ATTEMPTS), true);
  assert.equal(isExhausted(MAX_ATTEMPTS + 1), true);
});
