/**
 * End-to-end smoke test for scheduled publishing (needs a live DATABASE_URL).
 *
 *   npm run smoke:schedule
 */
import "dotenv/config";
import assert from "node:assert/strict";
import {
  createContentType,
  createEntry,
  schedulePublish,
  publishScheduledDue,
  getEntry,
} from "../core/content.js";

async function main() {
  try {
    await createContentType({
      name: "sched_post",
      displayName: "Scheduled Post",
      fields: [{ name: "title", type: "text", required: true }],
    });
  } catch {
    /* may exist on a reused DB */
  }

  const entry = await createEntry({
    type: "sched_post",
    data: { title: "later" },
    author: { type: "human", id: "smoke" },
  });

  // Schedule in the past so it is immediately due.
  const past = new Date(Date.now() - 1000).toISOString();
  const scheduled = await schedulePublish({
    id: entry.id,
    publishAt: past,
    author: { type: "human", id: "smoke" },
  });
  assert.equal(scheduled.status, "scheduled", "entry should be scheduled");

  const count = await publishScheduledDue();
  assert.ok(count >= 1, "at least one due entry should publish");

  const after = await getEntry(entry.id);
  assert.equal(after.status, "published", "due entry should be published");
  assert.equal(after.publishAt, null, "publishAt should be cleared after publishing");

  console.log("✓ scheduled publishing verified: schedule → due → published");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
