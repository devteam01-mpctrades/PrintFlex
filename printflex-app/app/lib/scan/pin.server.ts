import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import prisma from "../../db.server";
import { audit } from "../audit.server";

const scrypt = promisify(scryptCallback);
const PIN_PATTERN = /^\d{4,8}$/;

/**
 * The store PIN. Stored as scrypt(salt, pin). Setting a new PIN bumps
 * pinVersion, which invalidates every device session at once.
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

export type SetPinResult = { ok: true; pinVersion: number } | { ok: false; reason: "format" };

/** Set or rotate the PIN. Existing device sessions stop working immediately. */
export async function setStorePin(shopId: string, pin: string): Promise<SetPinResult> {
  if (!isValidPin(pin)) return { ok: false, reason: "format" };
  const pinHash = await hashPin(pin);
  const before = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { pinHash: true } });
  const shop = await prisma.shop.update({
    where: { id: shopId },
    data: { pinHash, pinVersion: { increment: 1 } },
    select: { pinVersion: true },
  });
  await audit(shopId, "merchant", before.pinHash ? "pin.rotated" : "pin.set", null, { pinVersion: shop.pinVersion });
  return { ok: true, pinVersion: shop.pinVersion };
}

export async function hasStorePin(shopId: string): Promise<boolean> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { pinHash: true } });
  return Boolean(shop.pinHash);
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
