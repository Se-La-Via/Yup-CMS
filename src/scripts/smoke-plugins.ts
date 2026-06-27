/**
 * End-to-end smoke test for the plugin system (needs a live DATABASE_URL).
 * Registers the example plugins, then verifies a custom field type and a
 * lifecycle hook affect real writes.
 *
 *   npm run smoke:plugins
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { registerPlugin } from "../core/plugins.js";
import emailField from "../plugins/examples/email-field.js";
import readingTime from "../plugins/examples/reading-time.js";
import { createContentType, createEntry, getEntry, ValidationError } from "../core/content.js";

async function main() {
  registerPlugin(emailField);
  registerPlugin(readingTime);

  try {
    await createContentType({
      name: "plug_post",
      displayName: "Plugin Post",
      fields: [
        { name: "contact", type: "email" as never, required: true },
        { name: "body", type: "richtext" },
        { name: "reading_time", type: "number" },
      ],
    });
  } catch {
    /* may exist on a reused DB */
  }

  // Custom field type rejects a bad value...
  await assert.rejects(
    () =>
      createEntry({
        type: "plug_post",
        data: { contact: "not-an-email" },
        author: { type: "human", id: "smoke" },
      }),
    (e) => e instanceof ValidationError,
    "invalid email is rejected by the plugin field type",
  );

  // ...and accepts a good one; the hook computes reading_time.
  const entry = await createEntry({
    type: "plug_post",
    data: { contact: "a@b.com", body: "one two three four five six seven eight" },
    author: { type: "human", id: "smoke" },
  });
  const fresh = await getEntry(entry.id);
  assert.equal((fresh.data as { contact: string }).contact, "a@b.com");
  assert.equal((fresh.data as { reading_time: number }).reading_time, 1, "hook set reading_time");

  console.log("✓ plugins verified: custom field type validates + lifecycle hook runs");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
