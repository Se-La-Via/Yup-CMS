import { and, desc, eq, lte, ne, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contentTypes,
  contentEntries,
  contentRevisions,
  reviewRequests,
  DEFAULT_TENANT_ID,
  type FieldDef,
} from "../db/schema.js";
import {
  validateEntryData,
  validateFieldDefs,
  ValidationError,
} from "./validation.js";
import { recordEvent } from "./events.js";
import { shouldHoldForReview, mayDecideReview } from "./policy.js";

export { ValidationError };

/**
 * Identity of whoever (or whatever) is performing a mutation.
 *
 * IMPORTANT: `type` is trust-bearing — it drives the review gate and the audit
 * trail. Callers MUST set it from a trusted source (the MCP server's configured
 * principal), never from un-trusted request arguments. The core layer trusts
 * its in-process caller; enforcement of identity lives at the boundary
 * (see src/mcp/server.ts).
 */
export interface Author {
  type: "human" | "agent" | "system";
  id: string;
  note?: string;
}

function defaultAuthor(override?: Partial<Author>): Author {
  return {
    type:
      override?.type ??
      (process.env.CMS_PRINCIPAL_TYPE as Author["type"]) ??
      "agent",
    id: override?.id ?? process.env.CMS_PRINCIPAL_ID ?? "agent",
    note: override?.note,
  };
}

