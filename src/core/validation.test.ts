import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntryData, validateFieldDefs, ValidationError } from "./validation.js";
import type { FieldDef } from "../db/schema.js";

test("applies defaults on create, not on partial update", () => {
  const fields: FieldDef[] = [{ name: "views", type: "number", default: 0 }];
  assert.deepEqual(validateEntryData(fields, {}), { views: 0 });
  assert.deepEqual(validateEntryData(fields, {}, { partial: true }), {});
});

test("required field missing throws on create but not on partial", () => {
  const fields: FieldDef[] = [{ name: "title", type: "text", required: true }];
  assert.throws(() => validateEntryData(fields, {}), ValidationError);
  assert.deepEqual(validateEntryData(fields, {}, { partial: true }), {});
});

test("select must be one of options", () => {
  const fields: FieldDef[] = [{ name: "status", type: "select", options: ["a", "b"] }];
  assert.deepEqual(validateEntryData(fields, { status: "a" }), { status: "a" });
  assert.throws(() => validateEntryData(fields, { status: "c" }), ValidationError);
});

test("number min/max enforced", () => {
  const fields: FieldDef[] = [{ name: "n", type: "number", min: 1, max: 10 }];
  assert.deepEqual(validateEntryData(fields, { n: 5 }), { n: 5 });
  assert.throws(() => validateEntryData(fields, { n: 0 }), ValidationError);
  assert.throws(() => validateEntryData(fields, { n: 11 }), ValidationError);
});

test("text length and pattern enforced", () => {
  const fields: FieldDef[] = [
    { name: "slug", type: "text", min: 2, max: 5, pattern: "^[a-z]+$" },
  ];
  assert.deepEqual(validateEntryData(fields, { slug: "abc" }), { slug: "abc" });
  assert.throws(() => validateEntryData(fields, { slug: "a" }), ValidationError); // too short
  assert.throws(() => validateEntryData(fields, { slug: "abcdef" }), ValidationError); // too long
  assert.throws(() => validateEntryData(fields, { slug: "AB1" }), ValidationError); // pattern
});

test("unknown keys are dropped, not rejected", () => {
  const fields: FieldDef[] = [{ name: "title", type: "text" }];
  assert.deepEqual(validateEntryData(fields, { title: "x", extra: "y" }), { title: "x" });
});

test("validateFieldDefs rejects bad definitions", () => {
  assert.throws(
    () => validateFieldDefs([{ name: "Bad Name", type: "text" }]),
    ValidationError,
  );
  assert.throws(
    () => validateFieldDefs([{ name: "s", type: "select" }]), // missing options
    ValidationError,
  );
  assert.throws(
    () => validateFieldDefs([{ name: "n", type: "number", min: 5, max: 1 }]),
    ValidationError,
  );
  assert.throws(
    () => validateFieldDefs([{ name: "t", type: "text", pattern: "([" }]), // bad regex
    ValidationError,
  );
  assert.throws(
    () => validateFieldDefs([{ name: "n", type: "number", default: "nope" }]),
    ValidationError,
  );
});

test("validateFieldDefs accepts a rich valid definition", () => {
  assert.doesNotThrow(() =>
    validateFieldDefs([
      { name: "title", type: "text", required: true, min: 1, max: 200 },
      { name: "status", type: "select", options: ["draft", "live"], default: "draft" },
      { name: "score", type: "number", min: 0, max: 100, default: 0 },
    ]),
  );
});
