import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contentTypes,
  contentEntries,
  contentRevisions,
  reviewRequests,
  type FieldDef,
} from "../db/schema.js";
import {
  validateEntryData,
  validateFieldDefs,
  ValidationError,
} from "./validation.js";
import { emit } from "./events.js";

export { ValidationError };

/** Identity of whoever (or whatever) is performing a mutation. */
export interface Author {
  type: "human" | "agent" | "system";
  id: string;
  note?: string;
}

function defaultAuthor(override?: Partial<Author>): Author {
  return {
    type:
      override?.type ??
      (process.env.CMS_DEFAULT_AUTHOR_TYPE as Author["type"]) ??
      "agent",
    id: override?.id ?? process.env.CMS_DEFAULT_AUTHOR_ID ?? "agent",
    note: override?.note,
  };
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

export async function listContentTypes() {
  return db.select().from(contentTypes).orderBy(contentTypes.name);
}

export async function getContentType(name: string) {
  const [type] = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.name, name));
  if (!type) throw new NotFoundError(`content type "${name}" not found`);
  return type;
}

export async function createContentType(input: {
  name: string;
  displayName: string;
  description?: string;
  fields: FieldDef[];
  requireApproval?: boolean;
}) {
  if (!/^[a-z][a-z0-9_]*$/.test(input.name)) {
    throw new ValidationError([
      `type name "${input.name}" must be snake_case (a-z, 0-9, _)`,
    ]);
  }
  validateFieldDefs(input.fields);

  const [created] = await db
    .insert(contentTypes)
    .values({
      name: input.name,
      displayName: input.displayName,
      description: input.description,
      fields: input.fields,
      requireApproval: input.requireApproval ?? false,
    })
    .returning();
  await emit("type.created", { type: created });
  return created;
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function listEntries(input: {
  type: string;
  status?: "draft" | "published" | "archived";
  limit?: number;
  offset?: number;
}) {
  const type = await getContentType(input.type);
  const conditions = [eq(contentEntries.typeId, type.id)];
  if (input.status) conditions.push(eq(contentEntries.status, input.status));

  return db
    .select()
    .from(contentEntries)
    .where(and(...conditions))
    .orderBy(desc(contentEntries.updatedAt))
    .limit(input.limit ?? 50)
    .offset(input.offset ?? 0);
}

export async function getEntry(id: string) {
  const [entry] = await db
    .select()
    .from(contentEntries)
    .where(eq(contentEntries.id, id));
  if (!entry) throw new NotFoundError(`entry "${id}" not found`);
  return entry;
}

export async function getEntryHistory(id: string) {
  await getEntry(id); // ensure it exists
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
}) {
  const type = await getContentType(input.type);
  const clean = validateEntryData(type.fields, input.data);
  const author = defaultAuthor(input.author);
  const status = input.status ?? "draft";

  const entry = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(contentEntries)
      .values({
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

    return entry!;
  });

  await emit("entry.created", { entry, author });
  return entry;
}

export async function updateEntry(input: {
  id: string;
  data: Record<string, unknown>;
  author?: Partial<Author>;
}) {
  const author = defaultAuthor(input.author);

  const updated = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(eq(contentEntries.id, input.id));
    if (!entry) throw new NotFoundError(`entry "${input.id}" not found`);

    const [type] = await tx
      .select()
      .from(contentTypes)
      .where(eq(contentTypes.id, entry.typeId));

    // Partial update: validate only the supplied fields, then merge.
    const validated = validateEntryData(type!.fields, input.data, {
      partial: true,
    });
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

    return updated!;
  });

  await emit("entry.updated", { entry: updated, author });
  return updated;
}

export async function setEntryStatus(input: {
  id: string;
  status: "draft" | "published" | "archived";
  author?: Partial<Author>;
}) {
  const author = defaultAuthor(input.author);

  // Review gate: an agent publishing a type that requires approval does not
  // publish — it queues a request for a human. Humans bypass the gate (they
  // are the approval).
  if (input.status === "published" && author.type === "agent") {
    const entry = await getEntry(input.id);
    const [type] = await db
      .select()
      .from(contentTypes)
      .where(eq(contentTypes.id, entry.typeId));
    if (type?.requireApproval) {
      return requestPublish(entry, author);
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(eq(contentEntries.id, input.id));
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

    return updated!;
  });

  const statusEvent =
    input.status === "published"
      ? "entry.published"
      : input.status === "archived"
        ? "entry.archived"
        : "entry.unpublished";
  await emit(statusEvent, { entry: updated, author });
  return updated;
}

/** Restore an entry's data to a previous revision, recorded as a new revision. */
export async function revertEntry(input: {
  id: string;
  toRevision: number;
  author?: Partial<Author>;
}) {
  const author = defaultAuthor(input.author);

  const updated = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(contentEntries)
      .where(eq(contentEntries.id, input.id));
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

    return updated!;
  });

  await emit("entry.reverted", { entry: updated, toRevision: input.toRevision, author });
  return updated;
}

// ---------------------------------------------------------------------------
// Review gate
// ---------------------------------------------------------------------------

/** Internal: queue an agent's publish for human approval instead of publishing. */
async function requestPublish(
  entry: typeof contentEntries.$inferSelect,
  author: Author,
) {
  // Don't stack duplicate requests — reuse an open one if it exists.
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
        entryId: entry.id,
        revision: nextRevision,
        requestedByType: author.type,
        requestedById: author.id,
        requestNote: author.note,
      })
      .returning();

    return { entry: updated!, review: review! };
  });

  await emit("entry.review_requested", {
    entry: result.entry,
    review: result.review,
    author,
  });
  return {
    pending: true,
    message: "Publish requires human approval. A review has been queued.",
    ...result,
  };
}

export async function listReviews(
  input: { status?: "pending" | "approved" | "rejected" } = {},
) {
  const base = db.select().from(reviewRequests);
  return input.status
    ? base
        .where(eq(reviewRequests.status, input.status))
        .orderBy(desc(reviewRequests.createdAt))
    : base.orderBy(desc(reviewRequests.createdAt));
}

export async function approveReview(input: {
  requestId: string;
  author?: Partial<Author>;
  note?: string;
}) {
  const author = defaultAuthor({ type: "human", ...input.author });

  const result = await db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.id, input.requestId));
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

    return { entry: updated!, review: decided! };
  });

  await emit("entry.published", { entry: result.entry, author });
  await emit("review.approved", {
    review: result.review,
    entry: result.entry,
    author,
  });
  return result;
}

export async function rejectReview(input: {
  requestId: string;
  author?: Partial<Author>;
  note?: string;
}) {
  const author = defaultAuthor({ type: "human", ...input.author });

  const result = await db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.id, input.requestId));
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

    return { entry: updated!, review: decided! };
  });

  await emit("review.rejected", {
    review: result.review,
    entry: result.entry,
    author,
  });
  return result;
}
