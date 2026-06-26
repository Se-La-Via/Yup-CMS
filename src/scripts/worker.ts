/**
 * Webhook delivery worker. Polls the outbox, fans events out to subscribers,
 * and delivers them with retries + backoff. Run it as a long-lived process
 * alongside the API (see docker-compose.yml).
 *
 *   npm run worker
 */
import "dotenv/config";
import { tick } from "../core/events.js";

const INTERVAL_MS = Number(process.env.CMS_WORKER_INTERVAL_MS ?? 2000);
let running = true;

process.on("SIGTERM", () => (running = false));
process.on("SIGINT", () => (running = false));

async function main() {
  console.error(`Yup CMS webhook worker started (interval ${INTERVAL_MS}ms)`);
  while (running) {
    try {
      const r = await tick();
      if (r.dispatched || r.delivered || r.retried || r.failed) {
        console.error(
          `[worker] dispatched=${r.dispatched} delivered=${r.delivered} retried=${r.retried} failed=${r.failed}`,
        );
      }
    } catch (e) {
      console.error("[worker] tick error:", (e as Error).message);
    }
    await new Promise((res) => setTimeout(res, INTERVAL_MS));
  }
  console.error("Yup CMS webhook worker stopped");
  process.exit(0);
}

main();
