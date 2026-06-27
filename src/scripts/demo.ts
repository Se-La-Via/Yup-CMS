/**
 * Populate a realistic demo dataset (needs a live DATABASE_URL). Safe to re-run.
 *
 *   npm run demo
 *
 * Creates an "author" and a localized "post" type, a few published posts that
 * reference authors, an asset, and a webhook — so a fresh install looks alive.
 */
import "dotenv/config";
import { createContentType, createEntry, setEntryStatus, listEntries } from "../core/content.js";
import { createAsset } from "../core/assets.js";
import { registerWebhook, listWebhooks } from "../core/events.js";

const human = { type: "human" as const, id: "demo" };

async function ensureType(input: Parameters<typeof createContentType>[0]) {
  try {
    return await createContentType(input);
  } catch {
    return null; // already exists on a re-run
  }
}

async function main() {
  console.log("→ Defining content types...");
  await ensureType({
    name: "author",
    displayName: "Author",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "bio", type: "richtext" },
    ],
  });
  await ensureType({
    name: "post",
    displayName: "Post",
    fields: [
      { name: "title", type: "text", required: true, localized: true },
      { name: "body", type: "richtext", localized: true },
      { name: "author", type: "reference", refType: "author" },
      { name: "status_label", type: "select", options: ["news", "guide", "release"], default: "news" },
    ],
  });

  console.log("→ Creating and publishing authors...");
  const ada = await createEntry({
    type: "author",
    slug: "ada",
    data: { name: "Ada Lovelace", bio: "First programmer." },
    author: human,
  });
  const alan = await createEntry({
    type: "author",
    slug: "alan",
    data: { name: "Alan Turing", bio: "Father of computer science." },
    author: human,
  });
  for (const a of [ada, alan]) {
    await setEntryStatus({ id: a.id, status: "published", author: human });
  }

  console.log("→ Creating and publishing posts...");
  const posts = [
    {
      slug: "hello-world",
      title: { en: "Hello, World", ru: "Привет, мир" },
      body: { en: "Welcome to Yup CMS.", ru: "Добро пожаловать в Yup CMS." },
      author: ada.id,
      status_label: "news",
    },
    {
      slug: "agent-native",
      title: { en: "Why agent-native", ru: "Почему agent-native" },
      body: { en: "Agents write, humans oversee.", ru: "Агенты пишут, люди надзирают." },
      author: alan.id,
      status_label: "guide",
    },
  ];
  for (const p of posts) {
    const entry = await createEntry({ type: "post", slug: p.slug, data: p, author: human });
    await setEntryStatus({ id: entry.id, status: "published", author: human });
  }

  console.log("→ Uploading a demo asset...");
  await createAsset({
    filename: "welcome.txt",
    contentType: "text/plain",
    dataBase64: Buffer.from("Welcome to Yup CMS!").toString("base64"),
  });

  console.log("→ Registering a demo webhook...");
  if ((await listWebhooks()).length === 0) {
    await registerWebhook({
      name: "demo",
      url: "https://example.com/yup-webhook",
      events: ["entry.published"],
    });
  }

  const published = await listEntries({ type: "post", status: "published" });
  console.log(`\n✓ Demo ready: ${published.length} published posts, 2 authors, 1 asset, 1 webhook.`);
  console.log("  Try the read API:");
  console.log("    GET /content/post?resolve=true&locale=ru");
  console.log("    GET /search?q=agent");
  console.log('    POST /graphql  { entries(type:"post"){ slug data } }');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
