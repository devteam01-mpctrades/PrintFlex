import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { getUsage, recordGeneration, recordJobGeneration } from "./meter.server";

async function createShop(timezone = "UTC", plan = "PREMIUM") {
  return prisma.shop.create({
    data: {
      domain: `shop-${Math.random().toString(36).slice(2)}.myshopify.com`,
      timezone,
      plan,
    },
  });
}

async function unitCount(shopId: string): Promise<number> {
  return prisma.meterEntry.count({ where: { shopId } });
}

const ORDER_IDS = Array.from({ length: 40 }, (_, i) => `gid://shopify/Order/${1000 + i}`);

beforeEach(async () => {
  await prisma.meterEntry.deleteMany();
  await prisma.documentJob.deleteMany();
  await prisma.shop.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the meter", () => {
  it("counts order A once when a document is generated for it twice in one period", async () => {
    const shop = await createShop();
    const now = new Date("2026-09-15T10:00:00Z");

    const first = await recordGeneration(shop.id, ["gid://shopify/Order/1"], now);
    const second = await recordGeneration(
      shop.id,
      ["gid://shopify/Order/1"],
      new Date("2026-09-20T10:00:00Z"),
    );

    expect(first).toMatchObject({ period: "2026-09", recorded: 1, alreadyCounted: 0 });
    expect(second).toMatchObject({ period: "2026-09", recorded: 0, alreadyCounted: 1 });
    expect(await unitCount(shop.id)).toBe(1);
    expect((await getUsage(shop.id, now)).used).toBe(1);
  });

  it("counts a 40-order pick list as 40 units once, and re-running it as none", async () => {
    const shop = await createShop();
    const now = new Date("2026-09-15T10:00:00Z");

    const first = await recordGeneration(shop.id, ORDER_IDS, now);
    const rerun = await recordGeneration(shop.id, ORDER_IDS, now);

    expect(first).toMatchObject({ recorded: 40, alreadyCounted: 0 });
    expect(rerun).toMatchObject({ recorded: 0, alreadyCounted: 40 });
    expect(await unitCount(shop.id)).toBe(40);

    const usage = await getUsage(shop.id, now);
    expect(usage.used).toBe(40);
    expect(usage.limit).toBe(500);
    expect(usage.remaining).toBe(460);
  });

  it("records nothing for a failed job", async () => {
    const shop = await createShop();
    const failed = await prisma.documentJob.create({
      data: {
        shopId: shop.id,
        documentTypesJson: JSON.stringify(["INVOICE"]),
        orderIdsJson: JSON.stringify(ORDER_IDS.slice(0, 5)),
        state: "FAILED",
        total: 5,
        error: "renderer crashed",
      },
    });

    const result = await recordJobGeneration(failed.id);

    expect(result).toBeNull();
    expect(await unitCount(shop.id)).toBe(0);

    // The same orders in a SUCCEEDED job do count, so the guard is the state.
    const succeeded = await prisma.documentJob.create({
      data: {
        shopId: shop.id,
        documentTypesJson: JSON.stringify(["INVOICE"]),
        orderIdsJson: JSON.stringify(ORDER_IDS.slice(0, 5)),
        state: "SUCCEEDED",
        total: 5,
        progress: 5,
      },
    });
    const counted = await recordJobGeneration(succeeded.id);
    expect(counted?.recorded).toBe(5);
    expect(await unitCount(shop.id)).toBe(5);
  });

  it("rolls the period over at local midnight in the shop's timezone, not UTC", async () => {
    // Auckland is UTC+13 on these dates (NZDT). Both instants below are
    // 30 September in UTC, but the second is already 1 October in Auckland.
    const shop = await createShop("Pacific/Auckland");
    const lateSeptemberLocal = new Date("2026-09-30T10:00:00Z"); // 23:00 NZDT, 30 Sep
    const earlyOctoberLocal = new Date("2026-09-30T12:00:00Z"); // 01:00 NZDT, 1 Oct

    const september = await recordGeneration(shop.id, ["gid://shopify/Order/1"], lateSeptemberLocal);
    expect(september.period).toBe("2026-09");
    expect((await getUsage(shop.id, lateSeptemberLocal)).used).toBe(1);

    const octoberUsage = await getUsage(shop.id, earlyOctoberLocal);
    expect(octoberUsage.period).toBe("2026-10");
    expect(octoberUsage.used).toBe(0);

    // The same order generated again after rollover is a fresh unit.
    const october = await recordGeneration(shop.id, ["gid://shopify/Order/1"], earlyOctoberLocal);
    expect(october).toMatchObject({ period: "2026-10", recorded: 1, alreadyCounted: 0 });

    // A UTC-zoned shop at the same instants stays in September throughout.
    const utcShop = await createShop("UTC");
    expect((await getUsage(utcShop.id, earlyOctoberLocal)).period).toBe("2026-09");
  });

  it("reports the period end and days remaining in the shop's timezone", async () => {
    const shop = await createShop("Asia/Seoul");
    const now = new Date("2026-09-21T15:00:00Z"); // 22 Sep 00:00 KST
    const usage = await getUsage(shop.id, now);

    expect(usage.period).toBe("2026-09");
    // 1 Oct 00:00 KST is 30 Sep 15:00 UTC.
    expect(usage.periodEndsAt.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(usage.daysRemaining).toBe(9);
  });
});
