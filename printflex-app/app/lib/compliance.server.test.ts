import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { handleCustomerRedact, handleDataRequest, handleShopRedact } from "./compliance.server";
import { writeDocument } from "./render/storage.server";

async function seed() {
  const shop = await prisma.shop.create({ data: { domain: `gdpr-${Math.random().toString(36).slice(2)}.myshopify.com` } });
  const template = await prisma.template.create({ data: { shopId: shop.id, documentType: "INVOICE", name: "Default" } });
  const order = await prisma.orderIndex.create({
    data: { shopId: shop.id, shopifyOrderId: "gid://shopify/Order/555", orderName: "#555", customerEmail: "marie@example.com", shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() },
  });
  const other = await prisma.orderIndex.create({
    data: { shopId: shop.id, shopifyOrderId: "gid://shopify/Order/556", orderName: "#556", customerEmail: "other@example.com", shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() },
  });
  const document = await prisma.document.create({ data: { shopId: shop.id, orderId: order.id, documentType: "INVOICE", templateId: template.id, templateVersion: 1, invoiceNumber: "INV-1" } });
  const filePath = await writeDocument(shop.id, document.id, Buffer.from("%PDF-1.4 test"));
  await prisma.document.update({ where: { id: document.id }, data: { filePath } });
  await prisma.packEvent.create({ data: { shopId: shop.id, orderId: order.id, deviceName: "Bench", outcome: "PACKED", occurredAt: new Date() } });
  return { shop, order, other, filePath };
}

beforeEach(async () => {
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("GDPR", () => {
  it("customers/redact deletes the PDF from disk and the rows, leaving other customers alone", async () => {
    const { shop, order, other, filePath } = await seed();
    expect(fs.existsSync(filePath)).toBe(true);

    const result = await handleCustomerRedact({ shop_domain: shop.domain, customer: { email: "marie@example.com" }, orders_to_redact: [555] });
    expect(result).toEqual({ orders: 1, files: 1 });
    expect(fs.existsSync(filePath)).toBe(false);
    expect(await prisma.orderIndex.findUnique({ where: { id: order.id } })).toBeNull();
    expect(await prisma.document.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.packEvent.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.orderIndex.findUnique({ where: { id: other.id } })).not.toBeNull();
    // Retries are harmless.
    expect(await handleCustomerRedact({ shop_domain: shop.domain, orders_to_redact: [555] })).toEqual({ orders: 0, files: 0 });
    expect((await prisma.auditEntry.findMany({ where: { shopId: shop.id } })).map((a) => a.action)).toEqual(["gdpr.customer_redact", "gdpr.customer_redact"]);
  });

  it("customers/data_request writes an export file and logs it", async () => {
    const { shop } = await seed();
    const file = await handleDataRequest({ shop_domain: shop.domain, customer: { email: "marie@example.com" }, orders_requested: [555], data_request: { id: 42 } });
    expect(file).toMatch(/data-request-42\.json$/);
    const exported = JSON.parse(fs.readFileSync(file as string, "utf8"));
    expect(exported.orders).toHaveLength(1);
    expect(exported.orders[0].orderName).toBe("#555");
    expect(exported.orders[0].packEvents).toHaveLength(1);
  });

  it("shop/redact removes every file and row for the shop", async () => {
    const { shop, filePath } = await seed();
    expect(await handleShopRedact(shop.domain)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(await prisma.shop.findUnique({ where: { id: shop.id } })).toBeNull();
    expect(await prisma.orderIndex.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await handleShopRedact(shop.domain)).toBe(false);
  });
});
