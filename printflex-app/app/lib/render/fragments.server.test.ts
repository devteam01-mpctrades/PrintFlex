import { describe, expect, it } from "vitest";
import { aggregatePickList, renderPackingSlipFragment, type BinEntry } from "./fragments.server";
import type { OrderDocumentData } from "./order-document-data.server";
import { DEFAULT_TEMPLATE_SETTINGS } from "../templates/templates.server";

const m = (amount: string) => ({ amount, currencyCode: "USD" });
function order(id: string, items: Array<[sku: string | null, title: string, qty: number]>): OrderDocumentData {
  return {
    id, name: `#${id}`, createdAt: "2026-09-21T00:00:00Z", processedAt: "2026-09-21T00:00:00Z", note: null,
    attributes: [{ key: "Gift message", value: "Happy birthday, Léa!" }], email: null, phone: null, customerName: "C", financialStatus: "PAID",
    fulfillmentStatus: "UNFULFILLED", taxesIncluded: false, currency: "USD", billingAddress: null,
    shippingAddress: { name: "C", company: null, address1: "1 St", address2: null, city: "Town", province: null, zip: "1", country: "US", phone: null },
    shippingMethod: "Standard", subtotal: m("0"), totalDiscounts: m("0"), shipping: m("0"), totalTax: m("0"), taxLines: [], total: m("0"),
    seller: { name: "Shop", email: null, address: null },
    lineItems: items.map(([sku, title, qty]) => ({ title, variantTitle: null, sku, quantity: qty, unitPrice: m("1"), lineDiscount: m("0"), lineTotal: m("1"), imageUrl: null })),
  };
}

describe("aggregatePickList", () => {
  it("aggregates across orders and sorts by SKU when there is no bin map", () => {
    const lines = aggregatePickList(
      [order("1", [["PF-002", "Snail", 2], ["PF-001", "Ginseng", 1]]), order("2", [["PF-002", "Snail", 3], [null, "Gift Wrap", 1]])],
      new Map(),
    );
    expect(lines.map((l) => [l.sku, l.quantity, l.orderCount])).toEqual([
      ["PF-001", 1, 1],
      ["PF-002", 5, 2],
      [null, 1, 1],
    ]);
  });

  it("groups and sorts by walking sequence, then bin, with unknown bins last", () => {
    const bins = new Map<string, BinEntry>([
      ["PF-001", { bin: "B-04", sequence: 2 }],
      ["PF-002", { bin: "A-12", sequence: 1 }],
      ["PF-003", { bin: "C-01", sequence: null }],
    ]);
    const lines = aggregatePickList(
      [order("1", [["PF-001", "Ginseng", 1], ["PF-003", "Mask", 2], ["PF-009", "No bin", 1], ["PF-002", "Snail", 4]])],
      bins,
    );
    expect(lines.map((l) => l.sku)).toEqual(["PF-002", "PF-001", "PF-003", "PF-009"]);
    expect(lines[0].bin).toBe("A-12");
    expect(lines[3].bin).toBeNull();
  });
});

describe("packing slip", () => {
  it("shows no prices, but SKUs, bins, the gift message and the shipping method", () => {
    const html = renderPackingSlipFragment({
      order: order("7", [["PF-001", "Ginseng", 2]]),
      settings: { ...DEFAULT_TEMPLATE_SETTINGS, fields: { ...DEFAULT_TEMPLATE_SETTINGS.fields, giftMessage: true } },
      timezone: "UTC",
      bins: new Map([["PF-001", "B-04"]]),
    });
    expect(html).toContain("Packing slip");
    expect(html).toContain("PF-001");
    expect(html).toContain("B-04");
    expect(html).toContain("Happy birthday, Léa!");
    expect(html).toContain("Standard");
    expect(html).not.toContain("$");
    expect(html).not.toContain("Total");
  });
});
