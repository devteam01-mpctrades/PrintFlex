import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { canExportHistory, historyToCsv, listHistory, packStats } from "./history.server";
import { loadBatchProgress, recordOpened } from "./pack.server";

async function seed() {
  const shop = await prisma.shop.create({ data: { domain: `hist-${Math.random().toString(36).slice(2)}.myshopify.com` } });
  const base = { shopId: shop.id, shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() };
  const orders = await Promise.all([
    prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o1", orderName: "#1001", documentStatus: "PACKED" } }),
    prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o2", orderName: "#1002", documentStatus: "NEEDS_REVIEW" } }),
    prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o3", orderName: "#1003", documentStatus: "PRINTED" } }),
    prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o4", orderName: "#1004", documentStatus: "PRINTED" } }),
  ]);
  const job = await prisma.documentJob.create({ data: { shopId: shop.id, documentTypesJson: "[]", orderIdsJson: JSON.stringify(orders.map((o) => o.id)), total: 4 } });
  return { shop, orders, job };
}

beforeEach(async () => {
  await prisma.packEvent.deleteMany();
  await prisma.documentJob.deleteMany();
  await prisma.orderIndex.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("batch progress", () => {
  it("reports packed, needs review, in progress and not started", async () => {
    const { shop, orders, job } = await seed();
    await recordOpened(shop.id, orders[2].id, "Bench 1", "Sila");
    await recordOpened(shop.id, orders[2].id, "Bench 1", "Sila"); // deduped
    await recordOpened(shop.id, orders[0].id, "Bench 1", "Sila"); // packed already: ignored
    expect(await prisma.packEvent.count({ where: { outcome: "OPENED" } })).toBe(1);

    const progress = await loadBatchProgress(shop.id, job.id);
    expect(progress?.counts).toEqual({ packed: 1, "needs-review": 1, "in-progress": 1, "not-started": 1 });
    expect(progress?.orders.map((o) => o.state)).toEqual(["packed", "needs-review", "in-progress", "not-started"]);
    expect(await loadBatchProgress(shop.id, "nope")).toBeNull();
  });
});

describe("history and stats", () => {
  it("lists 90 days of events without OPENED, exports CSV, and computes the median pack time", async () => {
    const { shop, orders } = await seed();
    const t0 = new Date("2026-09-22T09:00:00Z");
    const ev = (orderId: string, outcome: string, minutes: number, extra: object = {}) =>
      prisma.packEvent.create({ data: { shopId: shop.id, orderId, deviceName: "Bench 2", staffLabel: "Dara", outcome, occurredAt: new Date(t0.getTime() + minutes * 60_000), ...extra } });
    await ev(orders[0].id, "OPENED", 0);
    await ev(orders[0].id, "PACKED", 2, { itemCount: 3, parcelWeightGrams: 640 });
    await ev(orders[2].id, "OPENED", 5);
    await ev(orders[2].id, "PACKED", 11, { itemCount: 1 });
    await ev(orders[1].id, "SHORT_PICK", 7, { note: 'Gift Wrap: missing — "none left"' });
    await prisma.packEvent.create({ data: { shopId: shop.id, orderId: orders[3].id, deviceName: "Old", outcome: "PACKED", occurredAt: new Date(t0.getTime() - 100 * 86_400_000) } });

    const now = new Date("2026-09-22T12:00:00Z");
    const rows = await listHistory(shop.id, { now });
    expect(rows.map((r) => r.outcome)).toEqual(["PACKED", "SHORT_PICK", "PACKED"]); // newest first, no OPENED, nothing older than 90 days
    expect(rows[0]).toMatchObject({ orderName: "#1003", deviceName: "Bench 2", staffLabel: "Dara" });

    const csv = historyToCsv(rows, "Asia/Seoul");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("time,order,device,staff,outcome,items,weight_grams,note");
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain('"Gift Wrap: missing — ""none left"""');
    expect(lines[3]).toContain("2026-09-22 18:02:00,#1001,Bench 2,Dara,Packed,3,640,");

    const stats = await packStats(shop.id, new Date("2026-09-22T00:00:00Z"), now);
    expect(stats.packedToday).toBe(2);
    expect(stats.devicesToday).toBe(1);
    expect(stats.needsReview).toBe(1);
    expect(stats.medianPackSeconds).toBe((120 + 360) / 2);

    expect(canExportHistory("FREE")).toBe(false);
    expect(canExportHistory("PREMIUM")).toBe(true);
  });
});
