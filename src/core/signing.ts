import {
  sign as cryptoSign,
  verify as cryptoVerify,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";

/**
 * Marketplace package signing (ed25519). A registry signs each item's canonical
 * metadata with its private key; installers verify against the registry's public
 * key before enabling code. Keys are base64-encoded PEM in env so they fit on a
 * single line:
 *   CMS_REGISTRY_PRIVATE_KEY  — signing (publishers)
 *   CMS_REGISTRY_PUBLIC_KEY   — verifying (installers)
 *
 * Pure (no DB); generate a keypair with `npm run marketplace:keygen`.
 */

export interface SignableItem {
  kind: string;
  name: string;
  specifier: string;
  version?: string | null;
}

function privateKey() {
  const b = process.env.CMS_REGISTRY_PRIVATE_KEY;
  return b ? createPrivateKey(Buffer.from(b, "base64").toString("utf8")) : null;
}
function publicKey() {
  const b = process.env.CMS_REGISTRY_PUBLIC_KEY;
  return b ? createPublicKey(Buffer.from(b, "base64").toString("utf8")) : null;
}

export function signingEnabled(): boolean {
  return !!process.env.CMS_REGISTRY_PRIVATE_KEY;
}
export function verificationEnabled(): boolean {
  return !!process.env.CMS_REGISTRY_PUBLIC_KEY;
}

/** Stable string identifying an item for signing. */
export function canonicalFor(item: SignableItem): string {
  return [item.kind, item.name, item.specifier, item.version ?? ""].join("\n");
}

/** Sign an item; returns base64 signature, or null if no private key is set. */
export function signItem(item: SignableItem): string | null {
  const key = privateKey();
  if (!key) return null;
  return cryptoSign(null, Buffer.from(canonicalFor(item)), key).toString("base64");
}

/** Verify an item's signature against the public key. False if unset/invalid. */
export function verifyItem(item: SignableItem, signature: string | null | undefined): boolean {
  const key = publicKey();
  if (!key || !signature) return false;
  try {
    return cryptoVerify(null, Buffer.from(canonicalFor(item)), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
