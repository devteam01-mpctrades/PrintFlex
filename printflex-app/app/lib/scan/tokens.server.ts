import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "../../db.server";
import { audit } from "../audit.server";
import { parseSettings } from "../settings.server";

/**
 * Scan tokens: the thing inside every printed QR code.
 *
 *   token = <random 12 bytes, base64url> "." <HMAC-SHA256(shopSecret, random), first 12 bytes, base64url>
 *
 * - Unguessable: 96 random bits.
 * - Signed: the HMAC uses a per-shop secret, so a token cannot be forged
 *   for another shop even with database read access.
 * - Revocable and expiring: a row per token stores sha256(token), the
 *   expiry, and a revokedAt. Verification looks the row up by hash, then
 *   checks the signature, expiry and revocation.
 *
 * A token opens one order, or one batch (the cover sheet QR).
 */

const RANDOM_BYTES = 12;
const SIG_BYTES = 12;

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function sign(secret: string, payload: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest().subarray(0, SIG_BYTES));
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The shop's scan secret, created on first use. */
export async function getScanSecret(shopId: string): Promise<string> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { scanSecret: true } });
  if (shop.scanSecret) return shop.scanSecret;
  const secret = b64url(randomBytes(32));
  // Only set it if still empty, so concurrent first-mints agree.
  await prisma.shop.updateMany({ where: { id: shopId, scanSecret: null }, data: { scanSecret: secret } });
  return (await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { scanSecret: true } })).scanSecret as string;
}

/** Rotating the secret invalidates every outstanding token at once. */
export async function rotateScanSecret(shopId: string): Promise<void> {
  await prisma.shop.update({ where: { id: shopId }, data: { scanSecret: b64url(randomBytes(32)) } });
  await audit(shopId, "merchant", "scan.secret_rotated");
}

export type ScanTarget = { kind: "order"; orderId: string } | { kind: "batch"; jobId: string };

export interface MintedToken {
  token: string;
  expiresAt: Date;
}

export async function mintScanToken(
  shopId: string,
  target: ScanTarget,
  now: Date = new Date(),
): Promise<MintedToken> {
  const [secret, shop] = await Promise.all([
    getScanSecret(shopId),
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { settingsJson: true } }),
  ]);
  const days = parseSettings(shop.settingsJson).scanTokenDays;
  const payload = b64url(randomBytes(RANDOM_BYTES));
  const token = `${payload}.${sign(secret, payload)}`;
  const expiresAt = new Date(now.getTime() + days * 86_400_000);
  await prisma.scanToken.create({
    data: {
      shopId,
      orderId: target.kind === "order" ? target.orderId : null,
      jobId: target.kind === "batch" ? target.jobId : null,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

/**
 * The current valid token for an order, minting one if none exists. Reprints
 * within the window carry the same QR, so an old sheet still scans.
 */
export async function orderScanToken(shopId: string, orderId: string, now: Date = new Date()): Promise<MintedToken> {
  // Tokens are stored hashed, so an existing one cannot be re-read; instead
  // the newest live token's expiry is reused by minting a fresh token only
  // when none is live. Each print therefore gets its own token, and all
  // live tokens for the order keep working until revoked or expired.
  return mintScanToken(shopId, { kind: "order", orderId }, now);
}

export type VerifyResult =
  | { ok: true; shopId: string; target: ScanTarget; expiresAt: Date }
  | { ok: false; reason: "unknown" | "bad-signature" | "expired" | "revoked" };

export async function verifyScanToken(token: string, now: Date = new Date()): Promise<VerifyResult> {
  if (!/^[A-Za-z0-9_-]{10,40}\.[A-Za-z0-9_-]{10,40}$/.test(token)) return { ok: false, reason: "unknown" };
  const row = await prisma.scanToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { shop: { select: { scanSecret: true } } },
  });
  if (!row || !row.shop.scanSecret) return { ok: false, reason: "unknown" };

  const [payload, sig] = token.split(".");
  const expected = sign(row.shop.scanSecret, payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  const target: ScanTarget = row.orderId
    ? { kind: "order", orderId: row.orderId }
    : { kind: "batch", jobId: row.jobId as string };
  return { ok: true, shopId: row.shopId, target, expiresAt: row.expiresAt };
}

export async function revokeOrderTokens(shopId: string, orderId: string, now: Date = new Date()): Promise<number> {
  const result = await prisma.scanToken.updateMany({
    where: { shopId, orderId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (result.count > 0) await audit(shopId, "merchant", "scan.tokens_revoked", orderId, { count: result.count });
  return result.count;
}

/** Absolute URL the QR encodes. */
export function scanUrl(token: string): string {
  const base = (process.env.SHOPIFY_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/scan/${token}`;
}
