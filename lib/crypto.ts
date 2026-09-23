import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM envelope encryption. Each value gets its own random data key, which is
// wrapped with the master key from ENCRYPTION_KEY. Unique IVs per value; nothing is logged.
// Format: v1.<wrapIv>.<wrapTag>.<wrappedKey>.<iv>.<tag>.<ciphertext>  (base64url parts)

const VERSION = "v1";

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

function seal(key: Buffer, plain: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return { iv, tag: c.getAuthTag(), data };
}

function open(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer) {
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]);
}

const b = (x: Buffer) => x.toString("base64url");
const u = (x: string) => Buffer.from(x, "base64url");

export function encrypt(plain: string): string {
  const dataKey = randomBytes(32);
  const wrapped = seal(masterKey(), dataKey);
  const body = seal(dataKey, Buffer.from(plain, "utf8"));
  return [VERSION, b(wrapped.iv), b(wrapped.tag), b(wrapped.data), b(body.iv), b(body.tag), b(body.data)].join(".");
}

export function decrypt(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 7 || parts[0] !== VERSION) throw new Error("Unrecognised ciphertext");
  const [, wIv, wTag, wData, iv, tag, data] = parts;
  const dataKey = open(masterKey(), u(wIv), u(wTag), u(wData));
  return open(dataKey, u(iv), u(tag), u(data)).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T>(token: string): T {
  return JSON.parse(decrypt(token)) as T;
}

export function last4(secret: string): string {
  return secret.slice(-4);
}

export function mask(last: string | null | undefined, prefix = ""): string {
  return `${prefix}••••••••${last ?? ""}`;
}
