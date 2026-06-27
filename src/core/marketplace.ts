import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { marketplaceItems } from "../db/schema.js";
import { NotFoundError } from "./content.js";
import { signItem, verifyItem, verificationEnabled } from "./signing.js";

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
  // Provide to preserve an existing signature (e.g. when syncing from a remote
  // registry); omitted, the item is signed if a signing key is configured.
  signature?: string | null;
}

export async function publishItem(input: PublishInput) {
  if (input.kind !== "plugin" && input.kind !== "theme") {
    throw new Error('kind must be "plugin" or "theme"');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(input.name)) {
    throw new Error("name must be kebab-case (a-z, 0-9, -)");
  }
  if (!input.specifier) throw new Error("specifier is required");

  // Sign on publish if a signing key is set and no signature was supplied.
  const signature = input.signature ?? signItem(input);
  const verified = signature
    ? verificationEnabled()
      ? verifyItem(input, signature)
      : (input.verified ?? true)
    : (input.verified ?? false);

  const values = {
    kind: input.kind,
    specifier: input.specifier,
    description: input.description,
    version: input.version,
    author: input.author,
    homepage: input.homepage,
    tags: input.tags ?? [],
    verified,
    signature: signature ?? null,
  };

  const [item] = await db
    .insert(marketplaceItems)
    .values({ name: input.name, ...values })
    .onConflictDoUpdate({ target: marketplaceItems.name, set: values })
    .returning();
  return item!;
}

/** Ensure an item is safe to install: when verification is on, its signature must verify. */
export function assertInstallable(item: typeof marketplaceItems.$inferSelect): void {
  if (verificationEnabled() && !verifyItem(item, item.signature)) {
    throw new Error(`"${item.name}" failed signature verification — refusing to install`);
  }
}

/**
 * Import a remote registry (another Yup CMS's GET /marketplace). Verifies each
 * item's signature when a public key is configured; unverifiable items are
 * skipped. Returns counts.
 */
export async function syncFromRegistry(url: string): Promise<{ imported: number; skipped: number }> {
  if (!/^https?:\/\//.test(url)) throw new Error("registry url must be http(s)");
  const res = await fetch(url.replace(/\/$/, "") + "/marketplace", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`registry returned HTTP ${res.status}`);
  const items = (await res.json()) as Array<PublishInput & { signature?: string | null }>;

  let imported = 0;
  let skipped = 0;
  for (const it of items) {
    if (verificationEnabled() && !verifyItem(it, it.signature)) {
      skipped++;
      continue;
    }
    await publishItem({ ...it, signature: it.signature ?? null });
    imported++;
  }
  return { imported, skipped };
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
