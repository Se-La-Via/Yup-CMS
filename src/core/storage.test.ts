import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Point the local backend at a throwaway dir before it is first constructed.
process.env.CMS_STORAGE_DIR = join(tmpdir(), "yup-storage-test-" + randomUUID());
const { getStorage } = await import("./storage.js");

test("local storage put/get/delete round-trip", async () => {
  const s = getStorage();
  const key = randomUUID();
  await s.put(key, Buffer.from("hello yup"));
  const got = await s.get(key);
  assert.ok(got);
  assert.equal(got!.toString(), "hello yup");
  await s.delete(key);
  assert.equal(await s.get(key), null);
});

test("get returns null for a missing key", async () => {
  assert.equal(await getStorage().get("does-not-exist"), null);
});

test("delete is idempotent on a missing key", async () => {
  await assert.doesNotReject(() => getStorage().delete("nope"));
});
