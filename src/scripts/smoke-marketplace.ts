/**
 * End-to-end smoke test for the marketplace (needs a live DATABASE_URL).
 * publish → list/search → get → install, plus signing + remote sync.
 *
 *   npm run smoke:marketplace
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

async function main() {
  // Configure signing keys BEFORE importing the marketplace (env read at call time).
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env.CMS_REGISTRY_PRIVATE_KEY = Buffer.from(privateKey).toString("base64");
  process.env.CMS_REGISTRY_PUBLIC_KEY = Buffer.from(publicKey).toString("base64");

  const { publishItem, listItems, getItem, removeItem, syncFromRegistry, assertInstallable } =
    await import("../core/marketplace.js");
  const { enablePlugin } = await import("../core/plugins.js");
  const { verifyItem } = await import("../core/signing.js");

  const spec = "./dist/plugins/examples/email-field.js";
  const published = await publishItem({
    kind: "plugin",
    name: "smoke-plugin",
    specifier: spec,
    description: "smoke test plugin",
  });
  assert.equal(published.name, "smoke-plugin");
  assert.ok(published.signature, "publish signs the item when a key is set");
  assert.equal(published.verified, true, "signed item is marked verified");
  assert.equal(verifyItem(published, published.signature), true, "signature verifies");

  const found = await listItems({ q: "smoke" });
  assert.ok(found.some((i) => i.name === "smoke-plugin"), "search finds the item");

  const got = await getItem("smoke-plugin");
  assertInstallable(got); // verifies signature — must not throw
  const plugins = await enablePlugin(got.specifier);
  assert.ok(plugins.includes(spec), "install enables the plugin specifier");

  // Remote sync: a tiny registry serving /marketplace with one good + one forged item.
  const forged = { kind: "plugin", name: "forged", specifier: "./evil.js", signature: "AAAA" };
  const payload = JSON.stringify([got, forged]);
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(payload);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const sync = await syncFromRegistry(`http://127.0.0.1:${port}`);
  server.close();
  assert.equal(sync.imported, 1, "good item imported");
  assert.equal(sync.skipped, 1, "forged item skipped");
  await assert.rejects(() => getItem("forged"), "forged item not stored");

  await removeItem("smoke-plugin");
  await rm("plugins.json", { force: true });

  console.log("✓ marketplace verified: publish+sign → install → sync (forged rejected)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
