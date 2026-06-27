import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contentEntries,
  reviewRequests,
  webhookDeliveries,
  DEFAULT_TENANT_ID,
} from "../db/schema.js";

/**
 * Rules-based "insights" — cheap signals that help the admin without an LLM:
 * what needs attention right now. Tenant-scoped.
 */
export async function getInsights(tenantId: string = DEFAULT_TENANT_ID) {
  const pending = await db
    .select({ id: reviewRequests.id })
    .from(reviewRequests)
    .where(and(eq(reviewRequests.tenantId, tenantId), eq(reviewRequests.status, "pending")));

  const drafts = await db
    .select({ id: contentEntries.id })
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.tenantId, tenantId),
        eq(contentEntries.status, "draft"),
        lt(contentEntries.updatedAt, sql`now() - interval '30 days'`),
      ),
    );

  const sched = await db
    .select({ id: contentEntries.id })
    .from(contentEntries)
    .where(and(eq(contentEntries.tenantId, tenantId), eq(contentEntries.status, "scheduled")));

  const failed = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.status, "failed")));

  const pendingReviews = pending.length;
  const staleDrafts = drafts.length;
  const scheduled = sched.length;
  const failedDeliveries = failed.length;

  const items: Array<{ level: "info" | "warn"; message: string }> = [];
  if (pendingReviews > 0)
    items.push({ level: "warn", message: `${pendingReviews} review(s) awaiting approval` });
  if (staleDrafts > 0)
    items.push({ level: "info", message: `${staleDrafts} draft(s) untouched for 30+ days` });
  if (scheduled > 0)
    items.push({ level: "info", message: `${scheduled} entry(ies) scheduled to publish` });
  if (failedDeliveries > 0)
    items.push({ level: "warn", message: `${failedDeliveries} failed webhook delivery(ies)` });
  if (items.length === 0) items.push({ level: "info", message: "All clear — nothing needs attention." });

  return { pendingReviews, staleDrafts, scheduled, failedDeliveries, items };
}
