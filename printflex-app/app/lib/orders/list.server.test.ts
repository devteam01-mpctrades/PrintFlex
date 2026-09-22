import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { DEFAULT_TAG_NAMES } from "../settings.server";
import type { OrderSnapshot } from "./order-mapper.server";
import { filterQueryString, listOrders, parseFilters, parseSelectionSpec, resolveSelection } from "./list.server";
import { applyOrderSnapshot } from "./sync.server";

function snapshot(n: number, overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    shopifyOrderId: `gid://shopify/Order/${n}`,
    orderName: `#${1000 + n}`,
    customerName: `Customer ${n}`,
    customerEmail: `customer${n}@example.com`,
    countryCode: "US",
    shippingCity: "Austin",
    itemCount: 1,
    totalAmount: "10.00",
    currency: "USD",
    fulfillmentStatus: "UNFULFILLED",
    financialStatus: "PAID",
    shippingMethod: "Standard Shipping",
    tags: [],
    shopifyCreatedAt: new Date(Date.UTC(2026, 8, 1 + (n % 20), 12)),
    shopifyUpdatedAt: new Date("2026-09-21T00:00:00Z"),
    cancelledAt: null,
    lineItems: [],
    ...overrides,
  };
}

async function seedShop() {
  const shop = await prisma.shop.create({
    data: { domain: `list-${Math.random().toString(36).slice(2)}.myshopify.com`, timezone: "Asia/Seoul" },
  });
  await applyOrderSnapshot(shop.id, snapshot(1, { countryCode: "FR", tags: ["express"], customerName: "Marie Dupont" }), DEFAULT_TAG_NAMES);
  await applyOrderSnapshot(shop.id, snapshot(2, { countryCode: "JP", fulfillmentStatus: "FULFILLED", tags: ["printflex-printed"] }), DEFAULT_TAG_NAMES);
  await applyOrderSnapshot(
    shop.id,
    snapshot(3, {
      countryCode: "DE",
      shippingMethod: "DHL Express",
      lineItems: [{ shopifyLineItemId: "li-3", title: "Snail Essence", variantTitle: null, sku: "PF-002", barcode: null, quantity: 1, variantId: null, productId: null, imageUrl: null, position: 0 }],
    }),
    DEFAULT_TAG_NAMES,
  );
  await applyOrderSnapshot(shop.id, snapshot(4, { tags: ["printflex-packed"] }), DEFAULT_TAG_NAMES);
  return shop;
}

