import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { mintScanToken, revokeOrderTokens, rotateScanSecret, scanUrl, verifyScanToken } from "./tokens.server";

async function seed(settingsJson = "{}") {
  const shop = await prisma.shop.create({ data: { domain: `tok-${Math.random().toString(36).slice(2)}.myshopify.com`, settingsJson } });
  const order = await prisma.orderIndex.create({
    data: { shopId: shop.id, shopifyOrderId: "gid://shopify/Order/1", orderName: "#1", shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() },
  });
  return { shop, order };
}

beforeEach(async () => {
  await prisma.scanToken.deleteMany();
  await prisma.orderIndex.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("scan tokens", () => {
  it("mints a signed token that verifies to its order and expires after the configured window", async () => {
    const { shop, order } = await seed(JSON.stringify({ scanTokenDays: 30 }));
    const now = new Date("2026-09-22T00:00:00Z");
    const { token, expiresAt } = await mintScanToken(shop.id, { kind: "order", orderId: order.id }, now);

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThan(40);
    expect(expiresAt).toEqual(new Date("2026-10-22T00:00:00Z"));
    expect(scanUrl(token)).toMatch(/\/scan\/[A-Za-z0-9_.-]+$/);

    const verified = await verifyScanToken(token, now);
    expect(verified).toEqual({ ok: true, shopId: shop.id, target: { kind: "order", orderId: order.id }, expiresAt });
    expect(await verifyScanToken(token, new Date("2026-10-22T00:00:01Z"))).toEqual({ ok: false, reason: "expired" });
  });

  it("defaults to 90 days", async () => {
    const { shop, order } = await seed();
    const now = new Date("2026-01-01T00:00:00Z");
    const { expiresAt } = await mintScanToken(shop.id, { kind: "order", orderId: order.id }, now);
    expect((expiresAt.getTime() - now.getTime()) / 86_400_000).toBe(90);
  });

  it("rejects unknown, tampered, revoked and rotated tokens with a reason, never a stack trace", async () => {
    const { shop, order } = await seed();
    const { token } = await mintScanToken(shop.id, { kind: "order", orderId: order.id });

    expect(await verifyScanToken("nonsense")).toEqual({ ok: false, reason: "unknown" });
    const [payload, sig] = token.split(".");
    const flipped = sig[0] === "A" ? "B" : "A";
    // A tampered signature has a different hash, so it is unknown before it is checked.
    expect(await verifyScanToken(`${payload}.${flipped}${sig.slice(1)}`)).toEqual({ ok: false, reason: "unknown" });

    expect(await revokeOrderTokens(shop.id, order.id)).toBe(1);
    expect(await verifyScanToken(token)).toEqual({ ok: false, reason: "revoked" });

    const { token: second } = await mintScanToken(shop.id, { kind: "order", orderId: order.id });
    await rotateScanSecret(shop.id);
    expect(await verifyScanToken(second)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("mints batch tokens that resolve to the job", async () => {
    const { shop } = await seed();
    const job = await prisma.documentJob.create({
      data: { shopId: shop.id, documentTypesJson: "[]", orderIdsJson: "[]" },
    });
    const { token } = await mintScanToken(shop.id, { kind: "batch", jobId: job.id });
    const result = await verifyScanToken(token);
    expect(result.ok && result.target).toEqual({ kind: "batch", jobId: job.id });
  });
});
