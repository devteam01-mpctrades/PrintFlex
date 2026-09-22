import { describe, expect, it } from "vitest";
import { mapOrderNode } from "./order-mapper.server";
import type { OrderNode } from "./order-query.server";

const node: OrderNode = {
  id: "gid://shopify/Order/1",
  name: "#KS-10234",
  createdAt: "2026-09-20T08:00:00Z",
  updatedAt: "2026-09-21T09:30:00Z",
  cancelledAt: null,
  displayFulfillmentStatus: "UNFULFILLED",
  displayFinancialStatus: "PAID",
  tags: [" express ", "", "b2b"],
  email: "order@example.com",
  currentSubtotalLineItemsQuantity: 3,
  currentTotalPriceSet: { presentmentMoney: { amount: "64.90", currencyCode: "EUR" } },
  customer: { displayName: "Marie Dupont", email: "marie@example.com" },
  shippingAddress: { name: "M. Dupont", countryCodeV2: "FR" },
  shippingLine: { title: "Colissimo" },
};

describe("mapOrderNode", () => {
  it("keeps only the indexed fields and normalises blanks", () => {
    const snapshot = mapOrderNode(node);
    expect(snapshot).toEqual({
      shopifyOrderId: "gid://shopify/Order/1",
      orderName: "#KS-10234",
      customerName: "Marie Dupont",
      customerEmail: "marie@example.com",
      countryCode: "FR",
      itemCount: 3,
      totalAmount: "64.90",
      currency: "EUR",
      fulfillmentStatus: "UNFULFILLED",
      financialStatus: "PAID",
      shippingMethod: "Colissimo",
      tags: ["express", "b2b"],
      shopifyCreatedAt: new Date("2026-09-20T08:00:00Z"),
      shopifyUpdatedAt: new Date("2026-09-21T09:30:00Z"),
      cancelledAt: null,
    });
  });

  it("falls back to the shipping name and order email for guest checkouts", () => {
    const guest = mapOrderNode({ ...node, customer: null, shippingLine: null });
    expect(guest.customerName).toBe("M. Dupont");
    expect(guest.customerEmail).toBe("order@example.com");
    expect(guest.shippingMethod).toBeNull();
  });
});