/** Resolve the tenant for an operation; everything is scoped to it. */
function tid(input?: { tenantId?: string }): string {
  return input?.tenantId ?? DEFAULT_TENANT_ID;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// The transaction handle type, derived from db.transaction.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Enforce `unique` field constraints by checking for an existing entry of the
 * same type with the same value. Best-effort: under heavy concurrency a true
 * guarantee would need a unique index on the JSONB expression; this check runs
 * inside the mutation's transaction, which is sufficient for typical use.
 */
async function checkUnique(
  tx: Tx,
  typeId: string,
  fields: FieldDef[],
  data: Record<string, unknown>,
  excludeId?: string,
) {
  const uniques = fields.filter(
    (f) => f.unique && Object.prototype.hasOwnProperty.call(data, f.name),
  );
  for (const f of uniques) {
    const value = data[f.name];
    if (value === null || value === undefined) continue;
    const conds = [
      eq(contentEntries.typeId, typeId),
      sql`${contentEntries.data} ->> ${f.name} = ${String(value)}`,
    ];
    if (excludeId) conds.push(ne(contentEntries.id, excludeId));
    const [dup] = await tx
      .select({ id: contentEntries.id })
      .from(contentEntries)
      .where(and(...conds))
      .limit(1);
    if (dup) {
      throw new ValidationError([
        `"${f.name}" must be unique; an entry with that value already exists`,
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

export async function listContentTypes(tenantId: string = DEFAULT_TENANT_ID) {
  return db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.tenantId, tenantId))
    .orderBy(contentTypes.name);
}

export async function getContentType(
  name: string,
  tenantId: string = DEFAULT_TENANT_ID,
) {
  const [type] = await db
    .select()
    .from(contentTypes)
    .where(and(eq(contentTypes.name, name), eq(contentTypes.tenantId, tenantId)));
  if (!type) throw new NotFoundError(`content type "${name}" not found`);
  return type;
}

export async function createContentType(input: {
  name: string;
  displayName: string;
  description?: string;
  fields: FieldDef[];
  requireApproval?: boolean;
  tenantId?: string;
}) {
  if (!/^[a-z][a-z0-9_]*$/.test(input.name)) {
    throw new ValidationError([
      `type name "${input.name}" must be snake_case (a-z, 0-9, _)`,
    ]);
  }
  validateFieldDefs(input.fields);
  const tenantId = tid(input);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(contentTypes)
      .values({
        tenantId,
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        fields: input.fields,
        requireApproval: input.requireApproval ?? false,
      })
      .returning();
    await recordEvent(tx, "type.created", { type: created }, tenantId);
    return created!;
  });
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function listEntries(input: {
  type: string;
  status?: "draft" | "scheduled" | "pending_review" | "published" | "archived";
  limit?: number;
  offset?: number;
  tenantId?: string;
}) {
  const tenantId = tid(input);
  const type = await getContentType(input.type, tenantId);
  const conditions = [
    eq(contentEntries.tenantId, tenantId),
    eq(contentEntries.typeId, type.id),
  ];
  if (input.status) conditions.push(eq(contentEntries.status, input.status));

  return db
    .select()
    .from(contentEntries)
    .where(and(...conditions))
    .orderBy(desc(contentEntries.updatedAt))
    .limit(input.limit ?? 50)
    .offset(input.offset ?? 0);
}

export async function getEntry(id: string, tenantId: string = DEFAULT_TENANT_ID) {
  const [entry] = await db
    .select()
    .from(contentEntries)
    .where(and(eq(contentEntries.id, id), eq(contentEntries.tenantId, tenantId)));
  if (!entry) throw new NotFoundError(`entry "${id}" not found`);
  return entry;
}

export async function getEntryHistory(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID,
) {
  await getEntry(id, tenantId); // ensure it exists in this tenant
  return db
    .select()
    .from(contentRevisions)
    .where(eq(contentRevisions.entryId, id))
    .orderBy(desc(contentRevisions.revision));
}

export async function createEntry(input: {
  type: string;
  data: Record<string, unknown>;
  slug?: string;
  status?: "draft" | "published";
  author?: Partial<Author>;
  tenantId?: string;
}) {
  const tenantId = tid(input);
  const type = await getContentType(input.type, tenantId);
  const clean = validateEntryData(type.fields, input.data);
  const author = defaultAuthor(input.author);
  const status = input.status ?? "draft";

  return db.transaction(async (tx) => {
    await checkUnique(tx, type.id, type.fields, clean);
    const [entry] = await tx
      .insert(contentEntries)
      .values({
        tenantId,
        typeId: type.id,
        slug: input.slug,
        data: clean,
        status,
        revision: 1,
      })
      .returning();

    await tx.insert(contentRevisions).values({
      entryId: entry!.id,
      revision: 1,
      data: clean,
      status,
      action: "create",
      authorType: author.type,
      authorId: author.id,
      note: author.note,
    });

    await recordEvent(tx, "entry.created", { entry: entry! }, tenantId);
    return entry!;
  });
}

export async function updateEntry(input: {
  id: string;
  data: Record<string, unknown>;
  author?: Partial<Author>;
  tenantId?: string;
}) {
  const author = defaultAuthor(input.author);
  const tenantId = tid(input);

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(and(eq(contentEntries.id, input.id), eq(contentEntries.tenantId, tenantId)));
    if (!entry) throw new NotFoundError(`entry "${input.id}" not found`);

    const [type] = await tx
      .select()
      .from(contentTypes)
      .where(eq(contentTypes.id, entry.typeId));

    const validated = validateEntryData(type!.fields, input.data, { partial: true });
    await checkUnique(tx, entry.typeId, type!.fields, validated, entry.id);
    const merged = { ...entry.data, ...validated };
    const nextRevision = entry.revision + 1;

    const [updated] = await tx
      .update(contentEntries)
      .set({ data: merged, revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(contentEntries.id, entry.id))
      .returning();

    await tx.insert(contentRevisions).values({
      entryId: entry.id,
      revision: nextRevision,
      data: merged,
      status: updated!.status,
      action: "update",
      authorType: author.type,
      authorId: author.id,
      note: author.note,
    });

    await recordEvent(tx, "entry.updated", { entry: updated! }, tenantId);
    return updated!;
  });
}

export async function setEntryStatus(input: {
  id: string;
  status: "draft" | "published" | "archived";
  author?: Partial<Author>;
  tenantId?: string;
}) {
  const author = defaultAuthor(input.author);
  const tenantId = tid(input);

  // Review gate: an agent publishing an approval-gated type does not publish —
  // it queues a request for a human. Humans/system bypass (they are the approval).
  if (input.status === "published") {
    const entry = await getEntry(input.id, tenantId);
    const [type] = await db
      .select()
      .from(contentTypes)
      .where(eq(contentTypes.id, entry.typeId));
    if (shouldHoldForReview(input.status, author.type, type?.requireApproval ?? false)) {
      return requestPublish(entry, author);
    }
  }

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(and(eq(contentEntries.id, input.id), eq(contentEntries.tenantId, tenantId)));
    if (!entry) throw new NotFoundError(`entry "${input.id}" not found`);

    const nextRevision = entry.revision + 1;
    const [updated] = await tx
      .update(contentEntries)
      .set({ status: input.status, revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(contentEntries.id, entry.id))
      .returning();

    await tx.insert(contentRevisions).values({
      entryId: entry.id,
      revision: nextRevision,
      data: entry.data,
      status: input.status,
      action: input.status === "published" ? "publish" : `status:${input.status}`,
      authorType: author.type,
      authorId: author.id,
      note: author.note,
    });

    const statusEvent =
      input.status === "published"
        ? "entry.published"
        : input.status === "archived"
          ? "entry.archived"
          : "entry.unpublished";
    await recordEvent(tx, statusEvent, { entry: updated! }, tenantId);
    return updated!;
  });
}

/**
 * Permanently delete an entry and its revision history (cascades). This is a
 * hard delete — for a reversible "remove from view", set the status to archived.
 */
export async function deleteEntry(input: {
  id: string;
  author?: Partial<Author>;
  tenantId?: string;
}) {
  const author = defaultAuthor(input.author);
  const tenantId = tid(input);

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(and(eq(contentEntries.id, input.id), eq(contentEntries.tenantId, tenantId)));
    if (!entry) throw new NotFoundError(`entry "${input.id}" not found`);

    await recordEvent(tx, "entry.deleted", { entry }, tenantId);
    await tx.delete(contentEntries).where(eq(contentEntries.id, entry.id));

    return { deleted: true, id: entry.id };
  });
}

