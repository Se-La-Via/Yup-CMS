import { createHmac } from "node:crypto";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { webhooks, webhookDeliveries } from "../db/schema.js";

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
// Emission
// ---------------------------------------------------------------------------

/**
 * Fire an event to every matching active webhook. Deliveries run concurrently
 * and are best-effort: a failing subscriber NEVER affects the content mutation
 * that triggered it. Every attempt is logged for debugging.
 *
 * Call this AFTER the triggering transaction has committed, so subscribers
 * observe committed state.
 */
export async function emit(event: EventType, data: Record<string, unknown>) {
  const subscribers = (await listWebhooks()).filter(
    (w) => w.active && (w.events.length === 0 || w.events.includes(event)),
  );
  if (subscribers.length === 0) return;

  const payload: EventPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);

  await Promise.allSettled(subscribers.map((w) => deliver(w, event, payload, body)));
}

async function deliver(
  hook: typeof webhooks.$inferSelect,
  event: EventType,
  payload: EventPayload,
  body: string,
) {
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "yup-cms/0.1",
    "x-yup-event": event,
  };
  if (hook.secret) {
    headers["x-yup-signature"] =
      "sha256=" + createHmac("sha256", hook.secret).update(body).digest("hex");
  }

  let status = "failed";
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    statusCode = res.status;
    status = res.ok ? "success" : "failed";
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message;
  }

  // Logging must not throw into the emit path.
  try {
    await db.insert(webhookDeliveries).values({
      webhookId: hook.id,
      event,
      payload: payload as unknown as Record<string, unknown>,
      status,
      statusCode,
      error,
      durationMs: Date.now() - startedAt,
    });
  } catch (logErr) {
    console.error("Failed to record webhook delivery:", (logErr as Error).message);
  }
}
