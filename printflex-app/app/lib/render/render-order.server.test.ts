import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import type { OrderDocumentQueryData } from "./order-document-data.server";
import type { PdfRenderer } from "./pdf.server";
import { renderDocumentForOrder } from "./render-order.server";
import { DEFAULT_TEMPLATE_SETTINGS, saveTemplate } from "../templates/templates.server";
import { readDocument } from "./storage.server";

const money = (amount: string, currencyCode = "USD") => ({ presentmentMoney: { amount, currencyCode } });

function orderData(orderGid: string): OrderDocumentQueryData {
  return {
    shop: { name: "Kool Seoul", contactEmail: "hello@koolseoul.example", billingAddress: { name: null, company: null, address1: "1 Gangnam-daero", address2: null, city: "Seoul", province: null, zip: "06000", country: "South Korea", phone: null } },
    order: {
      id: orderGid, name: "#KS-10236", createdAt: "2026-09-21T02:00:00Z", processedAt: "2026-09-21T02:00:00Z",
      note: null, email: "yuki@example.com", phone: null, taxesIncluded: false,
      displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED",
      customer: { displayName: "Yuki Tanaka" },
      billingAddress: { name: "Yuki Tanaka", company: null, address1: "1-1 Shibuya", address2: null, city: "Tokyo", province: null, zip: "150-0001", country: "Japan", phone: null },
      shippingAddress: null, shippingLine: { title: "K-Packet" },
      currentSubtotalPriceSet: money("112.00"), currentTotalDiscountsSet: money("0.00"), currentShippingPriceSet: money("9.90"),
      currentTotalTaxSet: money("0.00"), currentTotalPriceSet: money("121.90"), taxLines: [],
      lineItems: { nodes: [
        { title: "Ginseng Cream 50ml", variantTitle: null, sku: "PF-001", currentQuantity: 1, originalUnitPriceSet: money("28.00"), discountedTotalSet: money("28.00"), originalTotalSet: money("28.00"), image: null },
        { title: "Sheet Mask Pack ×10", variantTitle: null, sku: "PF-003", currentQuantity: 1, originalUnitPriceSet: money("84.00"), discountedTotalSet: money("84.00"), originalTotalSet: money("84.00"), image: null },
      ] },
    },
  };
}

function fakes() {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  const client: GraphqlClient = {
    async graphql(query, options) {
      calls.push({ query, variables: options?.variables });
      const body = query.includes("tagsAdd")
        ? { data: { tagsAdd: { node: { id: options?.variables?.id }, userErrors: [] } } }
        : { data: orderData(String(options?.variables?.id)) };
      return new Response(JSON.stringify(body));
    },
  };
  let renders = 0;
  const pdf: PdfRenderer = {
    async render(html) {
      renders += 1;
      return Buffer.from(`%PDF-fake\n${html.length}`);
    },
  };
  return { client, pdf, calls, renders: () => renders };
}

async function seed(settingsJson = "{}") {
  const shop = await prisma.shop.create({
    data: { domain: `render-${Math.random().toString(36).slice(2)}.myshopify.com`, timezone: "Asia/Seoul", invoicePrefix: "KS-INV-", settingsJson },
  });
  const order = await prisma.orderIndex.create({
    data: { shopId: shop.id, shopifyOrderId: "gid://shopify/Order/10236", orderName: "#KS-10236", shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() },
  });
  return { shop, order };
}

