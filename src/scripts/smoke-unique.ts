/**
 * End-to-end smoke test for unique field constraints (needs a live DATABASE_URL).
 *
 *   npm run smoke:unique
 */
import "dotenv/config";
import assert from "node:assert/strict";
import {
  createContentType,
  createEntry,
  updateEntry,
  ValidationError,
} from "../core/content.js";

async function main() {
  try {
    await createContentType({
      name: "unique_user",
      displayName: "Unique User",
      fields: [{ name: "email", type: "text", required: true, unique: true }],
    });
  } catch {
    /* may exist on a reused DB */
  }

  const email = `a${Date.now()}@example.com`;
  const first = await createEntry({
    type: "unique_user",
    data: { email },
    author: { type: "human", id: "smoke" },
  });

  // A second entry with the same value must be rejected.
  await assert.rejects(
    () =>
      createEntry({
        type: "unique_user",
        data: { email },
        author: { type: "human", id: "smoke" },
      }),
    (e) => e instanceof ValidationError,
    "duplicate create should be rejected",
  );

  // A different value is fine.
  const second = await createEntry({
    type: "unique_user",
    data: { email: `b${Date.now()}@example.com` },
    author: { type: "human", id: "smoke" },
  });

  // Updating the second onto the first's value must be rejected...
  await assert.rejects(
    () => updateEntry({ id: second.id, data: { email }, author: { type: "human", id: "smoke" } }),
    (e) => e instanceof ValidationError,
    "duplicate update should be rejected",
  );

  // ...but updating an entry to its own value is fine (excludes self).
  await updateEntry({ id: first.id, data: { email }, author: { type: "human", id: "smoke" } });

  console.log("✓ unique constraint verified: duplicate create + update rejected");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
