import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import type { OrderDocumentQueryData } from "../render/order-document-data.server";
import type { PdfRenderer } from "../render/pdf.server";
import { renderDocumentForOrder } from "../render/render-order.server";
import { DEFAULT_TEMPLATE_SETTINGS } from "../templates/templates.server";
import { createDocumentJob } from "./create-job.server";
import { documentsForBatch, latestPerOrderAndType, printTypeFromBatch, reprintDocument } from "./reprint.server";

const money = (amount: string, currencyCode = "USD") => ({ presentmentMoney: { amount, currencyCode } });

function orderData(orderGid: string): OrderDocumentQueryData {
  return {
    shop: { name: "Kool Seoul", contactEmail: "hello@koolseoul.example", billingAddress: { name: null, company: null, address1: "1 Gangnam-daero", address2: null, city: "Seoul", province: null, zip: "06000", country: "South Korea", phone: null } },
    order: {
      id: orderGid, name: "#KS-10236", createdAt: "2026-09-21T02:00:00Z", processedAt: "2026-09-21T02:00:00Z",
      note: null, email: "yuki@example.com", phone: null, taxesIncluded: false,
      displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED",
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

async function template(shopId: string, documentType: string, name: string) {
  const settingsJson = JSON.stringify(DEFAULT_TEMPLATE_SETTINGS);
  const t = await prisma.template.create({ data: { shopId, documentType, name, settingsJson, assignmentRuleJson: "{}", version: 1 } });
  await prisma.templateVersion.create({ data: { templateId: t.id, version: 1, settingsJson, assignmentRuleJson: "{}" } });
  return t;
}

async function seed() {
  const shop = await prisma.shop.create({
    data: { domain: `reprint-${Math.random().toString(36).slice(2)}.myshopify.com`, timezone: "Asia/Seoul", invoicePrefix: "KS-INV-" },
  });
  const order = await prisma.orderIndex.create({
    data: { shopId: shop.id, shopifyOrderId: "gid://shopify/Order/10236", orderName: "#KS-10236", shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() },
  });
  const job = await createDocumentJob({ shopId: shop.id, documentTypes: ["INVOICE", "PACKING_SLIP"], orderIds: [order.id] });
  return { shop, order, job };
}

beforeEach(async () => {
  await prisma.document.deleteMany();
  await prisma.documentJob.deleteMany();
  await prisma.meterEntry.deleteMany();
  await prisma.invoiceNumber.deleteMany();
  await prisma.orderIndex.deleteMany();
  await prisma.template.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("reprintDocument", () => {
  it("re-prints one order with the chosen template: same invoice number, same batch, metered once", async () => {
    const { shop, order, job } = await seed();
    const standard = await template(shop.id, "INVOICE", "Invoice");
    const japan = await template(shop.id, "INVOICE", "Invoice — Japan");
    const f = fakes();
    const first = await renderDocumentForOrder(shop.id, order.id, "INVOICE", f, job.id, { templateId: standard.id });

    const result = await reprintDocument(shop.id, first.document.id, japan.id, f);
    expect(result).toMatchObject({ ok: true, templateName: "Invoice — Japan", orderName: "#KS-10236" });
    if (!result.ok) throw new Error("expected ok");
    const fresh = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } });
    expect(fresh.templateId).toBe(japan.id);
    expect(fresh.jobId).toBe(job.id);
    expect(fresh.invoiceNumber).toBe(first.document.invoiceNumber);
    expect(await prisma.meterEntry.count({ where: { shopId: shop.id } })).toBe(1);
    expect(await prisma.invoiceNumber.count({ where: { shopId: shop.id } })).toBe(1);
  });

  it("refuses another shop's template and a template for a different document type", async () => {
    const { shop, order, job } = await seed();
    const mine = await template(shop.id, "INVOICE", "Invoice");
    const slip = await template(shop.id, "PACKING_SLIP", "Packing slip");
    const other = await prisma.shop.create({ data: { domain: `other-${Math.random().toString(36).slice(2)}.myshopify.com` } });
    const theirs = await template(other.id, "INVOICE", "Theirs");
    const f = fakes();
    const first = await renderDocumentForOrder(shop.id, order.id, "INVOICE", f, job.id, { templateId: mine.id });

    for (const id of [theirs.id, slip.id]) {
      const r = await reprintDocument(shop.id, first.document.id, id, f);
      expect(r.ok).toBe(false);
    }
    expect(await prisma.document.count({ where: { shopId: shop.id } })).toBe(1);
    // Another shop cannot touch this document at all.
    expect((await reprintDocument(other.id, first.document.id, theirs.id, f)).ok).toBe(false);
  });
});

describe("printTypeFromBatch", () => {
  it("makes a new batch with one document type for the same orders", async () => {
    const { shop, order, job } = await seed();
    const r = await printTypeFromBatch(shop.id, job.id, "INVOICE");
    expect(r).toMatchObject({ ok: true, count: 1 });
    if (!r.ok) throw new Error("expected ok");
    const created = await prisma.documentJob.findUniqueOrThrow({ where: { id: r.jobId } });
    expect(JSON.parse(created.documentTypesJson)).toEqual(["INVOICE"]);
    expect(JSON.parse(created.orderIdsJson)).toEqual([order.id]);
    expect(created.name).toContain("Invoices from");
    expect((await printTypeFromBatch(shop.id, job.id, "PICK_LIST")).ok).toBe(false);
  });
});

describe("documentsForBatch", () => {
  it("lists a reprinted order's documents even though an earlier batch produced them", async () => {
    const { shop, order, job } = await seed();
    const invoice = await template(shop.id, "INVOICE", "Invoice");
    const slip = await template(shop.id, "PACKING_SLIP", "Packing slip");
    const f = fakes();
    await renderDocumentForOrder(shop.id, order.id, "INVOICE", f, job.id, { templateId: invoice.id });
    await renderDocumentForOrder(shop.id, order.id, "PACKING_SLIP", f, job.id, { templateId: slip.id });

    // A second batch for the same order: the renderer reuses the cached documents, so none carry its jobId.
    const again = await createDocumentJob({ shopId: shop.id, documentTypes: ["INVOICE", "PACKING_SLIP", "PICK_LIST"], orderIds: [order.id] });
    expect(await prisma.document.count({ where: { jobId: again.id } })).toBe(0);

    const listed = await documentsForBatch(shop.id, again);
    expect(listed.map((d) => d.documentType)).toEqual(["INVOICE", "PACKING_SLIP"]);
    expect(listed.every((d) => d.orderId === order.id)).toBe(true);

    // An invoice-only batch lists only the invoice.
    const invoicesOnly = await createDocumentJob({ shopId: shop.id, documentTypes: ["INVOICE"], orderIds: [order.id] });
    expect((await documentsForBatch(shop.id, invoicesOnly)).map((d) => d.documentType)).toEqual(["INVOICE"]);
  });
});

describe("latestPerOrderAndType", () => {
  it("keeps the newest document per order and type, in first-seen order", () => {
    const docs = [
      { id: "a", orderId: "o1", type: "INVOICE", renderedAt: "2026-09-28T01:00:00Z" },
      { id: "b", orderId: "o1", type: "PACKING_SLIP", renderedAt: "2026-09-28T01:00:00Z" },
      { id: "c", orderId: "o2", type: "INVOICE", renderedAt: "2026-09-28T01:00:00Z" },
      { id: "d", orderId: "o1", type: "INVOICE", renderedAt: "2026-09-28T02:00:00Z" },
    ];
    expect(latestPerOrderAndType(docs).map((d) => d.id)).toEqual(["d", "b", "c"]);
  });
});
