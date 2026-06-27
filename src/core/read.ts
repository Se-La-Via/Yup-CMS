import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contentTypes,
  contentEntries,
  DEFAULT_TENANT_ID,
  type FieldDef,
} from "../db/schema.js";
import { getContentType, getEntry, NotFoundError } from "./content.js";

/**
 * Public read layer for front-ends. Defaults to published content and can
 * expand `reference` fields into the referenced (published) entry. Everything
 * is scoped to a tenant.
 */

export type Status =
  | "draft"
  | "scheduled"
  | "pending_review"
  | "published"
  | "archived";

const DEFAULT_LOCALE = process.env.CMS_DEFAULT_LOCALE ?? "en";

/** Flatten localized ({ locale: value }) fields to a single locale, with fallback. */
function localizeData(
  fields: FieldDef[],
  data: Record<string, unknown>,
  locale: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const f of fields) {
    if (!f.localized) continue;
    const v = out[f.name];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const m = v as Record<string, unknown>;
      out[f.name] = m[locale] ?? m[DEFAULT_LOCALE] ?? Object.values(m)[0] ?? null;
    }
  }
  return out;
}

export async function list(input: {
  type: string;
  status?: Status;
  slug?: string;
  limit?: number;
  offset?: number;
  resolve?: boolean;
  locale?: string;
  tenantId?: string;
}) {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const type = await getContentType(input.type, tenantId);
  const conditions = [
    eq(contentEntries.tenantId, tenantId),
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

  if (!input.resolve && !input.locale) return rows;
  return Promise.all(
    rows.map(async (r) => {
      let data = input.resolve
        ? await resolveRefs(type.fields, r.data, tenantId)
        : r.data;
      if (input.locale) data = localizeData(type.fields, data, input.locale);
      return { ...r, data };
    }),
  );
}

export async function getBySlug(input: {
  type: string;
  slug: string;
  status?: Status;
  resolve?: boolean;
  locale?: string;
  tenantId?: string;
}) {
  const [entry] = await list({ ...input, slug: input.slug, limit: 1 });
  if (!entry) {
    throw new NotFoundError(
      `no ${input.status ?? "published"} "${input.type}" entry with slug "${input.slug}"`,
    );
  }
  return entry;
}

/**
 * Full-text search over entry data within a tenant. Matches a text query against
 * the entry's JSON contents. Defaults to published; an optional type narrows it.
 *
 * Uses Postgres full-text search at query time. For large datasets, add a GIN
 * index on `to_tsvector('simple', data::text)`.
 */
export async function search(input: {
  q: string;
  type?: string;
  status?: Status;
  limit?: number;
  tenantId?: string;
}) {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const conditions = [
    eq(contentEntries.tenantId, tenantId),
    eq(contentEntries.status, input.status ?? "published"),
    sql`to_tsvector('simple', ${contentEntries.data}::text) @@ websearch_to_tsquery('simple', ${input.q})`,
  ];
  if (input.type) {
    const type = await getContentType(input.type, tenantId);
    conditions.push(eq(contentEntries.typeId, type.id));
  }
  return db
    .select()
    .from(contentEntries)
    .where(and(...conditions))
    .orderBy(desc(contentEntries.updatedAt))
    .limit(input.limit ?? 20);
}

export async function getById(input: {
  id: string;
  resolve?: boolean;
  locale?: string;
  tenantId?: string;
}) {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const entry = await getEntry(input.id, tenantId);
  if (!input.resolve && !input.locale) return entry;

  const [type] = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.id, entry.typeId));
  if (!type) return entry;
  let data = input.resolve
    ? await resolveRefs(type.fields, entry.data, tenantId)
    : entry.data;
  if (input.locale) data = localizeData(type.fields, data, input.locale);
  return { ...entry, data };
}

/**
 * Replace each `reference` field's stored id with the referenced entry
 * (id, type, data) — but only if that entry is published and in the same tenant.
 * Unresolvable references become null. One level deep; no cycle expansion.
 */
async function resolveRefs(
  fields: FieldDef[],
  data: Record<string, unknown>,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...data };
  for (const f of fields) {
    if (f.type !== "reference") continue;
    const id = out[f.name];
    if (typeof id !== "string") continue;

    const [ref] = await db
      .select()
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.id, id),
          eq(contentEntries.tenantId, tenantId),
          eq(contentEntries.status, "published"),
        ),
      );
    out[f.name] = ref ? { id: ref.id, type: f.refType, data: ref.data } : null;
  }
  return out;
}
