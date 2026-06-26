import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { contentTypes, contentEntries, type FieldDef } from "../db/schema.js";
import { getContentType, getEntry, NotFoundError } from "./content.js";

/**
 * Public read layer for front-ends. Defaults to published content and can
 * expand `reference` fields into the referenced (published) entry.
 *
 * This is the outward-facing surface — the read side of the CMS that a website
 * or app consumes, as opposed to the MCP tools that agents write through.
 */

export type Status = "draft" | "pending_review" | "published" | "archived";

export async function list(input: {
  type: string;
  status?: Status;
  slug?: string;
  limit?: number;
  offset?: number;
  resolve?: boolean;
}) {
  const type = await getContentType(input.type);
  const conditions = [
    eq(contentEntries.typeId, type.id),
    eq(contentEntries.status, input.status ?? "published"),
  ];
  if (input.slug) conditions.push(eq(contentEntries.slug, input.slug));

  const rows = await db
    .select()
    .from(contentEntries)
    .where(and(...conditions))
    .orderBy(desc(contentEntries.updatedAt))
    .limit(input.limit ?? 50)
    .offset(input.offset ?? 0);

  if (!input.resolve) return rows;
  return Promise.all(
    rows.map(async (r) => ({ ...r, data: await resolveRefs(type.fields, r.data) })),
  );
}

export async function getBySlug(input: {
  type: string;
  slug: string;
  status?: Status;
  resolve?: boolean;
}) {
  const [entry] = await list({ ...input, slug: input.slug, limit: 1 });
  if (!entry) {
    throw new NotFoundError(
      `no ${input.status ?? "published"} "${input.type}" entry with slug "${input.slug}"`,
    );
  }
  return entry;
}

export async function getById(input: { id: string; resolve?: boolean }) {
  const entry = await getEntry(input.id);
  if (!input.resolve) return entry;

  const [type] = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.id, entry.typeId));
  if (!type) return entry;
  return { ...entry, data: await resolveRefs(type.fields, entry.data) };
}

/**
 * Replace each `reference` field's stored id with the referenced entry
 * (id, type, data) — but only if that entry is published. Unresolvable or
 * unpublished references become null. One level deep; no cycle expansion.
 */
async function resolveRefs(
  fields: FieldDef[],
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...data };
  for (const f of fields) {
    if (f.type !== "reference") continue;
    const id = out[f.name];
    if (typeof id !== "string") continue;

    const [ref] = await db
      .select()
      .from(contentEntries)
      .where(and(eq(contentEntries.id, id), eq(contentEntries.status, "published")));
    out[f.name] = ref ? { id: ref.id, type: f.refType, data: ref.data } : null;
  }
  return out;
}
