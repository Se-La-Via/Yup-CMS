/**
 * End-to-end smoke test for localized fields (needs a live DATABASE_URL).
 *
 *   npm run smoke:i18n
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createContentType, createEntry, setEntryStatus } from "../core/content.js";
import { list } from "../core/read.js";

async function main() {
  try {
    await createContentType({
      name: "i18n_post",
      displayName: "Localized Post",
      fields: [{ name: "title", type: "text", required: true, localized: true }],
    });
  } catch {
    /* may exist on a reused DB */
  }

  const slug = `i18n-${Date.now()}`;
  const entry = await createEntry({
    type: "i18n_post",
    slug,
    data: { title: { en: "Hello", ru: "Привет" } },
    author: { type: "human", id: "smoke" },
  });
  await setEntryStatus({ id: entry.id, status: "published", author: { type: "human", id: "smoke" } });

  const ru = await list({ type: "i18n_post", slug, locale: "ru" });
  assert.equal((ru[0]!.data as { title: string }).title, "Привет", "ru locale resolves");

  // Missing locale falls back to the default (en).
  const fr = await list({ type: "i18n_post", slug, locale: "fr" });
  assert.equal((fr[0]!.data as { title: string }).title, "Hello", "fallback to default locale");

  // Without a locale, the raw map is returned (for editors).
  const raw = await list({ type: "i18n_post", slug });
  assert.equal(typeof (raw[0]!.data as { title: unknown }).title, "object", "raw map preserved");

  console.log("✓ i18n verified: locale resolution + fallback + raw map");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