// ---------------------------------------------------------------------------
// Scheduled publishing
// ---------------------------------------------------------------------------

export async function schedulePublish(input: {
  id: string;
  publishAt: string;
  author?: Partial<Author>;
  tenantId?: string;
}) {
  const author = defaultAuthor(input.author);
  const tenantId = tid(input);
  const when = new Date(input.publishAt);
  if (Number.isNaN(when.getTime())) {
    throw new ValidationError(["publishAt must be an ISO date-time string"]);
  }

  const entry = await getEntry(input.id, tenantId);
  const [type] = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.id, entry.typeId));
  if (type?.requireApproval && author.type === "agent") {
    throw new ValidationError([
      "agents cannot schedule approval-gated content; request a review instead",
    ]);
  }

  return db.transaction(async (tx) => {
    const nextRevision = entry.revision + 1;
    const [updated] = await tx
      .update(contentEntries)
      .set({ status: "scheduled", publishAt: when, revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(contentEntries.id, entry.id))
      .returning();
    await tx.insert(contentRevisions).values({
      entryId: entry.id,
      revision: nextRevision,
      data: entry.data,
      status: "scheduled",
      action: "schedule",
      authorType: author.type,
      authorId: author.id,
      note: author.note,
    });
    await recordEvent(
      tx,
      "entry.scheduled",
      { entry: updated!, publishAt: when.toISOString() },
      tenantId,
    );
    return updated!;
  });
}

export async function cancelSchedule(input: {
  id: string;
  author?: Partial<Author>;
  tenantId?: string;
}) {
  const author = defaultAuthor(input.author);
  const tenantId = tid(input);
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(and(eq(contentEntries.id, input.id), eq(contentEntries.tenantId, tenantId)));
    if (!entry) throw new NotFoundError(`entry "${input.id}" not found`);
    if (entry.status !== "scheduled") {
      throw new ValidationError(["entry is not scheduled"]);
    }
    const nextRevision = entry.revision + 1;
    const [updated] = await tx
      .update(contentEntries)
      .set({ status: "draft", publishAt: null, revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(contentEntries.id, entry.id))
      .returning();
    await tx.insert(contentRevisions).values({
      entryId: entry.id,
      revision: nextRevision,
      data: entry.data,
      status: "draft",
      action: "unschedule",
      authorType: author.type,
      authorId: author.id,
      note: author.note,
    });
    await recordEvent(tx, "entry.updated", { entry: updated! }, tenantId);
    return updated!;
  });
}

