/**
 * End-to-end smoke test for full-text search (needs a live DATABASE_URL).
 *
 *   npm run smoke:search
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createContentType, createEntry, setEntryStatus } from "../core/content.js";
import { search } from "../core/read.js";

async function main() {
  try {
    await createContentType({
      name: "search_post",
      displayName: "Search Post",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "body", type: "richtext" },
      ],
    });
  } catch {
    /* may exist on a reused DB */
  }

  const token = "zephyrquark" + Date.now();
  const hit = await createEntry({
    type: "search_post",
    data: { title: "About " + token, body: "contains the rare word" },
    author: { type: "human", id: "smoke" },
  });
  await setEntryStatus({ id: hit.id, status: "published", author: { type: "human", id: "smoke" } });

  const miss = await createEntry({
    type: "search_post",
    data: { title: "Unrelated", body: "nothing special here" },
    author: { type: "human", id: "smoke" },
  });
  await setEntryStatus({ id: miss.id, status: "published", author: { type: "human", id: "smoke" } });

  const results = await search({ q: token, type: "search_post" });
  assert.ok(results.some((r) => r.id === hit.id), "matching entry is found");
  assert.ok(!results.some((r) => r.id === miss.id), "non-matching entry is excluded");

  console.log("✓ full-text search verified: matches found, non-matches excluded");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
