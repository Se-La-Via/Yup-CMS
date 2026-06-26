import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldHoldForReview, mayDecideReview } from "./policy.js";

test("agent publish of an approval-gated type is held for review", () => {
  assert.equal(shouldHoldForReview("published", "agent", true), true);
});

test("human/system publish bypasses the gate (they are the approval)", () => {
  assert.equal(shouldHoldForReview("published", "human", true), false);
  assert.equal(shouldHoldForReview("published", "system", true), false);
});

test("agent publish of a non-gated type publishes directly", () => {
  assert.equal(shouldHoldForReview("published", "agent", false), false);
});

test("non-publish transitions are never held", () => {
  assert.equal(shouldHoldForReview("draft", "agent", true), false);
  assert.equal(shouldHoldForReview("archived", "agent", true), false);
});

test("agents may not decide reviews — gate is unbypassable", () => {
  assert.equal(mayDecideReview("agent"), false);
});

test("humans and system principals may decide reviews", () => {
  assert.equal(mayDecideReview("human"), true);
  assert.equal(mayDecideReview("system"), true);
});
