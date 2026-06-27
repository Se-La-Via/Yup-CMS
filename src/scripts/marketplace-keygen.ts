/**
 * Generate an ed25519 keypair for signing marketplace items. Put the private
 * key on the publishing registry and the public key on installers.
 *
 *   npm run marketplace:keygen
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

console.log("# Add to the registry/publisher .env:");
console.log("CMS_REGISTRY_PRIVATE_KEY=" + Buffer.from(privateKey).toString("base64"));
console.log("\n# Add to installers' .env to require verified packages:");
console.log("CMS_REGISTRY_PUBLIC_KEY=" + Buffer.from(publicKey).toString("base64"));
