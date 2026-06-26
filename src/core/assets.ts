import { randomUUID, createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { assets } from "../db/schema.js";
import { getStorage } from "./storage.js";
import { NotFoundError } from "./content.js";

const MAX_BYTES = Number(process.env.CMS_MAX_ASSET_BYTES ?? 10_000_000); // 10 MB

/**
 * Create an asset from inline base64 data or by fetching a source URL. Bytes go
 * to the storage backend; metadata is recorded in Postgres.
 */
export async function createAsset(input: {
  filename: string;
  contentType?: string;
  dataBase64?: string;
  sourceUrl?: string;
}) {
  let bytes: Buffer;
  let contentType = input.contentType;

  if (input.dataBase64) {
    bytes = Buffer.from(input.dataBase64, "base64");
  } else if (input.sourceUrl) {
    if (!/^https?:\/\//.test(input.sourceUrl)) {
      throw new Error("sourceUrl must start with http:// or https://");
    }
    const res = await fetch(input.sourceUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`failed to fetch sourceUrl: HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
    contentType = contentType ?? res.headers.get("content-type") ?? undefined;
  } else {
    throw new Error("provide either dataBase64 or sourceUrl");
  }

  if (bytes.length === 0) throw new Error("asset is empty");
  if (bytes.length > MAX_BYTES) {
    throw new Error(`asset exceeds the maximum size of ${MAX_BYTES} bytes`);
  }

  const id = randomUUID();
  const checksum = createHash("sha256").update(bytes).digest("hex");

  await getStorage().put(id, bytes);
  try {
    const [row] = await db
      .insert(assets)
      .values({
        id,
        filename: input.filename,
        contentType: contentType || "application/octet-stream",
        size: bytes.length,
        checksum,
        storageKey: id,
      })
      .returning();
    return row!;
  } catch (e) {
    // Don't leave an orphaned file if the metadata insert fails.
    await getStorage().delete(id).catch(() => {});
    throw e;
  }
}

export async function listAssets(limit = 50) {
  return db.select().from(assets).orderBy(desc(assets.createdAt)).limit(limit);
}

export async function getAsset(id: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, id));
  if (!row) throw new NotFoundError(`asset "${id}" not found`);
  return row;
}

export async function getAssetBytes(id: string) {
  const meta = await getAsset(id);
  const bytes = await getStorage().get(meta.storageKey);
  if (!bytes) throw new NotFoundError(`asset "${id}" data is missing from storage`);
  return { meta, bytes };
}

export async function deleteAsset(id: string) {
  const meta = await getAsset(id);
  await db.delete(assets).where(eq(assets.id, id));
  await getStorage().delete(meta.storageKey).catch(() => {});
  return { deleted: true, id };
}
