/**
 * End-to-end smoke test for assets (needs a live DATABASE_URL + storage).
 * Run in CI after migrations: upload → store → fetch bytes → delete.
 *
 *   npm run smoke:assets
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createAsset, getAsset, getAssetBytes, deleteAsset } from "../core/assets.js";

async function main() {
  const content = "hello yup assets";
  const asset = await createAsset({
    filename: "hello.txt",
    contentType: "text/plain",
    dataBase64: Buffer.from(content).toString("base64"),
  });

  const { meta, bytes } = await getAssetBytes(asset.id);
  assert.equal(bytes.toString(), content, "stored bytes should round-trip");
  assert.equal(meta.size, content.length, "size metadata should match");
  assert.equal(meta.contentType, "text/plain");
  assert.ok(meta.checksum.length === 64, "sha-256 checksum recorded");

  await deleteAsset(asset.id);
  await assert.rejects(() => getAsset(asset.id), "asset should be gone after delete");

  console.log("✓ asset pipeline verified: upload → store → fetch → delete");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
