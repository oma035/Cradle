// Encrypts users' Stellar secret keys at rest with AES-256-GCM.
import crypto from "node:crypto";

function key(masterKeyHex) {
  const k = Buffer.from(masterKeyHex || "", "hex");
  if (k.length !== 32) throw new Error("MASTER_KEY must be 32 bytes (64 hex characters)");
  return k;
}

export function encryptSecret(plain, masterKeyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(masterKeyHex), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(blob, masterKeyHex) {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(masterKeyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison for passwords and tokens. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
