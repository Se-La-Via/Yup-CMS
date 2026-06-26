/**
 * Tiny local webhook receiver for testing Yup CMS event delivery without n8n.
 *
 *   npx tsx src/scripts/webhook-listener.ts [port] [secret]
 *
 * Then register a webhook pointing at http://localhost:<port> with the same
 * secret, and watch events arrive (with signature verification).
 */
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const port = Number(process.argv[2] ?? 4000);
const secret = process.argv[3] ?? "";

function verify(signature: string | undefined, body: string): boolean {
  if (!secret) return true; // no secret configured — skip verification
  if (!signature) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const event = req.headers["x-yup-event"];
    const sig = req.headers["x-yup-signature"] as string | undefined;
    const ok = verify(sig, body);

    console.log(
      `\n[${new Date().toISOString()}] ${event}  signature:${ok ? "OK" : "INVALID"}`,
    );
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(body);
    }

    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify({ received: ok }));
  });
}).listen(port, () => {
  console.log(`Webhook listener on http://localhost:${port}`);
  console.log(secret ? "Verifying signatures." : "No secret set — not verifying.");
});