beforeEach(async () => {
  await prisma.document.deleteMany();
  await prisma.meterEntry.deleteMany();
  await prisma.invoiceNumber.deleteMany();
  await prisma.orderIndex.deleteMany();
  await prisma.template.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("renderDocumentForOrder", () => {
  it("renders, stores, numbers, meters, tags and flips status; a reprint serves the cache", async () => {
    const { shop, order } = await seed();
    const f = fakes();
    const now = new Date("2026-09-22T03:00:00Z");

    const first = await renderDocumentForOrder(shop.id, order.id, "INVOICE", { ...f, now: () => now });
    expect(first.cached).toBe(false);
    expect(first.document.invoiceNumber).toBe("KS-INV-000001");
    expect(first.document.filePath).toBeTruthy();
    expect((await readDocument(first.document.filePath as string))?.toString()).toMatch(/^%PDF/);
    expect(f.renders()).toBe(1);

    // Meter: one unit for this order in the shop's September period.
    const entries = await prisma.meterEntry.findMany({ where: { shopId: shop.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ period: "2026-09", orderId: "gid://shopify/Order/10236" });

    // Tag written with the default name, status flipped.
    const tagCall = f.calls.find((c) => c.query.includes("tagsAdd"));
    expect(tagCall?.variables).toEqual({ id: "gid://shopify/Order/10236", tags: ["printflex-printed"] });
    const indexed = await prisma.orderIndex.findUniqueOrThrow({ where: { id: order.id } });
    expect(indexed.documentStatus).toBe("PRINTED");
    expect(indexed.lastPrintedAt).toEqual(now);

    // Reprint: no new render, no new document, still one meter unit.
    const second = await renderDocumentForOrder(shop.id, order.id, "INVOICE", { ...f, now: () => now });
    expect(second.cached).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(f.renders()).toBe(1);
    expect(await prisma.document.count({ where: { shopId: shop.id } })).toBe(1);
    expect(await prisma.meterEntry.count({ where: { shopId: shop.id } })).toBe(1);
  });

  it("uses the shop's renamed printed tag", async () => {
    const { shop, order } = await seed(JSON.stringify({ tagNames: { printed: "done-printing" } }));
    const f = fakes();
    await renderDocumentForOrder(shop.id, order.id, "INVOICE", f);
    const tagCall = f.calls.find((c) => c.query.includes("tagsAdd"));
    expect(tagCall?.variables).toMatchObject({ tags: ["done-printing"] });
  });

  it("re-renders when the template version changes but keeps the invoice number", async () => {
    const { shop, order } = await seed();
    const f = fakes();
    const first = await renderDocumentForOrder(shop.id, order.id, "INVOICE", f);
    await prisma.template.updateMany({ where: { shopId: shop.id }, data: { version: 2 } });

    const second = await renderDocumentForOrder(shop.id, order.id, "INVOICE", f);
    expect(second.cached).toBe(false);
    expect(second.document.id).not.toBe(first.document.id);
    expect(second.document.invoiceNumber).toBe("KS-INV-000001");
    expect(f.renders()).toBe(2);
    // The number lives on the newest document only, so the per-shop unique constraint holds.
    expect((await prisma.document.findUniqueOrThrow({ where: { id: first.document.id } })).invoiceNumber).toBeNull();
  });

  it("invalidates the cache for the edited template only", async () => {
    const { shop, order } = await seed();
    const f = fakes();
    const invoice = await renderDocumentForOrder(shop.id, order.id, "INVOICE", f);
    const slip = await renderDocumentForOrder(shop.id, order.id, "PACKING_SLIP", f);
    expect(f.renders()).toBe(2);

    const slipTemplate = await prisma.template.findFirstOrThrow({ where: { shopId: shop.id, documentType: "PACKING_SLIP" } });
    await saveTemplate(shop.id, slipTemplate.id, {
      settings: { ...DEFAULT_TEMPLATE_SETTINGS, footerText: "Edited" },
      rule: { countries: [], tags: [] },
    });

    const invoiceAgain = await renderDocumentForOrder(shop.id, order.id, "INVOICE", f);
    const slipAgain = await renderDocumentForOrder(shop.id, order.id, "PACKING_SLIP", f);
    expect(invoiceAgain.cached).toBe(true);
    expect(invoiceAgain.document.id).toBe(invoice.document.id);
    expect(slipAgain.cached).toBe(false);
    expect(slipAgain.document.id).not.toBe(slip.document.id);
    expect(f.renders()).toBe(3);
  });

  it("meters nothing and stores nothing when the render fails", async () => {
    const { shop, order } = await seed();
    const f = fakes();
    const broken: PdfRenderer = { render: async () => { throw new Error("Chrome crashed"); } };
    await expect(renderDocumentForOrder(shop.id, order.id, "INVOICE", { client: f.client, pdf: broken })).rejects.toThrow("Chrome crashed");
    expect(await prisma.document.count()).toBe(0);
    expect(await prisma.meterEntry.count()).toBe(0);
    expect((await prisma.orderIndex.findUniqueOrThrow({ where: { id: order.id } })).documentStatus).toBe("NEW");
    // The invoice number allocated before the failure stays with the order: no gap on retry.
    const retry = await renderDocumentForOrder(shop.id, order.id, "INVOICE", f);
    expect(retry.document.invoiceNumber).toBe("KS-INV-000001");
  });
});
