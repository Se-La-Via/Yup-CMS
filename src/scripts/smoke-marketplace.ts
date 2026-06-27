/**
 * End-to-end smoke test for the marketplace (needs a live DATABASE_URL).
 * publish → list/search → get → install (writes plugins.json) → cleanup.
 *
 *   npm run smoke:marketplace
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { publishItem, listItems, getItem, removeItem } from "../core/marketplace.js";
import { enablePlugin } from "../core/plugins.js";

async function main() {
  const spec = "./dist/plugins/examples/email-field.js";
  const published = await publishItem({
    kind: "plugin",
    name: "smoke-plugin",
    specifier: spec,
    description: "smoke test plugin",
    verified: true,
  });
  assert.equal(published.name, "smoke-plugin");

  // Re-publish is idempotent (upsert by name).
  await publishItem({ kind: "plugin", name: "smoke-plugin", specifier: spec, description: "updated" });

  const found = await listItems({ q: "smoke" });
  assert.ok(found.some((i) => i.name === "smoke-plugin"), "search finds the item");

  const got = await getItem("smoke-plugin");
  assert.equal(got.specifier, spec);

  // Install appends the specifier to plugins.json.
  const plugins = await enablePlugin(got.specifier);
  assert.ok(plugins.includes(spec), "install enables the plugin specifier");

  // Cleanup.
  await removeItem("smoke-plugin");
  await assert.rejects(() => getItem("smoke-plugin"));
  await rm("plugins.json", { force: true });

  console.log("✓ marketplace verified: publish → search → get → install");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
