import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { flagOrder, loadPackSheet, packOrder } from "./pack.server";

function fakeClient() {
  const calls: Array<{ kind: "tags" | "metafields"; variables: Record<string, unknown> | undefined }> = [];
  const client: GraphqlClient = {
    async graphql(query, options) {
      const kind = query.includes("tagsAdd") ? "tags" : "metafields";
      calls.push({ kind, variables: options?.variables });
      const body = kind === "tags"
        ? { data: { tagsAdd: { node: { id: "x" }, userErrors: [] } } }
        : { data: { metafieldsSet: { metafields: [], userErrors: [] } } };
      return new Response(JSON.stringify(body));
    },
  };
  return { client, calls };
}

async function seed() {
  const shop = await prisma.shop.create({ data: { domain: `pack-${Math.random().toString(36).slice(2)}.myshopify.com` } });
  const order = await prisma.orderIndex.create({
    data: {
      shopId: shop.id, shopifyOrderId: "gid://shopify/Order/77", orderName: "#KS-10277", itemCount: 4, shippingCity: "Tokyo", countryCode: "JP",
      shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date(), documentStatus: "PRINTED",
      lineItems: {
        create: [
          { shopifyLineItemId: "l1", title: "Ginseng Cream", sku: "PF-001", barcode: "880001", quantity: 1, position: 0 },
          { shopifyLineItemId: "l2", title: "Glass Skin Starter Kit", sku: "PF-KIT", quantity: 1, position: 1 },
          { shopifyLineItemId: "l3", title: "Sheet Mask Pack", sku: "PF-003", quantity: 2, position: 2 },
        ],
      },
    },
  });
  await prisma.bundleMap.createMany({
    data: [
      { shopId: shop.id, bundleSku: "PF-KIT", componentSku: "PF-001", quantity: 1 },
      { shopId: shop.id, bundleSku: "PF-KIT", componentSku: "PF-009", componentTitle: "Travel Toner", quantity: 2 },
    ],
  });
  return { shop, order };
}

beforeEach(async () => {
  await prisma.packEvent.deleteMany();
  await prisma.bundleMap.deleteMany();
  await prisma.orderIndex.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("pack sheet", () => {
  it("expands bundles into components with titles borrowed from known SKUs", async () => {
    const { shop, order } = await seed();
    const sheet = await loadPackSheet(shop.id, order.id);
    expect(sheet?.lines.map((l) => [l.sku, l.quantity, l.partOf])).toEqual([
      ["PF-001", 1, null],
      ["PF-001", 1, "Glass Skin Starter Kit"],
      ["PF-009", 2, "Glass Skin Starter Kit"],
      ["PF-003", 2, null],
    ]);
    expect(sheet?.lines[1].title).toBe("Ginseng Cream"); // borrowed
    expect(sheet?.lines[1].barcode).toBe("880001");
    expect(sheet?.lines[2].title).toBe("Travel Toner");
    expect(sheet?.order.destination).toBe("Tokyo, JP");
    expect(sheet?.settings.strictMode).toBe(false);
  });
});

describe("packOrder", () => {
  it("writes the tag, timestamp, device and item count once, even when packed twice", async () => {
    const { shop, order } = await seed();
    const f = fakeClient();
    const now = new Date("2026-09-22T09:41:00Z");
    const first = await packOrder({ shopId: shop.id, orderId: order.id, deviceName: "Bench 2 · Dara", clientEventId: "evt-1", itemCount: 4, weightGrams: 640, client: f.client, now });
    expect(first).toEqual({ ok: true, already: false });

    expect(f.calls.filter((c) => c.kind === "tags")).toHaveLength(1);
    expect(f.calls[0].variables).toEqual({ id: "gid://shopify/Order/77", tags: ["printflex-packed"] });
    const metafields = f.calls.find((c) => c.kind === "metafields")?.variables?.metafields as Array<{ key: string; value: string; type: string }>;
    expect(metafields.map((m) => m.key)).toEqual(["packed", "parcel_weight_grams"]);
    expect(JSON.parse(metafields[0].value)).toEqual({ at: "2026-09-22T09:41:00.000Z", device: "Bench 2 · Dara", items: 4 });
    expect(metafields[1]).toMatchObject({ type: "number_integer", value: "640" });

    const indexed = await prisma.orderIndex.findUniqueOrThrow({ where: { id: order.id } });
    expect(indexed.documentStatus).toBe("PACKED");
    expect(indexed.lastPackedAt).toEqual(now);

    // Same event retried (offline replay) and a brand new pack of the same order.
    expect(await packOrder({ shopId: shop.id, orderId: order.id, deviceName: "Bench 2 · Dara", clientEventId: "evt-1", itemCount: 4, weightGrams: 640, client: f.client })).toEqual({ ok: true, already: true });
    expect(await packOrder({ shopId: shop.id, orderId: order.id, deviceName: "Bench 1 · Sila", clientEventId: "evt-2", itemCount: 4, weightGrams: null, client: f.client })).toEqual({ ok: true, already: true });
    expect(await prisma.packEvent.count({ where: { orderId: order.id, outcome: "PACKED" } })).toBe(1);
    expect(f.calls.filter((c) => c.kind === "tags")).toHaveLength(1);
  });
});

describe("flagOrder", () => {
  it("moves the order to Needs review, tags it, and never to Packed", async () => {
    const { shop, order } = await seed();
    const f = fakeClient();
    const result = await flagOrder({
      shopId: shop.id, orderId: order.id, deviceName: "Bench 1 · Sila", clientEventId: "flag-1", client: f.client,
      lines: [
        { lineId: "l3", title: "Sheet Mask Pack", outcome: "SHORT_PICK", note: "only 1 on shelf" },
        { lineId: "l1", title: "Ginseng Cream", outcome: "DAMAGED", note: "" },
      ],
    });
    expect(result).toEqual({ ok: true, already: false });
    expect(f.calls[0].variables).toEqual({ id: "gid://shopify/Order/77", tags: ["printflex-needs-review"] });
    const indexed = await prisma.orderIndex.findUniqueOrThrow({ where: { id: order.id } });
    expect(indexed.documentStatus).toBe("NEEDS_REVIEW");
    const events = await prisma.packEvent.findMany({ where: { orderId: order.id }, orderBy: { note: "asc" } });
    expect(events.map((e) => [e.outcome, e.note])).toEqual([
      ["DAMAGED", "Ginseng Cream: damaged"],
      ["SHORT_PICK", "Sheet Mask Pack: missing — only 1 on shelf"],
    ]);
    // Replay is a no-op.
    expect(await flagOrder({ shopId: shop.id, orderId: order.id, deviceName: "x", clientEventId: "flag-1", client: f.client, lines: [{ lineId: "l1", title: "t", outcome: "DAMAGED", note: "" }] })).toEqual({ ok: true, already: true });
    expect(await prisma.packEvent.count({ where: { orderId: order.id } })).toBe(2);
  });
});
