/**
 * Sync the local marketplace from a remote registry (another Yup CMS).
 *
 *   npm run marketplace:sync <url>     (or set CMS_REGISTRY_URL)
 *
 * Signatures are verified when CMS_REGISTRY_PUBLIC_KEY is set; unverifiable
 * items are skipped.
 */
import "dotenv/config";
import { syncFromRegistry } from "../core/marketplace.js";

async function main() {
  const url = process.argv[2] ?? process.env.CMS_REGISTRY_URL;
  if (!url) {
    console.error("usage: npm run marketplace:sync <url>   (or set CMS_REGISTRY_URL)");
    process.exit(1);
  }
  const { imported, skipped } = await syncFromRegistry(url);
  console.log(`✓ Synced from ${url}: imported ${imported}, skipped ${skipped}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
