import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import type { OrderDocumentQueryData } from "../render/order-document-data.server";
import type { PdfRenderer } from "../render/pdf.server";
import { storageRoot } from "../render/storage.server";
import { DEFAULT_TEMPLATE_SETTINGS, resolveTemplate, saveTemplate } from "../templates/templates.server";
import { evaluateInvoiceEmail, listSendLog, sendInvoiceEmail, triggerFor } from "./invoice-email.server";
import { toEml, type EmailTransport, type OutgoingEmail } from "./transport.server";

const money = (amount: string) => ({ presentmentMoney: { amount, currencyCode: "USD" } });
function orderData(id: string): OrderDocumentQueryData {
  return {
    shop: { name: "Kool Seoul", contactEmail: null, billingAddress: null },
    order: {
      id, name: "#KS-1", createdAt: "2026-09-21T00:00:00Z", processedAt: "2026-09-21T00:00:00Z", note: null, customAttributes: [], email: "yuki@example.com", phone: null,
      taxesIncluded: false, displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", billingAddress: { name: "Yuki", company: null, address1: null, address2: null, city: null, province: null, zip: null, country: null, phone: null }, shippingAddress: null, shippingLine: null,
      currentSubtotalPriceSet: money("10"), currentTotalDiscountsSet: money("0"), currentShippingPriceSet: money("0"), currentTotalTaxSet: money("0"), currentTotalPriceSet: money("10"), taxLines: [],
      lineItems: { nodes: [{ title: "Cream", variantTitle: null, sku: "PF-1", currentQuantity: 1, originalUnitPriceSet: money("10"), discountedTotalSet: money("10"), originalTotalSet: money("10"), image: null }] },
    },
  };
}
const client: GraphqlClient = {
  async graphql(query, options) {
    const body = query.includes("tagsAdd") ? { data: { tagsAdd: { node: { id: "x" }, userErrors: [] } } } : { data: orderData(String(options?.variables?.id)) };
    return new Response(JSON.stringify(body));
  },
};
const pdf: PdfRenderer = { async render() { return Buffer.from("%PDF-1.4 email"); } };
function memoryTransport() {
  const sent: OutgoingEmail[] = [];
  const transport: EmailTransport = { name: "memory", async send(email) { sent.push(email); return { messageId: `m${sent.length}` }; } };
  return { transport, sent };
}

async function seed(plan = "PREMIUM") {
  const shop = await prisma.shop.create({ data: { domain: `mail-${Math.random().toString(36).slice(2)}.myshopify.com`, plan } });
  const order = await prisma.orderIndex.create({
    data: { shopId: shop.id, shopifyOrderId: "gid://shopify/Order/1", orderName: "#KS-1", customerEmail: "yuki@example.com", financialStatus: "PAID", shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() },
  });
  return { shop, order };
}

beforeEach(async () => {
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("invoice email", () => {
  it("maps webhook topics to triggers", () => {
    expect(triggerFor("ORDERS_CREATE", null)).toBe("creation");
    expect(triggerFor("orders/fulfilled", "PAID")).toBe("fulfillment");
    expect(triggerFor("ORDERS_UPDATED", "PAID")).toBe("payment");
    expect(triggerFor("ORDERS_UPDATED", "PENDING")).toBeNull();
    expect(triggerFor("ORDERS_CANCELLED", "PAID")).toBeNull();
  });

  it("sends once per trigger when the template asks for it, logs it, and honours the plan", async () => {
    const { shop, order } = await seed();
    const template = await resolveTemplate(shop.id, "INVOICE");
    await saveTemplate(shop.id, template.id, { settings: { ...DEFAULT_TEMPLATE_SETTINGS, email: { enabled: true, trigger: "payment" } }, rule: { countries: [], tags: [] } });
    const m = memoryTransport();
    const deps = { client, pdf, transport: m.transport };

    expect(await evaluateInvoiceEmail(shop.id, order.id, "ORDERS_CREATE", deps)).toBeNull(); // wrong trigger
    expect(await evaluateInvoiceEmail(shop.id, order.id, "ORDERS_UPDATED", deps)).toBe("SENT");
    expect(await evaluateInvoiceEmail(shop.id, order.id, "ORDERS_UPDATED", deps)).toBe("SKIPPED"); // once per trigger
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].to).toBe("yuki@example.com");
    expect(m.sent[0].attachment.filename).toBe("invoice-KS-1.pdf");
    expect(m.sent[0].subject).toContain("INV-000001");

    // Manual resend always goes.
    expect(await sendInvoiceEmail({ shopId: shop.id, orderId: order.id, trigger: "manual", manual: true }, deps)).toBe("SENT");
    const log = await listSendLog(shop.id);
    expect(log.map((l) => [l.trigger, l.status])).toEqual([["manual", "SENT"], ["payment", "SENT"]]);

    // Free plan: no automatic email.
    await prisma.shop.update({ where: { id: shop.id }, data: { plan: "FREE" } });
    expect(await evaluateInvoiceEmail(shop.id, order.id, "ORDERS_UPDATED", deps)).toBeNull();
  });

  it("writes a real .eml with the PDF attached through the outbox transport", async () => {
    const { shop, order } = await seed();
    const template = await resolveTemplate(shop.id, "INVOICE");
    await saveTemplate(shop.id, template.id, { settings: { ...DEFAULT_TEMPLATE_SETTINGS, email: { enabled: true, trigger: "creation" } }, rule: { countries: [], tags: [] } });
    expect(await evaluateInvoiceEmail(shop.id, order.id, "ORDERS_CREATE", { client, pdf })).toBe("SENT");
    const dir = path.join(storageRoot(), "outbox", shop.id);
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    const eml = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(eml).toContain("To: yuki@example.com");
    // Sent from the app's mailbox under the app's name; the store name stays in the subject.
    expect(eml).toContain("From: PrintFlex <team@mpctrades.com>");
    expect(eml).toContain("from Kool Seoul");
    expect(eml).not.toContain("Reply-To:"); // the seeded shop has no contact email
    expect(toEml({ to: "a@b", from: "PrintFlex <team@mpctrades.com>", replyTo: "shop@example.com", subject: "s", text: "t", attachment: { filename: "x.pdf", content: Buffer.from("x"), contentType: "application/pdf" } }, "id", new Date(0))).toContain("Reply-To: shop@example.com");
    expect(eml).toContain('Content-Disposition: attachment; filename="invoice-KS-1.pdf"');
    expect(eml).toContain(Buffer.from("%PDF-1.4 email").toString("base64"));
    expect(toEml({ to: "a@b", from: "c@d", subject: "s", text: "t", attachment: { filename: "x.pdf", content: Buffer.from("x"), contentType: "application/pdf" } }, "id", new Date(0))).toContain("Message-ID: <id>");
  });
});
