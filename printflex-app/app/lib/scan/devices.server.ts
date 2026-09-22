import { createHash, randomBytes } from "node:crypto";
import { createCookie } from "react-router";
import prisma from "../../db.server";
import { pinAttemptAllowed, resetPinAttempts, verifyPinHash } from "./pin.server";

/**
 * Device sessions for scan mode. One cookie per browser, HttpOnly, 180 days.
 * A session is valid while the device is not revoked and its pinVersion
 * matches the shop's current one.
 */

export const deviceCookie = createCookie("pf_device", {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/scan",
  maxAge: 180 * 24 * 3600,
});

function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface DeviceSession {
  deviceId: string;
  shopId: string;
  name: string;
  staffLabel: string | null;
}

async function readCookie(request: Request): Promise<string | null> {
  const value: unknown = await deviceCookie.parse(request.headers.get("Cookie"));
  return typeof value === "string" ? value : null;
}

/** The signed-in device for this request, if its session is still valid. */
export async function getDeviceSession(request: Request, now: Date = new Date()): Promise<DeviceSession | null> {
  const raw = await readCookie(request);
  if (!raw) return null;
  const [deviceId, secret] = raw.split(".");
  if (!deviceId || !secret) return null;
  const device = await prisma.scanDevice.findUnique({
    where: { id: deviceId },
    include: { shop: { select: { pinVersion: true } } },
  });
  if (!device || device.revokedAt || device.secretHash !== hash(secret) || device.pinVersion !== device.shop.pinVersion) {
    return null;
  }
  if (now.getTime() - device.lastSeenAt.getTime() > 60_000) {
    await prisma.scanDevice.update({ where: { id: deviceId }, data: { lastSeenAt: now } });
  }
  return { deviceId: device.id, shopId: device.shopId, name: device.name, staffLabel: device.staffLabel };
}

export type SignInResult =
  | { ok: true; setCookie: string; session: DeviceSession }
  | { ok: false; reason: "no-pin" | "throttled" | "wrong-pin" | "name" };

/** Exchange PIN + device name for a device session cookie. */
export async function signInDevice(
  shopId: string,
  pin: string,
  deviceName: string,
  clientKey: string,
  now: Date = new Date(),
  staffLabel: string | null = null,
): Promise<SignInResult> {
  const name = deviceName.trim().slice(0, 40);
  const staff = staffLabel?.trim().slice(0, 40) || null;
  if (!name) return { ok: false, reason: "name" };
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { pinHash: true, pinVersion: true } });
  if (!shop.pinHash) return { ok: false, reason: "no-pin" };
  if (!pinAttemptAllowed(`${shopId}:${clientKey}`)) return { ok: false, reason: "throttled" };
  if (!(await verifyPinHash(pin, shop.pinHash))) return { ok: false, reason: "wrong-pin" };
  resetPinAttempts(`${shopId}:${clientKey}`);

  const secret = randomBytes(24).toString("base64url");
  const device = await prisma.scanDevice.create({
    data: { shopId, name, staffLabel: staff, secretHash: hash(secret), pinVersion: shop.pinVersion, lastSeenAt: now },
  });
  return {
    ok: true,
    setCookie: await deviceCookie.serialize(`${device.id}.${secret}`),
    session: { deviceId: device.id, shopId, name, staffLabel: staff },
  };
}

export async function signOutCookie(): Promise<string> {
  return deviceCookie.serialize("", { maxAge: 0 });
}

export async function listDevices(shopId: string) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { pinVersion: true } });
  const devices = await prisma.scanDevice.findMany({ where: { shopId, revokedAt: null }, orderBy: { lastSeenAt: "desc" } });
  return devices.map((d) => ({ id: d.id, name: d.name, staffLabel: d.staffLabel, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt, stale: d.pinVersion !== shop.pinVersion }));
}

export async function revokeDevice(shopId: string, deviceId: string, now: Date = new Date()): Promise<boolean> {
  const result = await prisma.scanDevice.updateMany({ where: { id: deviceId, shopId, revokedAt: null }, data: { revokedAt: now } });
  return result.count > 0;
}

/** A stable-enough key for PIN throttling: forwarded IP or the connection's. */
export function clientKeyFor(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("cf-connecting-ip") || "unknown";
}
