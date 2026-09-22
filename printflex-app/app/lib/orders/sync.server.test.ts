import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { DEFAULT_TAG_NAMES } from "../settings.server";
import type { OrderSnapshot } from "./order-mapper.server";
import { applyOrderSnapshot, initialStatusFromTags } from "./sync.server";

function snapshot(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    shopifyOrderId: "gid://shopify/Order/42",
    orderName: "#1042",
    customerName: "Yuki Tanaka",
    customerEmail: "yuki@example.com",
    countryCode: "JP",
    shippingCity: "Tokyo",
    itemCount: 5,
    totalAmount: "112.00",
    currency: "USD",
    fulfillmentStatus: "UNFULFILLED",
    financialStatus: "PAID",
    shippingMethod: "K-Packet",
    tags: [],
    shopifyCreatedAt: new Date("2026-09-20T00:00:00Z"),
    shopifyUpdatedAt: new Date("2026-09-20T00:00:00Z"),
    cancelledAt: null,
    lineItems: [
      {
        shopifyLineItemId: "gid://shopify/LineItem/1",
        title: "Snail Essence",
        variantTitle: null,
        sku: "PF-002",
        barcode: null,
        quantity: 5,
        variantId: null,
        productId: null,
        imageUrl: null,
        position: 0,
      },
    ],
    ...overrides,
  };
}

async function createShop() {
  return prisma.shop.create({
    data: { domain: `sync-${Math.random().toString(36).slice(2)}.myshopify.com` },
  });
}

beforeEach(async () => {
  await prisma.orderIndex.deleteMany();
  await prisma.shop.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("applyOrderSnapshot", () => {
  it("never lets an older payload overwrite a newer one", async () => {
    const shop = await createShop();
    const newer = snapshot({
      fulfillmentStatus: "FULFILLED",
      shopifyUpdatedAt: new Date("2026-09-21T12:00:00Z"),
    });
    const older = snapshot({
      fulfillmentStatus: "UNFULFILLED",
      shopifyUpdatedAt: new Date("2026-09-21T11:00:00Z"),
    });

    expect(await applyOrderSnapshot(shop.id, newer, DEFAULT_TAG_NAMES)).toBe("created");
    expect(await applyOrderSnapshot(shop.id, older, DEFAULT_TAG_NAMES)).toBe("stale");

    const row = await prisma.orderIndex.findUniqueOrThrow({
      where: { shopId_shopifyOrderId: { shopId: shop.id, shopifyOrderId: newer.shopifyOrderId } },
    });
    expect(row.fulfillmentStatus).toBe("FULFILLED");
    expect(row.shopifyUpdatedAt).toEqual(newer.shopifyUpdatedAt);
  });

  it("applies a newer payload and keeps the app-owned document status", async () => {
    const shop = await createShop();
    await applyOrderSnapshot(shop.id, snapshot(), DEFAULT_TAG_NAMES);
    await prisma.orderIndex.updateMany({
      where: { shopId: shop.id },
      data: { documentStatus: "PRINTED" },
    });

    const outcome = await applyOrderSnapshot(
      shop.id,
      snapshot({ itemCount: 6, shopifyUpdatedAt: new Date("2026-09-22T00:00:00Z") }),
      DEFAULT_TAG_NAMES,
    );

    expect(outcome).toBe("updated");
    const row = await prisma.orderIndex.findFirstOrThrow({ where: { shopId: shop.id } });
    expect(row.itemCount).toBe(6);
    expect(row.documentStatus).toBe("PRINTED");
  });

  it("derives a new row's status from the shop's configured tag names", async () => {
    const custom = { printed: "done-printing", packed: "boxed", needsReview: "check-me" };
    expect(initialStatusFromTags(["boxed"], custom)).toBe("PACKED");
    expect(initialStatusFromTags(["done-printing"], custom)).toBe("PRINTED");
    expect(initialStatusFromTags(["boxed", "check-me"], custom)).toBe("NEEDS_REVIEW");
    expect(initialStatusFromTags(["printflex-packed"], custom)).toBe("NEW");
    expect(initialStatusFromTags([], DEFAULT_TAG_NAMES)).toBe("NEW");

    const shop = await createShop();
    await applyOrderSnapshot(
      shop.id,
      snapshot({ tags: ["express", "printflex-packed"] }),
      DEFAULT_TAG_NAMES,
    );
    const row = await prisma.orderIndex.findFirstOrThrow({ where: { shopId: shop.id } });
    expect(row.documentStatus).toBe("PACKED");
  });
});
