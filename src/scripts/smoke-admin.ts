/**
 * End-to-end smoke test for the admin API (needs a live DATABASE_URL).
 * Verifies auth gating and the human review-approval flow over HTTP.
 *
 *   npm run smoke:admin
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createAdminServer } from "../admin/server.js";
import { createApiKey } from "../core/auth.js";
import { createContentType, createEntry, setEntryStatus, getEntry } from "../core/content.js";

async function main() {
  const server = createAdminServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const admin = (await createApiKey({ name: "ci-admin", scopes: ["admin"] })).key;
  const reader = (await createApiKey({ name: "ci-reader", scopes: ["read:published"] })).key;

  const h = (k: string) => ({ authorization: "Bearer " + k, "content-type": "application/json" });

  // Auth gating
  assert.equal((await fetch(`${base}/api/reviews`)).status, 401, "no key → 401");
  assert.equal(
    (await fetch(`${base}/api/reviews`, { headers: h(reader) })).status,
    403,
    "non-admin key → 403",
  );

  // Set up a gated entry and have an agent request publish (queues a review).
  try {
    await createContentType({
      name: "admin_post",
      displayName: "Admin Post",
      fields: [{ name: "title", type: "text", required: true }],
      requireApproval: true,
    });
  } catch {
    /* may exist on a reused DB */
  }
  const entry = await createEntry({
    type: "admin_post",
    data: { title: "needs review" },
    author: { type: "agent", id: "ci-agent" },
  });
  await setEntryStatus({ id: entry.id, status: "published", author: { type: "agent", id: "ci-agent" } });

  // Admin lists the pending review and approves it over HTTP.
  const reviews = (await (
    await fetch(`${base}/api/reviews?status=pending`, { headers: h(admin) })
  ).json()) as Array<{ id: string; entryId: string }>;
  const review = reviews.find((r) => r.entryId === entry.id);
  assert.ok(review, "pending review should be visible to admin");

  const approveRes = await fetch(`${base}/api/reviews/${review.id}/approve`, {
    method: "POST",
    headers: h(admin),
    body: JSON.stringify({ note: "ok from CI" }),
  });
  assert.equal(approveRes.status, 200, "approve should succeed");

  const after = await getEntry(entry.id);
  assert.equal(after.status, "published", "entry should be published after approval");

  // Content editing through the admin API: create a type, an entry, update it.
  await fetch(`${base}/api/types`, {
    method: "POST",
    headers: h(admin),
    body: JSON.stringify({
      name: "admin_edit",
      displayName: "Admin Edit",
      fields: [{ name: "title", type: "text", required: true }],
    }),
  }); // 200, or 400 if it already exists on a reused DB — either is fine
  const createdRes = await fetch(`${base}/api/entries`, {
    method: "POST",
    headers: h(admin),
    body: JSON.stringify({ type: "admin_edit", data: { title: "v1" } }),
  });
  assert.equal(createdRes.status, 200, "admin create entry succeeds");
  const created = (await createdRes.json()) as { id: string };
  const updRes = await fetch(`${base}/api/entries/${created.id}`, {
    method: "POST",
    headers: h(admin),
    body: JSON.stringify({ data: { title: "v2" } }),
  });
  assert.equal(updRes.status, 200, "admin update entry succeeds");
  const edited = await getEntry(created.id);
  assert.equal((edited.data as { title: string }).title, "v2", "edit persisted");

  server.close();
  console.log("✓ admin API verified: review approval + content create/edit");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
