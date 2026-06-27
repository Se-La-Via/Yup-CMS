/**
 * End-to-end smoke test for the rendering layer (needs a live DATABASE_URL).
 *
 *   npm run smoke:render
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createContentType, createEntry, setEntryStatus } from "../core/content.js";
import { createRenderServer } from "../render/server.js";

async function main() {
  try {
    await createContentType({
      name: "render_post",
      displayName: "Render Post",
      fields: [{ name: "title", type: "text", required: true }],
    });
  } catch {
    /* may exist on a reused DB */
  }
  const slug = `render-${Date.now()}`;
  const entry = await createEntry({
    type: "render_post",
    slug,
    data: { title: "Render Me Please" },
    author: { type: "human", id: "smoke" },
  });
  await setEntryStatus({ id: entry.id, status: "published", author: { type: "human", id: "smoke" } });

  const server = createRenderServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const list = await (await fetch(`${base}/render_post`)).text();
  assert.ok(list.includes("Render Me Please"), "list page shows the entry");
  assert.ok(list.includes(`/render_post/${slug}`), "list links to the entry");

  const page = await (await fetch(`${base}/render_post/${slug}`)).text();
  assert.ok(page.includes("Render Me Please"), "entry page renders the title");

  const missing = await fetch(`${base}/render_post/does-not-exist`);
  assert.equal(missing.status, 404, "missing entry returns 404");

  server.close();
  console.log("✓ rendering verified: list + entry pages + 404");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
