import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSchema } from "graphql";
import { schema } from "./graphql-schema.js";

test("schema is valid", () => {
  assert.equal(validateSchema(schema).length, 0);
});

test("schema exposes the expected query fields", () => {
  const query = schema.getQueryType();
  assert.ok(query, "Query type exists");
  const fields = query!.getFields();
  for (const f of [
    "contentTypes",
    "contentType",
    "entries",
    "entry",
    "entryBySlug",
    "assets",
  ]) {
    assert.ok(fields[f], `query has ${f}`);
  }
});
