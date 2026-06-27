/**
 * End-to-end smoke test for the GraphQL read layer (needs a live DATABASE_URL).
 *
 *   npm run smoke:graphql
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createContentType, createEntry, setEntryStatus } from "../core/content.js";
import { executeGraphQL } from "../core/graphql.js";
import { DEFAULT_TENANT_ID } from "../db/schema.js";

async function main() {
  try {
    await createContentType({
      name: "gql_post",
      displayName: "GraphQL Post",
      fields: [{ name: "title", type: "text", required: true }],
    });
  } catch {
    /* may exist on a reused DB */
  }

  const entry = await createEntry({
    type: "gql_post",
    data: { title: "hello graphql" },
    slug: `g-${Date.now()}`,
    author: { type: "human", id: "smoke" },
  });
  await setEntryStatus({ id: entry.id, status: "published", author: { type: "human", id: "smoke" } });

  // Public query for published content works without a key.
  const ok = await executeGraphQL(
    `{ entries(type: "gql_post", status: "published", limit: 100) { id status data } }`,
    undefined,
    { key: null, tenantId: DEFAULT_TENANT_ID },
  );
  assert.ok(!ok.errors, `unexpected errors: ${JSON.stringify(ok.errors)}`);
  const rows = (ok.data as { entries: Array<{ id: string }> }).entries;
  assert.ok(rows.some((r) => r.id === entry.id), "published entry should be returned");

  // Requesting non-published content without a read:all key is denied.
  const denied = await executeGraphQL(
    `{ entries(type: "gql_post", status: "draft") { id } }`,
    undefined,
    { key: null, tenantId: DEFAULT_TENANT_ID },
  );
  assert.ok(denied.errors && denied.errors.length > 0, "draft query without key should error");

  console.log("✓ GraphQL verified: public read works, non-published is gated");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