/**
 * Publish any scheduled entries whose time has come — across all tenants (this
 * is infrastructure). Each event is recorded under its own entry's tenant.
 */
export async function publishScheduledDue(limit = 100): Promise<number> {
  const due = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.status, "scheduled"),
        lte(contentEntries.publishAt, sql`now()`),
      ),
    )
    .limit(limit);

  for (const entry of due) {
    await db.transaction(async (tx) => {
      const nextRevision = entry.revision + 1;
      const [updated] = await tx
        .update(contentEntries)
        .set({ status: "published", publishAt: null, revision: nextRevision, updatedAt: sql`now()` })
        .where(eq(contentEntries.id, entry.id))
        .returning();
      await tx.insert(contentRevisions).values({
        entryId: entry.id,
        revision: nextRevision,
        data: entry.data,
        status: "published",
        action: "publish:scheduled",
        authorType: "system",
        authorId: "scheduler",
        note: "Scheduled publish",
      });
      await recordEvent(tx, "entry.published", { entry: updated! }, entry.tenantId);
    });
  }
  return due.length;
}

/** Restore an entry's data to a previous revision, recorded as a new revision. */
export async function revertEntry(input: {
  id: string;
  toRevision: number;
  author?: Partial<Author>;
  tenantId?: string;
}) {
  const author = defaultAuthor(input.author);
  const tenantId = tid(input);

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(and(eq(contentEntries.id, input.id), eq(contentEntries.tenantId, tenantId)));
    if (!entry) throw new NotFoundError(`entry "${input.id}" not found`);

    const [target] = await tx
      .select()
      .from(contentRevisions)
      .where(
        and(
          eq(contentRevisions.entryId, input.id),
          eq(contentRevisions.revision, input.toRevision),
        ),
      );
    if (!target) {
      throw new NotFoundError(
        `revision ${input.toRevision} not found for entry "${input.id}"`,
      );
    }

    const nextRevision = entry.revision + 1;
    const [updated] = await tx
      .update(contentEntries)
      .set({ data: target.data, revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(contentEntries.id, entry.id))
      .returning();

    await tx.insert(contentRevisions).values({
      entryId: entry.id,
      revision: nextRevision,
      data: target.data,
      status: updated!.status,
      action: `revert:${input.toRevision}`,
      authorType: author.type,
      authorId: author.id,
      note: author.note ?? `Reverted to revision ${input.toRevision}`,
    });

    await recordEvent(
      tx,
      "entry.reverted",
      { entry: updated!, toRevision: input.toRevision },
      tenantId,
    );
    return updated!;
  });
}

// ---------------------------------------------------------------------------
// Review gate
// ---------------------------------------------------------------------------

