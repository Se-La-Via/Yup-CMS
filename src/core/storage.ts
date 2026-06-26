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

let backend: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (backend) return backend;
  const kind = process.env.CMS_STORAGE_BACKEND ?? "local";
  if (kind === "local") {
    const dir = resolve(process.env.CMS_STORAGE_DIR ?? "./storage");
    backend = new LocalStorage(dir);
    return backend;
  }
  throw new Error(
    `unknown CMS_STORAGE_BACKEND "${kind}" — only "local" is built in so far`,
  );
}

/** Test seam: override the backend (used by tests). */
export function setStorage(b: StorageBackend): void {
  backend = b;
}
