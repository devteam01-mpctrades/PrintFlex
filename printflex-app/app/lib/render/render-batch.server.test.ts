import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { renderFallbackForJob, shouldOfferFallback } from "./fallback.server";
import type { RawOrder, RawShop } from "./order-document-data.server";
import type { PdfRenderer } from "./pdf.server";
import { renderBatch } from "./render-batch.server";

const money = (amount: string) => ({ presentmentMoney: { amount, currencyCode: "USD" } });
const shopRaw: RawShop = { name: "Kool Seoul", contactEmail: null, billingAddress: null };

function rawOrder(n: number): RawOrder {
  const skus = [["PF-001", "Ginseng Cream"], ["PF-002", "Snail Essence"], ["PF-003", "Sheet Mask"]] as const;
  const [sku, title] = skus[n % 3];
  return {
    id: `gid://shopify/Order/${n}`, name: `#${1000 + n}`, createdAt: "2026-09-21T00:00:00Z", processedAt: "2026-09-21T00:00:00Z",
    note: null, customAttributes: [], email: `c${n}@example.com`, phone: null, taxesIncluded: false, displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED", 
    billingAddress: null, shippingAddress: { name: `Customer ${n}`, company: null, address1: "1 St", address2: null, city: "Town", province: null, zip: "1", country: "US", phone: null },
    shippingLine: { title: "Standard" },
    currentSubtotalPriceSet: money("10.00"), currentTotalDiscountsSet: money("0.00"), currentShippingPriceSet: money("0.00"),
    currentTotalTaxSet: money("0.00"), currentTotalPriceSet: money("10.00"), taxLines: [],
    lineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
      { title, variantTitle: null, sku, currentQuantity: 1 + (n % 2), originalUnitPriceSet: money("5.00"), discountedTotalSet: money("10.00"), originalTotalSet: money("10.00"), image: null },
    ] },
  };
}

function fakes() {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  const client: GraphqlClient = {
    async graphql(query, options) {
      calls.push({ query, variables: options?.variables });
      let body: unknown;
      if (query.includes("tagsAdd")) body = { data: { tagsAdd: { node: { id: options?.variables?.id }, userErrors: [] } } };
      else if (query.includes("nodes(ids")) {
        const ids = options?.variables?.ids as string[];
        body = { data: { shop: shopRaw, nodes: ids.map((id) => (id.endsWith("/999") ? null : rawOrder(Number(id.split("/").pop())))) } };
      } else body = { data: { shop: shopRaw, order: null } };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    },
  };
  const htmls: string[] = [];
  const pdf: PdfRenderer = { async render(html) { htmls.push(html); return Buffer.from(`%PDF-fake ${html.length}`); } };
  return { client, pdf, calls, htmls };
}

async function seed(count: number) {
  const shop = await prisma.shop.create({ data: { domain: `batch-${Math.random().toString(36).slice(2)}.myshopify.com`, invoicePrefix: "INV-" } });
  await prisma.binMap.createMany({
    data: [
      { shopId: shop.id, sku: "PF-003", bin: "A-01", sequence: 1 },
      { shopId: shop.id, sku: "PF-001", bin: "B-07", sequence: 2 },
    ],
  });
  const orders = [];
  for (let n = 1; n <= count; n += 1) {
    orders.push(
      await prisma.orderIndex.create({
        data: { shopId: shop.id, shopifyOrderId: `gid://shopify/Order/${n}`, orderName: `#${1000 + n}`, shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() },
      }),
    );
  }
  return { shop, orders };
}