beforeEach(async () => {
  await prisma.orderIndex.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("parseFilters", () => {
  it("reads every filter from the URL and round-trips it", () => {
    const params = new URLSearchParams(
      "q=%23KS-1&fulfillment=unfulfilled&docStatus=NEW&country=fr&shipping=DHL+Express&tag=express&from=2026-09-01&to=2026-09-30&page=2",
    );
    const filters = parseFilters(params);
    expect(filters).toEqual({
      q: "#KS-1", fulfillment: "UNFULFILLED", docStatus: "NEW", country: "FR", shipping: "DHL Express",
      tag: "express", from: "2026-09-01", to: "2026-09-30", page: 2,
    });
    expect(filterQueryString(filters)).not.toContain("page");
    expect(parseFilters(new URLSearchParams(filterQueryString(filters)))).toEqual({ ...filters, page: 1 });
  });

  it("ignores garbage", () => {
    const filters = parseFilters(new URLSearchParams("docStatus=BOGUS&from=yesterday&page=-4"));
    expect(filters.docStatus).toBe("");
    expect(filters.from).toBe("");
    expect(filters.page).toBe(1);
  });
});

describe("listOrders", () => {
  it("combines filters", async () => {
    const shop = await seedShop();
    const all = await listOrders(shop.id, parseFilters(new URLSearchParams()), shop.timezone);
    expect(all.total).toBe(4);
    expect(all.alreadyPrintedTotal).toBe(2);

    const unfulfilledFr = await listOrders(
      shop.id,
      parseFilters(new URLSearchParams("fulfillment=UNFULFILLED&country=FR")),
      shop.timezone,
    );
    expect(unfulfilledFr.rows.map((r) => r.orderName)).toEqual(["#1001"]);

    const tagged = await listOrders(shop.id, parseFilters(new URLSearchParams("tag=express")), shop.timezone);
    expect(tagged.total).toBe(1);

    const packed = await listOrders(shop.id, parseFilters(new URLSearchParams("docStatus=PACKED")), shop.timezone);
    expect(packed.rows[0]?.orderName).toBe("#1004");
  });

  it("searches by order number, customer, email and SKU, and jumps on an exact order number", async () => {
    const shop = await seedShop();
    const byName = await listOrders(shop.id, parseFilters(new URLSearchParams("q=1002")), shop.timezone);
    expect(byName.rows.map((r) => r.orderName)).toEqual(["#1002"]);
    expect(byName.jumpToId).toBe(byName.rows[0].id);

    const scanned = await listOrders(shop.id, parseFilters(new URLSearchParams("q=%231003")), shop.timezone);
    expect(scanned.jumpToId).not.toBeNull();

    const byCustomer = await listOrders(shop.id, parseFilters(new URLSearchParams("q=dupont")), shop.timezone);
    expect(byCustomer.rows.map((r) => r.orderName)).toEqual(["#1001"]);

    const byEmail = await listOrders(shop.id, parseFilters(new URLSearchParams("q=customer3@")), shop.timezone);
    expect(byEmail.rows.map((r) => r.orderName)).toEqual(["#1003"]);

    const bySku = await listOrders(shop.id, parseFilters(new URLSearchParams("q=PF-002")), shop.timezone);
    expect(bySku.rows.map((r) => r.orderName)).toEqual(["#1003"]);
    expect(bySku.jumpToId).toBeNull();
  });

  it("applies the date range in the shop's timezone", async () => {
    const shop = await seedShop();
    // Order 1 was created 2026-09-02 12:00 UTC = 21:00 KST on 2 Sep.
    const onDay = await listOrders(shop.id, parseFilters(new URLSearchParams("from=2026-09-02&to=2026-09-02")), shop.timezone);
    expect(onDay.rows.map((r) => r.orderName)).toEqual(["#1001"]);
    const dayAfter = await listOrders(shop.id, parseFilters(new URLSearchParams("from=2026-09-03&to=2026-09-03")), shop.timezone);
    expect(dayAfter.rows.map((r) => r.orderName)).toEqual(["#1002"]);
  });
});

describe("resolveSelection", () => {
  it("resolves explicit ids and filter selections with exclusions", async () => {
    const shop = await seedShop();
    const all = await listOrders(shop.id, parseFilters(new URLSearchParams()), shop.timezone);
    const ids = all.rows.map((r) => r.id);

    const explicit = await resolveSelection(shop.id, parseSelectionSpec(JSON.stringify({ mode: "ids", ids: ids.slice(0, 2) })), shop.timezone);
    expect(explicit.orders).toHaveLength(2);

    const filtered = await resolveSelection(
      shop.id,
      parseSelectionSpec(JSON.stringify({ mode: "filter", query: "", excludeIds: [ids[0]], excludePrinted: true })),
      shop.timezone,
    );
    expect(filtered.orders.every((o) => o.documentStatus === "NEW")).toBe(true);
    expect(filtered.orders.map((o) => o.id)).not.toContain(ids[0]);
    expect(filtered.truncated).toBe(false);
  });

  it("never resolves another shop's orders", async () => {
    const shop = await seedShop();
    const other = await prisma.shop.create({ data: { domain: "other.myshopify.com" } });
    const all = await listOrders(shop.id, parseFilters(new URLSearchParams()), shop.timezone);
    const leaked = await resolveSelection(other.id, { mode: "ids", ids: all.rows.map((r) => r.id) }, "UTC");
    expect(leaked.orders).toHaveLength(0);
  });
});
