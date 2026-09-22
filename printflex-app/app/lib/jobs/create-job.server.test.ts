import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { createDocumentJob, markOrdersPrinted, parseDocumentTypes } from "./create-job.server";

beforeEach(async () => {
  await prisma.documentJob.deleteMany();
  await prisma.orderIndex.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("job creation stub", () => {
  it("parses document types", () => {
    expect(parseDocumentTypes("ALL")).toEqual(["INVOICE", "PACKING_SLIP", "PICK_LIST"]);
    expect(parseDocumentTypes("INVOICE,INVOICE,PICK_LIST")).toEqual(["INVOICE", "PICK_LIST"]);
    expect(() => parseDocumentTypes("PDF")).toThrow();
  });

  it("records a queued job without touching the meter", async () => {
    const shop = await prisma.shop.create({ data: { domain: "jobs.myshopify.com" } });
    const job = await createDocumentJob({ shopId: shop.id, documentTypes: ["INVOICE"], orderIds: ["a", "b"] });
    expect(job.state).toBe("QUEUED");
    expect(job.total).toBe(2);
    expect(await prisma.meterEntry.count()).toBe(0);
  });

  it("marks only New orders as Printed", async () => {
    const shop = await prisma.shop.create({ data: { domain: "mark.myshopify.com" } });
    const base = { shopId: shop.id, shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() };
    const fresh = await prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o1", orderName: "#1", documentStatus: "NEW" } });
    const packed = await prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o2", orderName: "#2", documentStatus: "PACKED" } });

    const result = await markOrdersPrinted(shop.id, [fresh.id, packed.id]);
    expect(result.marked).toBe(1);
    expect((await prisma.orderIndex.findUniqueOrThrow({ where: { id: fresh.id } })).documentStatus).toBe("PRINTED");
    expect((await prisma.orderIndex.findUniqueOrThrow({ where: { id: packed.id } })).documentStatus).toBe("PACKED");
  });
});
