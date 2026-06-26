import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Pluggable storage for asset bytes. The metadata lives in Postgres; only the
 * raw bytes go here. Keys are server-generated UUIDs (no path traversal).
 *
 * Built-in backend: local filesystem. An S3-compatible backend (for multi-host
 * or serverless deployments) is the natural next implementation.
 */
export interface StorageBackend {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements StorageBackend {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    return join(this.dir, key);
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}

/**
 * S3-compatible backend (AWS S3, MinIO, Cloudflare R2, Supabase Storage, ...).
 * The AWS SDK is imported lazily so local-only deployments never load it.
 */
class S3Storage implements StorageBackend {
  private readonly bucket = requireEnv("CMS_S3_BUCKET");
  private deps?: Promise<{
    client: import("@aws-sdk/client-s3").S3Client;
    sdk: typeof import("@aws-sdk/client-s3");
  }>;

  private load() {
    if (!this.deps) {
      this.deps = (async () => {
        const sdk = await import("@aws-sdk/client-s3");
        const accessKeyId = process.env.CMS_S3_ACCESS_KEY_ID;
        const secretAccessKey = process.env.CMS_S3_SECRET_ACCESS_KEY;
        const client = new sdk.S3Client({
          region: process.env.CMS_S3_REGION ?? "us-east-1",
          endpoint: process.env.CMS_S3_ENDPOINT || undefined,
          forcePathStyle: process.env.CMS_S3_FORCE_PATH_STYLE === "true",
          // Fall back to the default credential chain (e.g. IAM roles) when
          // explicit keys aren't provided.
          credentials:
            accessKeyId && secretAccessKey
              ? { accessKeyId, secretAccessKey }
              : undefined,
        });
        return { client, sdk };
      })();
    }
    return this.deps;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const { client, sdk } = await this.load();
    await client.send(
      new sdk.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const { client, sdk } = await this.load();
    try {
      const res = await client.send(
        new sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const arr = await res.Body!.transformToByteArray();
      return Buffer.from(arr);
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    const { client, sdk } = await this.load();
    await client.send(
      new sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the S3 storage backend`);
  return v;
}

let backend: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (backend) return backend;
  const kind = process.env.CMS_STORAGE_BACKEND ?? "local";
  if (kind === "local") {
    const dir = resolve(process.env.CMS_STORAGE_DIR ?? "./storage");
    backend = new LocalStorage(dir);
    return backend;
  }
  if (kind === "s3") {
    backend = new S3Storage();
    return backend;
  }
  throw new Error(
    `unknown CMS_STORAGE_BACKEND "${kind}" — supported: "local", "s3"`,
  );
}

/** Test seam: override the backend (used by tests). */
export function setStorage(b: StorageBackend): void {
  backend = b;
}
