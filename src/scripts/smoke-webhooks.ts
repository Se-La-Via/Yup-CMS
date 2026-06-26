/**
 * End-to-end smoke test for the webhook pipeline (needs a live DATABASE_URL).
 * Run in CI after migrations: outbox → worker fan-out → signed HTTP delivery.
 *
 *   npm run smoke:webhooks
 */
import "dotenv/config";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { createContentType, createEntry, setEntryStatus } from "../core/content.js";
import { registerWebhook, tick } from "../core/events.js";

const SECRET = "smoke-secret";
const received: Array<{ event: unknown; ok: boolean }> = [];

function verify(sig: string | undefined, body: string): boolean {
  if (!sig) return false;
  const expected = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  return sig === expected;
}

async function main() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({
        event: req.headers["x-yup-event"],
        ok: verify(req.headers["x-yup-signature"] as string | undefined, body),
      });
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;

  try {
    await createContentType({
      name: "smoke_post",
      displayName: "Smoke Post",
      fields: [{ name: "title", type: "text", required: true }],
    });
  } catch {
    // type may already exist on a reused DB — fine
  }
  await registerWebhook({
    name: "smoke",
    url,
    events: ["entry.published"],
    secret: SECRET,
  });

  const entry = await createEntry({
    type: "smoke_post",
    data: { title: "hi" },
    author: { type: "human", id: "smoke" },
  });
  await setEntryStatus({
    id: entry.id,
    status: "published",
    author: { type: "human", id: "smoke" },
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await tick();
    if (received.some((r) => r.event === "entry.published" && r.ok)) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  server.close();

  const hit = received.find((r) => r.event === "entry.published");
  if (!hit) {
    console.error("FAIL: no entry.published delivery was received");
    process.exit(1);
  }
  if (!hit.ok) {
    console.error("FAIL: delivery signature did not verify");
    process.exit(1);
  }
  console.log("✓ webhook pipeline verified: outbox → worker → signed delivery");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
