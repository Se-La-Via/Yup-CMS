/**
 * Seed the marketplace with the bundled plugins and theme (needs DATABASE_URL).
 *
 *   npm run marketplace:seed
 */
import "dotenv/config";
import { publishItem, type PublishInput } from "../core/marketplace.js";

const ITEMS: PublishInput[] = [
  {
    kind: "plugin",
    name: "email-field",
    specifier: "./dist/plugins/examples/email-field.js",
    description: "Adds an 'email' field type with format validation.",
    author: "Yup CMS",
    tags: ["field-type"],
    verified: true,
  },
  {
    kind: "plugin",
    name: "reading-time",
    specifier: "./dist/plugins/examples/reading-time.js",
    description: "Computes a reading_time field from a body field on save.",
    author: "Yup CMS",
    tags: ["hook"],
    verified: true,
  },
  {
    kind: "theme",
    name: "rich",
    specifier: "./dist/render/theme.js",
    description: "Field-aware theme: renders richtext as HTML (also built in via CMS_THEME=rich).",
    author: "Yup CMS",
    tags: ["theme"],
    verified: true,
  },
];

async function main() {
  for (const item of ITEMS) await publishItem(item);
  console.log(`✓ Seeded ${ITEMS.length} marketplace items.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
