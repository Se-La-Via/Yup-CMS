import { graphql, GraphQLError } from "graphql";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { contentTypes } from "../db/schema.js";
import { schema } from "./graphql-schema.js";
import * as content from "./content.js";
import * as read from "./read.js";
import * as assets from "./assets.js";
import * as auth from "./auth.js";

/**
 * GraphQL read layer. Same trust rules as the REST read API: published content
 * is public; reading non-published (an explicit non-published status, or a
 * by-id lookup that could return a draft) needs a `read:all` API key.
 */

export interface GraphQLContext {
  key: auth.ApiKeyRecord | null;
  tenantId: string;
}

function requireReadAll(ctx: GraphQLContext) {
  if (!ctx.key || !auth.hasScope(ctx.key, "read:all")) {
    throw new GraphQLError(
      "an API key with the 'read:all' scope is required to read non-published content",
    );
  }
}

function requireForStatus(status: string | undefined, ctx: GraphQLContext) {
  if (status && status !== "published") requireReadAll(ctx);
}

async function typeNameOf(typeId: string): Promise<string> {
  const [t] = await db
    .select({ name: contentTypes.name })
    .from(contentTypes)
    .where(eq(contentTypes.id, typeId));
  return t?.name ?? "";
}

type Row = typeof import("../db/schema.js").contentEntries.$inferSelect;

function mapEntry(row: Row, typeName: string) {
  return {
    id: row.id,
    type: typeName,
    slug: row.slug,
    status: row.status,
    revision: row.revision,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const root = {
  contentTypes: (_args: unknown, ctx: GraphQLContext) =>
    content.listContentTypes(ctx.tenantId),
  contentType: ({ name }: { name: string }, ctx: GraphQLContext) =>
    content.getContentType(name, ctx.tenantId).catch(() => null),

  entries: async (
    args: { type: string; status?: string; limit?: number; offset?: number; locale?: string },
    ctx: GraphQLContext,
  ) => {
    requireForStatus(args.status, ctx);
    const rows = await read.list({
      type: args.type,
      status: (args.status as read.Status) ?? "published",
      limit: args.limit,
      offset: args.offset,
      locale: args.locale,
      tenantId: ctx.tenantId,
    });
    return rows.map((r) => mapEntry(r, args.type));
  },

  entry: async ({ id, locale }: { id: string; locale?: string }, ctx: GraphQLContext) => {
    // A by-id lookup can return any status, so it is always privileged.
    requireReadAll(ctx);
    const e = await read.getById({ id, locale, tenantId: ctx.tenantId }).catch(() => null);
    if (!e) return null;
    return mapEntry(e, await typeNameOf(e.typeId));
  },

  entryBySlug: async (
    args: { type: string; slug: string; status?: string; locale?: string },
    ctx: GraphQLContext,
  ) => {
    requireForStatus(args.status, ctx);
    const e = await read
      .getBySlug({
        type: args.type,
        slug: args.slug,
        status: (args.status as read.Status) ?? "published",
        locale: args.locale,
        tenantId: ctx.tenantId,
      })
      .catch(() => null);
    return e ? mapEntry(e, args.type) : null;
  },

  search: async (
    args: { q: string; type?: string; status?: string; limit?: number },
    ctx: GraphQLContext,
  ) => {
    requireForStatus(args.status, ctx);
    const rows = await read.search({
      q: args.q,
      type: args.type,
      status: (args.status as read.Status) ?? "published",
      limit: args.limit,
      tenantId: ctx.tenantId,
    });
    return Promise.all(
      rows.map(async (r) => mapEntry(r, await typeNameOf(r.typeId))),
    );
  },

  assets: ({ limit }: { limit?: number }, ctx: GraphQLContext) =>
    assets.listAssets(ctx.tenantId, limit ?? 50),
};

export async function executeGraphQL(
  source: string,
  variableValues: Record<string, unknown> | undefined,
  context: GraphQLContext,
) {
  return graphql({ schema, source, rootValue: root, contextValue: context, variableValues });
}
