import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { allocateInvoiceNumber, configureInvoiceNumbering, formatInvoiceNumber } from "./invoice-number.server";

async function createShop(prefix = "INV-", next = 1) {
  return prisma.shop.create({
    data: { domain: `inv-${Math.random().toString(36).slice(2)}.myshopify.com`, invoicePrefix: prefix, invoiceNextNumber: next },
  });
}

beforeEach(async () => {
  await prisma.invoiceNumber.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("invoice numbers", () => {
  it("allocates from two concurrent calls with no collision and no gap", async () => {
    const shop = await createShop("KS-INV-", 4180);
    const [a, b] = await Promise.all([
      allocateInvoiceNumber(shop.id, "order-a"),
      allocateInvoiceNumber(shop.id, "order-b"),
    ]);
    expect(a.number).not.toBe(b.number);
    expect([a.number, b.number].sort()).toEqual([4180, 4181]);
    expect(a.fresh && b.fresh).toBe(true);

    const c = await allocateInvoiceNumber(shop.id, "order-c");
    expect(c.number).toBe(4182);
    expect(c.formatted).toBe("KS-INV-004182");

    const issued = await prisma.invoiceNumber.findMany({ where: { shopId: shop.id }, orderBy: { number: "asc" } });
    expect(issued.map((i) => i.number)).toEqual([4180, 4181, 4182]);
  });

  it("gives the same order the same number, even under concurrency", async () => {
    const shop = await createShop();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => allocateInvoiceNumber(shop.id, "order-x")),
    );
    expect(new Set(results.map((r) => r.number)).size).toBe(1);
    expect(results.filter((r) => r.fresh)).toHaveLength(1);

    const next = await allocateInvoiceNumber(shop.id, "order-y");
    expect(next.number).toBe(2); // no gap was burned by the losing racers
  });

  it("is isolated per shop", async () => {
    const one = await createShop("A-");
    const two = await createShop("B-", 100);
    expect((await allocateInvoiceNumber(one.id, "o")).formatted).toBe("A-000001");
    expect((await allocateInvoiceNumber(two.id, "o")).formatted).toBe("B-000100");
  });

  it("lets the merchant change the prefix and move the sequence forward, never backward", async () => {
    const shop = await createShop("INV-", 1);
    await allocateInvoiceNumber(shop.id, "o1");
    await allocateInvoiceNumber(shop.id, "o2");

    await expect(configureInvoiceNumbering(shop.id, { nextNumber: 2 })).rejects.toThrow(/cannot be lower than 3/);
    const changed = await configureInvoiceNumbering(shop.id, { prefix: "2026-", nextNumber: 500 });
    expect(changed).toEqual({ prefix: "2026-", nextNumber: 500 });
    expect((await allocateInvoiceNumber(shop.id, "o3")).formatted).toBe("2026-000500");
    expect(formatInvoiceNumber("X", 7)).toBe("X000007");
  });
});
