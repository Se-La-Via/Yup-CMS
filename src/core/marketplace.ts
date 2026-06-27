import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { marketplaceItems } from "../db/schema.js";
import { NotFoundError } from "./content.js";

/**
 * Plugin & theme marketplace — a registry of installable modules. Publishing
 * adds/updates an entry; installing (elsewhere) appends the entry's specifier to
 * plugins.json so the deployment loads it. The registry is global (shared
 * catalog), not tenant-scoped.
 */

export type ItemKind = "plugin" | "theme";

export interface PublishInput {
  kind: ItemKind;
  name: string;
  specifier: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  tags?: string[];
  verified?: boolean;
}

export async function publishItem(input: PublishInput) {
  if (input.kind !== "plugin" && input.kind !== "theme") {
    throw new Error('kind must be "plugin" or "theme"');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(input.name)) {
    throw new Error("name must be kebab-case (a-z, 0-9, -)");
  }
  if (!input.specifier) throw new Error("specifier is required");

  // Re-publishing the same name updates the entry (idempotent).
  const [item] = await db
    .insert(marketplaceItems)
    .values({
      kind: input.kind,
      name: input.name,
      specifier: input.specifier,
      description: input.description,
      version: input.version,
      author: input.author,
      homepage: input.homepage,
      tags: input.tags ?? [],
      verified: input.verified ?? false,
    })
    .onConflictDoUpdate({
      target: marketplaceItems.name,
      set: {
        kind: input.kind,
        specifier: input.specifier,
        description: input.description,
        version: input.version,
        author: input.author,
        homepage: input.homepage,
        tags: input.tags ?? [],
        verified: input.verified ?? false,
      },
    })
    .returning();
  return item!;
}

export async function listItems(
  input: { kind?: ItemKind; q?: string; limit?: number } = {},
) {
  const conds = [];
  if (input.kind) conds.push(eq(marketplaceItems.kind, input.kind));
  if (input.q) {
    const pat = `%${input.q}%`;
    conds.push(or(ilike(marketplaceItems.name, pat), ilike(marketplaceItems.description, pat)));
  }
  return db
    .select()
    .from(marketplaceItems)
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(marketplaceItems.verified), marketplaceItems.name)
    .limit(input.limit ?? 100);
}

export async function getItem(name: string) {
  const [item] = await db
    .select()
    .from(marketplaceItems)
    .where(eq(marketplaceItems.name, name));
  if (!item) throw new NotFoundError(`marketplace item "${name}" not found`);
  return item;
}

export async function removeItem(name: string) {
  const [removed] = await db
    .delete(marketplaceItems)
    .where(eq(marketplaceItems.name, name))
    .returning();
  if (!removed) throw new NotFoundError(`marketplace item "${name}" not found`);
  return { removed: true, name };
}