/** Internal: queue an agent's publish for human approval instead of publishing. */
async function requestPublish(
  entry: typeof contentEntries.$inferSelect,
  author: Author,
) {
  const [existing] = await db
    .select()
    .from(reviewRequests)
    .where(
      and(
        eq(reviewRequests.entryId, entry.id),
        eq(reviewRequests.status, "pending"),
      ),
    );
  if (existing) {
    return {
      pending: true,
      message: "A review is already pending for this entry.",
      entry,
      review: existing,
    };
  }

  const result = await db.transaction(async (tx) => {
    const nextRevision = entry.revision + 1;
    const [updated] = await tx
      .update(contentEntries)
      .set({ status: "pending_review", revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(contentEntries.id, entry.id))
      .returning();

    await tx.insert(contentRevisions).values({
      entryId: entry.id,
      revision: nextRevision,
      data: entry.data,
      status: "pending_review",
      action: "request_review",
      authorType: author.type,
      authorId: author.id,
      note: author.note,
    });

    const [review] = await tx
      .insert(reviewRequests)
      .values({
        tenantId: entry.tenantId,
        entryId: entry.id,
        revision: nextRevision,
        requestedByType: author.type,
        requestedById: author.id,
        requestNote: author.note,
      })
      .returning();

    await recordEvent(
      tx,
      "entry.review_requested",
      { entry: updated!, review: review! },
      entry.tenantId,
    );
    return { entry: updated!, review: review! };
  });

  return {
    pending: true,
    message: "Publish requires human approval. A review has been queued.",
    ...result,
  };
}

export async function listReviews(
  input: { status?: "pending" | "approved" | "rejected"; tenantId?: string } = {},
) {
  const tenantId = tid(input);
  const conds = [eq(reviewRequests.tenantId, tenantId)];
  if (input.status) conds.push(eq(reviewRequests.status, input.status));
  return db
    .select()
    .from(reviewRequests)
    .where(and(...conds))
    .orderBy(desc(reviewRequests.createdAt));
}

export async function approveReview(input: {
  requestId: string;
  author?: Partial<Author>;
  note?: string;
  tenantId?: string;
}) {
  const author = defaultAuthor({ type: "human", ...input.author });
  const tenantId = tid(input);
  if (!mayDecideReview(author.type)) {
    throw new ValidationError([
      "agents cannot approve reviews; a human or system principal is required",
    ]);
  }

  return db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(reviewRequests)
      .where(and(eq(reviewRequests.id, input.requestId), eq(reviewRequests.tenantId, tenantId)));
    if (!review) throw new NotFoundError(`review "${input.requestId}" not found`);
    if (review.status !== "pending") {
      throw new ValidationError([`review is already ${review.status}`]);
    }

    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(eq(contentEntries.id, review.entryId));
    if (!entry) throw new NotFoundError(`entry "${review.entryId}" not found`);

    const nextRevision = entry.revision + 1;
    const [updated] = await tx
      .update(contentEntries)
      .set({ status: "published", revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(contentEntries.id, entry.id))
      .returning();

    await tx.insert(contentRevisions).values({
      entryId: entry.id,
      revision: nextRevision,
      data: entry.data,
      status: "published",
      action: "approve",
      authorType: author.type,
      authorId: author.id,
      note: input.note ?? author.note,
    });

    const [decided] = await tx
      .update(reviewRequests)
      .set({
        status: "approved",
        decidedByType: author.type,
        decidedById: author.id,
        decisionNote: input.note,
        decidedAt: sql`now()`,
      })
      .where(eq(reviewRequests.id, review.id))
      .returning();

    await recordEvent(tx, "entry.published", { entry: updated! }, tenantId);
    await recordEvent(tx, "review.approved", { review: decided!, entry: updated! }, tenantId);
    return { entry: updated!, review: decided! };
  });
}

export async function rejectReview(input: {
  requestId: string;
  author?: Partial<Author>;
  note?: string;
  tenantId?: string;
}) {
  const author = defaultAuthor({ type: "human", ...input.author });
  const tenantId = tid(input);
  if (!mayDecideReview(author.type)) {
    throw new ValidationError([
      "agents cannot reject reviews; a human or system principal is required",
    ]);
  }

  return db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(reviewRequests)
      .where(and(eq(reviewRequests.id, input.requestId), eq(reviewRequests.tenantId, tenantId)));
    if (!review) throw new NotFoundError(`review "${input.requestId}" not found`);
    if (review.status !== "pending") {
      throw new ValidationError([`review is already ${review.status}`]);
    }

    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(eq(contentEntries.id, review.entryId));
    if (!entry) throw new NotFoundError(`entry "${review.entryId}" not found`);

    const nextRevision = entry.revision + 1;
    const [updated] = await tx
      .update(contentEntries)
      .set({ status: "draft", revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(contentEntries.id, entry.id))
      .returning();

    await tx.insert(contentRevisions).values({
      entryId: entry.id,
      revision: nextRevision,
      data: entry.data,
      status: "draft",
      action: "reject",
      authorType: author.type,
      authorId: author.id,
      note: input.note ?? author.note,
    });

    const [decided] = await tx
      .update(reviewRequests)
      .set({
        status: "rejected",
        decidedByType: author.type,
        decidedById: author.id,
        decisionNote: input.note,
        decidedAt: sql`now()`,
      })
      .where(eq(reviewRequests.id, review.id))
      .returning();

    await recordEvent(tx, "review.rejected", { review: decided!, entry: updated! }, tenantId);
    return { entry: updated!, review: decided! };
  });
}
