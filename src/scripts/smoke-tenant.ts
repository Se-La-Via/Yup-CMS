/**
 * End-to-end isolation test for multi-tenancy (needs a live DATABASE_URL).
 * Proves that one tenant cannot see another tenant's data through any surface.
 *
 *   npm run smoke:tenant
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createTenant, resolveTenantId } from "../core/tenant.js";
import {
  createContentType,
  createEntry,
  listEntries,
  getEntry,
  getContentType,
  NotFoundError,
} from "../core/content.js";
import { registerWebhook, listWebhooks } from "../core/events.js";
import { createAsset, listAssets } from "../core/assets.js";
import { executeGraphQL } from "../core/graphql.js";

async function main() {
  const ts = Date.now();
  await createTenant({ slug: `iso-a-${ts}`, name: "A" });
  await createTenant({ slug: `iso-b-${ts}`, name: "B" });
  const A = await resolveTenantId(`iso-a-${ts}`);
  const B = await resolveTenantId(`iso-b-${ts}`);
  assert.notEqual(A, B);

  // Same type name in both tenants is allowed (unique per tenant).
  await createContentType({ name: "iso_post", displayName: "A", fields: [{ name: "title", type: "text" }], tenantId: A });
  await createContentType({ name: "iso_post", displayName: "B", fields: [{ name: "title", type: "text" }], tenantId: B });
  const typeA = await getContentType("iso_post", A);
  const typeB = await getContentType("iso_post", B);
  assert.notEqual(typeA.id, typeB.id, "types are distinct per tenant");

  const aEntry = await createEntry({
    type: "iso_post",
    data: { title: "secret-A" },
    status: "published",
    author: { type: "human", id: "a" },
    tenantId: A,
  });
  await createEntry({
    type: "iso_post",
    data: { title: "secret-B" },
    status: "published",
    author: { type: "human", id: "b" },
    tenantId: B,
  });

  // listEntries is scoped.
  const aList = await listEntries({ type: "iso_post", tenantId: A });
  assert.equal(aList.length, 1, "tenant A sees only its own entry");
  assert.equal((aList[0]!.data as { title: string }).title, "secret-A");

  // by-id across tenants is blocked.
  await assert.rejects(
    () => getEntry(aEntry.id, B),
    (e) => e instanceof NotFoundError,
    "tenant B cannot fetch tenant A's entry by id",
  );

  // GraphQL is scoped by context tenant.
  const gqlA = await executeGraphQL(
    `{ entries(type: "iso_post", status: "published") { data } }`,
    undefined,
    { key: null, tenantId: A },
  );
  const gEntries = (gqlA.data as { entries: Array<{ data: { title: string } }> }).entries;
  assert.equal(gEntries.length, 1, "GraphQL scoped to tenant A");
  assert.equal(gEntries[0]!.data.title, "secret-A");

  // Webhooks and assets are scoped.
  await registerWebhook({ name: "a-hook", url: "https://example.com/a", tenantId: A });
  assert.equal((await listWebhooks(A)).length, 1, "A has its webhook");
  assert.equal((await listWebhooks(B)).length, 0, "B sees no webhooks");

  await createAsset({ filename: "a.txt", contentType: "text/plain", dataBase64: Buffer.from("a").toString("base64"), tenantId: A });
  assert.equal((await listAssets(A)).length, 1, "A has its asset");
  assert.equal((await listAssets(B)).length, 0, "B sees no assets");

  console.log("✓ tenant isolation verified: content, by-id, GraphQL, webhooks, assets");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
