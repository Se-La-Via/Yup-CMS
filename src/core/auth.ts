import { randomBytes, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys, DEFAULT_TENANT_ID } from "../db/schema.js";

/**
 * API-key authentication for the read API.
 *
 * Trust model: the MCP server is the trusted control plane (whoever runs it
 * holds the DB credentials), so key administration lives there. The read API is
 * the untrusted public surface, so it is what keys actually guard.
 */

export const SCOPES = ["read:published", "read:all", "admin"] as const;
export type Scope = (typeof SCOPES)[number];

export type ApiKeyRecord = typeof apiKeys.$inferSelect;
export type PublicApiKey = Omit<ApiKeyRecord, "keyHash">;

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function stripHash(rec: ApiKeyRecord): PublicApiKey {
  const { keyHash: _omit, ...rest } = rec;
  return rest;
}

export async function createApiKey(input: {
  name: string;
  scopes?: string[];
  tenantId?: string;
}) {
  const scopes = input.scopes ?? ["read:published"];
  const invalid = scopes.filter((s) => !SCOPES.includes(s as Scope));
  if (invalid.length > 0) {
    throw new Error(
      `unknown scopes: ${invalid.join(", ")}. Valid: ${SCOPES.join(", ")}`,
    );
  }

  const raw = "yup_" + randomBytes(24).toString("hex");
  const [rec] = await db
    .insert(apiKeys)
    .values({
      tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
      name: input.name,
      keyPrefix: raw.slice(0, 16),
      keyHash: hashKey(raw),
      scopes,
    })
    .returning();

  return {
    key: raw,
    warning: "Store this key now — it is hashed and will never be shown again.",
    apiKey: stripHash(rec!),
  };
}

export async function listApiKeys(
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<PublicApiKey[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId))
    .orderBy(apiKeys.createdAt);
  return rows.map(stripHash);
}

export async function revokeApiKey(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<PublicApiKey> {
  const [rec] = await db
    .update(apiKeys)
    .set({ active: false })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId)))
    .returning();
  if (!rec) throw new Error(`api key "${id}" not found`);
  return stripHash(rec);
}

/** Resolve a raw key to its record, or null if missing/unknown/revoked. */
export async function verifyKey(
  raw: string | undefined,
): Promise<ApiKeyRecord | null> {
  if (!raw) return null;
  const [rec] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashKey(raw)));
  if (!rec || !rec.active) return null;

  // Best-effort usage stamp; must never break the request.
  db.update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiKeys.id, rec.id))
    .catch(() => {});

  return rec;
}

export function hasScope(rec: ApiKeyRecord, scope: Scope): boolean {
  return rec.scopes.includes("admin") || rec.scopes.includes(scope);
}
