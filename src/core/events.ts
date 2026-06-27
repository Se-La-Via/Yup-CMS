import { createHmac } from "node:crypto";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { webhooks, webhookDeliveries, eventOutbox } from "../db/schema.js";
import { nextBackoffMs, isExhausted } from "./backoff.js";

/**
 * The set of events Yup CMS emits. Subscribers (n8n, custom services) pick the
 * ones they care about. Keep these stable — they are a public contract.
 */
export const EVENT_TYPES = [
  "entry.created",
  "entry.updated",
  "entry.published",
  "entry.unpublished",
  "entry.archived",
  "entry.deleted",
  "entry.scheduled",
  "entry.reverted",
  "entry.review_requested",
  "review.approved",
  "review.rejected",
  "type.created",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface EventPayload {
  event: EventType;
  timestamp: string;
  data: Record<string, unknown>;
}

const DELIVERY_TIMEOUT_MS = 5000;

// The transaction handle passed to recordEvent — derived from db.transaction so
// callers can enlist the outbox write in their existing mutation transaction.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

export async function registerWebhook(input: {
  name: string;
  url: string;
  events?: string[];
  secret?: string;
}) {
  if (!/^https?:\/\//.test(input.url)) {
    throw new Error("webhook url must start with http:// or https://");
  }
  const invalid = (input.events ?? []).filter(
    (e) => !EVENT_TYPES.includes(e as EventType),
  );
  if (invalid.length > 0) {
    throw new Error(
      `unknown event types: ${invalid.join(", ")}. Valid: ${EVENT_TYPES.join(", ")}`,
    );
  }

  const [hook] = await db
    .insert(webhooks)
    .values({
      name: input.name,
      url: input.url,
      events: input.events ?? [],
      secret: input.secret,
    })
    .returning();
  return hook;
}

export async function listWebhooks() {
  return db.select().from(webhooks).orderBy(webhooks.createdAt);
}

export async function deleteWebhook(id: string) {
  const [deleted] = await db
    .delete(webhooks)
    .where(eq(webhooks.id, id))
    .returning();
  if (!deleted) throw new Error(`webhook "${id}" not found`);
  return { deleted: true, id };
}

export async function getDeliveries(input: { webhookId?: string; limit?: number }) {
  const q = db.select().from(webhookDeliveries);
  const rows = input.webhookId
    ? await q
        .where(eq(webhookDeliveries.webhookId, input.webhookId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(input.limit ?? 50)
    : await q.orderBy(desc(webhookDeliveries.createdAt)).limit(input.limit ?? 50);
  return rows;
}

// ---------------------------------------------------------------------------
// Emission (transactional outbox)
// ---------------------------------------------------------------------------

/**
 * Record that an event happened, in the caller's mutation transaction. Because
 * it shares the transaction, the event is persisted atomically with the change
 * — never lost on a crash, never emitted for a rolled-back change. The worker
 * (dispatch + delivery, below) does the actual fan-out and HTTP delivery later.
 */
export async function recordEvent(
  tx: Tx,
  event: EventType,
  data: Record<string, unknown>,
) {
  await tx.insert(eventOutbox).values({ event, data });
}

// ---------------------------------------------------------------------------
// Worker: fan-out + delivery with retries
// ---------------------------------------------------------------------------

/** Fan out undispatched outbox events into per-webhook delivery rows. */
export async function dispatchOutbox(limit = 100): Promise<number> {
  const rows = await db
    .select()
    .from(eventOutbox)
    .where(isNull(eventOutbox.dispatchedAt))
    .orderBy(eventOutbox.createdAt)
    .limit(limit);
  if (rows.length === 0) return 0;

  const hooks = await listWebhooks();

  for (const row of rows) {
    const matches = hooks.filter(
      (w) => w.active && (w.events.length === 0 || w.events.includes(row.event)),
    );
    const payload: EventPayload = {
      event: row.event as EventType,
      timestamp: row.createdAt.toISOString(),
      data: row.data,
    };

    await db.transaction(async (tx) => {
      for (const w of matches) {
        await tx.insert(webhookDeliveries).values({
          webhookId: w.id,
          event: row.event,
          payload: payload as unknown as Record<string, unknown>,
          status: "pending",
          attempts: 0,
          nextAttemptAt: sql`now()`,
        });
      }
      await tx
        .update(eventOutbox)
        .set({ dispatchedAt: sql`now()` })
        .where(eq(eventOutbox.id, row.id));
    });
  }
  return rows.length;
}

/** Attempt all due pending deliveries once; reschedule failures with backoff. */
export async function processDeliveries(
  limit = 50,
): Promise<{ delivered: number; failed: number; retried: number }> {
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        or(
          isNull(webhookDeliveries.nextAttemptAt),
          lte(webhookDeliveries.nextAttemptAt, sql`now()`),
        ),
      ),
    )
    .orderBy(webhookDeliveries.nextAttemptAt)
    .limit(limit);

  let delivered = 0;
  let failed = 0;
  let retried = 0;

  for (const d of due) {
    const [hook] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, d.webhookId));

    // Subscriber removed since enqueue — drop the delivery.
    if (!hook || !hook.active) {
      await db
        .update(webhookDeliveries)
        .set({ status: "failed", error: "webhook removed or inactive", nextAttemptAt: null })
        .where(eq(webhookDeliveries.id, d.id));
      failed++;
      continue;
    }

    const result = await attemptDelivery(hook, d.payload as unknown as EventPayload);
    const attempts = d.attempts + 1;

    if (result.ok) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "success",
          statusCode: result.statusCode,
          error: null,
          attempts,
          durationMs: result.durationMs,
          nextAttemptAt: null,
        })
        .where(eq(webhookDeliveries.id, d.id));
      delivered++;
    } else if (isExhausted(attempts)) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "failed",
          statusCode: result.statusCode,
          error: result.error,
          attempts,
          durationMs: result.durationMs,
          nextAttemptAt: null,
        })
        .where(eq(webhookDeliveries.id, d.id));
      failed++;
    } else {
      const delaySecs = Math.ceil(nextBackoffMs(attempts) / 1000);
      await db
        .update(webhookDeliveries)
        .set({
          status: "pending",
          statusCode: result.statusCode,
          error: result.error,
          attempts,
          durationMs: result.durationMs,
          nextAttemptAt: sql`now() + make_interval(secs => ${delaySecs})`,
        })
        .where(eq(webhookDeliveries.id, d.id));
      retried++;
    }
  }

  return { delivered, failed, retried };
}

/** One worker tick: fan out new events, then attempt due deliveries. */
export async function tick() {
  const dispatched = await dispatchOutbox();
  const result = await processDeliveries();
  return { dispatched, ...result };
}

async function attemptDelivery(
  hook: typeof webhooks.$inferSelect,
  payload: EventPayload,
): Promise<{ ok: boolean; statusCode: number | null; error: string | null; durationMs: number }> {
  const body = JSON.stringify(payload);
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "yup-cms/0.1",
    "x-yup-event": payload.event,
  };
  if (hook.secret) {
    headers["x-yup-signature"] =
      "sha256=" + createHmac("sha256", hook.secret).update(body).digest("hex");
  }

  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    return {
      ok: res.ok,
      statusCode: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (e) {
    return {
      ok: false,
      statusCode: null,
      error: (e as Error).message,
      durationMs: Date.now() - startedAt,
    };
  }
}
