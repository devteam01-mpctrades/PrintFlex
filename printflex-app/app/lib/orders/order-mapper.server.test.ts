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
  billingAddress: { name: "Marie Dupont" },
  shippingAddress: { name: "M. Dupont", city: "Paris", countryCodeV2: "FR" },
  shippingLine: { title: "Colissimo" },
  lineItems: {
    nodes: [
      {
        id: "gid://shopify/LineItem/11",
        title: "Ginseng Cream 50ml",
        variantTitle: "Default Title",
        sku: " PF-001 ",
        quantity: 2,
        variant: { id: "gid://shopify/ProductVariant/5", barcode: "8801234567890" },
        product: { id: "gid://shopify/Product/7" },
        image: { url: "https://cdn.shopify.com/img.png" },
      },
      {
        id: "gid://shopify/LineItem/12",
        title: "Gift Wrap",
        variantTitle: null,
        sku: "",
        quantity: 1,
        variant: null,
        product: null,
        image: null,
      },
    ],
  },
};

describe("mapOrderNode", () => {
  it("keeps only the indexed fields and normalises blanks", () => {
    const snapshot = mapOrderNode(node);
    expect(snapshot).toEqual({
      shopifyOrderId: "gid://shopify/Order/1",
      orderName: "#KS-10234",
      customerName: "M. Dupont",
      customerEmail: "order@example.com",
      countryCode: "FR",
      shippingCity: "Paris",
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
      lineItems: [
        {
          shopifyLineItemId: "gid://shopify/LineItem/11",
          title: "Ginseng Cream 50ml",
          variantTitle: "Default Title",
          sku: "PF-001",
          barcode: "8801234567890",
          quantity: 2,
          variantId: "gid://shopify/ProductVariant/5",
          productId: "gid://shopify/Product/7",
          imageUrl: "https://cdn.shopify.com/img.png",
          position: 0,
        },
        {
          shopifyLineItemId: "gid://shopify/LineItem/12",
          title: "Gift Wrap",
          variantTitle: null,
          sku: null,
          barcode: null,
          quantity: 1,
          variantId: null,
          productId: null,
          imageUrl: null,
          position: 1,
        },
      ],
    });
  });

  it("falls back to the billing name when there is no shipping address, and never needs Order.customer", () => {
    const pickup = mapOrderNode({ ...node, shippingAddress: null, shippingLine: null });
    expect(pickup.customerName).toBe("Marie Dupont");
    expect(pickup.countryCode).toBeNull();
    expect(pickup.shippingMethod).toBeNull();
    const anonymous = mapOrderNode({ ...node, shippingAddress: null, billingAddress: null, email: "  " });
    expect(anonymous.customerName).toBeNull();
    expect(anonymous.customerEmail).toBeNull();
  });
});