beforeEach(async () => {
  await prisma.document.deleteMany();
  await prisma.scanToken.deleteMany();
  await prisma.meterEntry.deleteMany();
  await prisma.invoiceNumber.deleteMany();
  await prisma.documentJob.deleteMany();
  await prisma.binMap.deleteMany();
  await prisma.orderIndex.deleteMany();
  await prisma.template.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("renderBatch", () => {
  it("produces one combined PDF with cover, per-order sheets in order, a bin-sorted pick list, and meters once per order", async () => {
    const { shop, orders } = await seed(3);
    const job = await prisma.documentJob.create({
      data: {
        shopId: shop.id,
        documentTypesJson: JSON.stringify(["INVOICE", "PACKING_SLIP", "PICK_LIST"]),
        orderIdsJson: JSON.stringify([orders[2].id, orders[0].id, orders[1].id]),
        optionsJson: JSON.stringify({ coverSheet: true }),
        total: 3,
      },
    });
    const f = fakes();
    const report = await renderBatch(job.id, { ...f, now: () => new Date("2026-09-22T05:00:00Z") });

    expect(report.rendered).toBe(3);
    expect(report.outputPath).toMatch(/batch\.pdf$/);
    expect(report.pickListPath).toMatch(/picklist\.pdf$/);

    const combined = f.htmls[0];
    expect(combined.match(/class="doc cover"/g)).toHaveLength(1);
    expect(combined.match(/class="doc invoice"/g)).toHaveLength(3);
    expect(combined.match(/class="doc packing-slip"/g)).toHaveLength(3);
    expect(combined.match(/class="doc pick-list"/g)).toHaveLength(1);
    // Merchant's order: #1003 first, then #1001, then #1002.
    expect(combined.indexOf("#1003")).toBeLessThan(combined.indexOf("#1001"));
    expect(combined.indexOf("#1001")).toBeLessThan(combined.indexOf("#1002"));
    // Every order sheet carries a QR and a barcode.
    expect(combined.match(/class="code qr"/g)?.length).toBe(7); // 6 sheets + cover
    expect(combined.match(/class="code barcode"/g)).toHaveLength(6);
    // Pick list is grouped by bin: A-01 (PF-003) before B-07 (PF-001), unknown (PF-002) last.
    const pick = combined.slice(combined.indexOf('class="doc pick-list"'));
    expect(pick.indexOf("Bin A-01")).toBeLessThan(pick.indexOf("Bin B-07"));
    expect(pick.indexOf("Bin B-07")).toBeLessThan(pick.indexOf("No bin location"));

    // Rows, numbers, meter, tags, status.
    expect(await prisma.document.count({ where: { shopId: shop.id } })).toBe(6);
    const invoices = await prisma.document.findMany({ where: { shopId: shop.id, documentType: "INVOICE" }, orderBy: { invoiceNumber: "asc" } });
    expect(invoices.map((d) => d.invoiceNumber)).toEqual(["INV-000001", "INV-000002", "INV-000003"]);
    expect(await prisma.meterEntry.count({ where: { shopId: shop.id } })).toBe(3);
    expect(f.calls.filter((c) => c.query.includes("tagsAdd"))).toHaveLength(3);
    expect(await prisma.orderIndex.count({ where: { shopId: shop.id, documentStatus: "PRINTED" } })).toBe(3);
    expect(await prisma.scanToken.count({ where: { shopId: shop.id, jobId: job.id } })).toBe(1);

    // Reprinting the same batch meters nothing new.
    await prisma.documentJob.update({ where: { id: job.id }, data: { state: "QUEUED" } });
    await renderBatch(job.id, f);
    expect(await prisma.meterEntry.count({ where: { shopId: shop.id } })).toBe(3);
    expect(await prisma.document.count({ where: { shopId: shop.id } })).toBe(6);
  });

  it("skips orders that vanished and reports them", async () => {
    const { shop, orders } = await seed(2);
    const ghost = await prisma.orderIndex.create({
      data: { shopId: shop.id, shopifyOrderId: "gid://shopify/Order/999", orderName: "#1999", shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() },
    });
    const job = await prisma.documentJob.create({
      data: { shopId: shop.id, documentTypesJson: JSON.stringify(["INVOICE"]), orderIdsJson: JSON.stringify([orders[0].id, ghost.id, orders[1].id]), total: 3 },
    });
    const report = await renderBatch(job.id, fakes());
    expect(report.rendered).toBe(2);
    expect(report.missing).toEqual(["#1999"]);
    expect(await prisma.meterEntry.count({ where: { shopId: shop.id } })).toBe(2);
  });
});

describe("fallback print path", () => {
  it("prints 20 orders with the worker stopped, metering each once and marking the job", async () => {
    const { shop, orders } = await seed(20);
    // The job is queued but no worker ever runs it.
    const job = await prisma.documentJob.create({
      data: {
        shopId: shop.id,
        documentTypesJson: JSON.stringify(["INVOICE", "PACKING_SLIP"]),
        orderIdsJson: JSON.stringify(orders.map((o) => o.id)),
        total: 20,
        state: "QUEUED",
        deadlineAt: new Date(Date.now() - 60_000),
      },
    });
    expect(shouldOfferFallback(job)).toBe(true);

    const f = fakes();
    const html = await renderFallbackForJob(job.id, { client: f.client });

    expect(html.match(/class="doc invoice"/g)).toHaveLength(20);
    expect(html.match(/class="doc packing-slip"/g)).toHaveLength(20);
    expect(html).toContain("window.print()");
    expect(f.htmls).toHaveLength(0); // no PDF was rendered

    const updated = await prisma.documentJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.state).toBe("PRINTED_IN_FALLBACK");
    expect(await prisma.meterEntry.count({ where: { shopId: shop.id } })).toBe(20);
    expect(await prisma.document.count({ where: { shopId: shop.id } })).toBe(40);
    expect(await prisma.orderIndex.count({ where: { shopId: shop.id, documentStatus: "PRINTED" } })).toBe(20);

    // A queued-but-fresh job is not offered the fallback; a failed one is.
    expect(shouldOfferFallback({ state: "QUEUED", deadlineAt: new Date(Date.now() + 60_000) })).toBe(false);
    expect(shouldOfferFallback({ state: "FAILED", deadlineAt: null })).toBe(true);
  });
});
