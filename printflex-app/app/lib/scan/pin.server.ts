import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import prisma from "../../db.server";
import { audit } from "../audit.server";

const scrypt = promisify(scryptCallback);
const PIN_PATTERN = /^\d{4,8}$/;

/**
 * The store PIN. Sign-in checks pinHash, scrypt(salt, pin). A second copy is
 * kept AES-256-GCM encrypted (pinEncrypted) so the merchant can see the PIN
 * again in Settings; its key is derived from the app secret, never stored in
 * the database. Setting a different PIN bumps pinVersion, which invalidates
 * every device session at once; re-entering the current PIN does not.
 */

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(pin, salt, 32)) as Buffer;
  return `${salt.toString("base64url")}.${key.toString("base64url")}`;
}

export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const [saltPart, keyPart] = stored.split(".");
  if (!saltPart || !keyPart) return false;
  const key = (await scrypt(pin, Buffer.from(saltPart, "base64url"), 32)) as Buffer;
  const expected = Buffer.from(keyPart, "base64url");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function pinKey(): Buffer {
  const secret = process.env.SHOPIFY_API_SECRET || "printflex-dev-only-secret";
  return Buffer.from(hkdfSync("sha256", secret, "printflex", "store-pin-display-v1", 32));
}

/** "v1.<iv>.<tag>.<ciphertext>", base64url. */
export function encryptPin(pin: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", pinKey(), iv);
  const data = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** The PIN, or null when it cannot be read back (set before display existed, or the app secret changed). */
export function decryptPin(stored: string | null): string | null {
  if (!stored) return null;
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", pinKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const pin = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    return isValidPin(pin) ? pin : null;
  } catch {
    return null;
  }
}

/** unchanged: the PIN matched the current one, so no device was signed out. */
export type SetPinResult = { ok: true; pinVersion: number; unchanged: boolean } | { ok: false; reason: "format" };

/**
 * Set or rotate the PIN. A different PIN signs every device out immediately.
 * Re-entering the current PIN only saves its display copy and keeps devices signed in.
 */
export async function setStorePin(shopId: string, pin: string): Promise<SetPinResult> {
  if (!isValidPin(pin)) return { ok: false, reason: "format" };
  const before = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { pinHash: true, pinVersion: true } });
  if (before.pinHash && (await verifyPinHash(pin, before.pinHash))) {
    await prisma.shop.update({ where: { id: shopId }, data: { pinEncrypted: encryptPin(pin) } });
    await audit(shopId, "merchant", "pin.saved", null, { pinVersion: before.pinVersion });
    return { ok: true, pinVersion: before.pinVersion, unchanged: true };
  }
  const shop = await prisma.shop.update({
    where: { id: shopId },
    data: { pinHash: await hashPin(pin), pinEncrypted: encryptPin(pin), pinVersion: { increment: 1 } },
    select: { pinVersion: true },
  });
  await audit(shopId, "merchant", before.pinHash ? "pin.rotated" : "pin.set", null, { pinVersion: shop.pinVersion });
  return { ok: true, pinVersion: shop.pinVersion, unchanged: false };
}

export async function hasStorePin(shopId: string): Promise<boolean> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { pinHash: true } });
  return Boolean(shop.pinHash);
}

/** For Settings: whether a PIN exists and, when it can be read back, the PIN itself. */
export async function getStorePin(shopId: string): Promise<{ hasPin: boolean; pin: string | null }> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { pinHash: true, pinEncrypted: true } });
  return { hasPin: Boolean(shop.pinHash), pin: shop.pinHash ? decryptPin(shop.pinEncrypted) : null };
}

// Simple in-memory throttle on PIN attempts: 10 per shop per 15 minutes per client.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

export function pinAttemptAllowed(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

export function resetPinAttempts(key: string): void {
  attempts.delete(key);
}
