import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signItem, verifyItem, signingEnabled, verificationEnabled } from "./signing.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
process.env.CMS_REGISTRY_PRIVATE_KEY = Buffer.from(privateKey).toString("base64");
process.env.CMS_REGISTRY_PUBLIC_KEY = Buffer.from(publicKey).toString("base64");

const item = { kind: "plugin", name: "x", specifier: "./x.js", version: "1" };

test("signing and verification are enabled when keys are set", () => {
  assert.equal(signingEnabled(), true);
  assert.equal(verificationEnabled(), true);
});

test("a signed item verifies", () => {
  const sig = signItem(item);
  assert.ok(sig);
  assert.equal(verifyItem(item, sig), true);
});

test("a tampered item fails verification", () => {
  const sig = signItem(item);
  assert.equal(verifyItem({ ...item, specifier: "./evil.js" }, sig), false);
});

test("missing or garbage signatures fail", () => {
  assert.equal(verifyItem(item, null), false);
  assert.equal(verifyItem(item, "not-a-signature"), false);
});
