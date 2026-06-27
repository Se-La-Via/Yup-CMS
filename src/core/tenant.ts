import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { tenants, DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from "../db/schema.js";

export { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG };

export async function listTenants() {
  return db.select().from(tenants).orderBy(tenants.createdAt);
}

export async function createTenant(input: { slug: string; name: string }) {
  if (!/^[a-z][a-z0-9-]*$/.test(input.slug)) {
    throw new Error("tenant slug must be kebab-case (a-z, 0-9, -)");
  }
  const [t] = await db
    .insert(tenants)
    .values({ slug: input.slug, name: input.name })
    .returning();
  return t!;
}

// slug -> id cache (slugs/ids are immutable once created).
const cache = new Map<string, string>([[DEFAULT_TENANT_SLUG, DEFAULT_TENANT_ID]]);

/** Resolve a tenant slug (or undefined → default) to its id. */
export async function resolveTenantId(slug?: string): Promise<string> {
  const s = slug ?? DEFAULT_TENANT_SLUG;
  const hit = cache.get(s);
  if (hit) return hit;
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, s));
  if (!t) throw new Error(`unknown tenant "${s}"`);
  cache.set(s, t.id);
  return t.id;
}
