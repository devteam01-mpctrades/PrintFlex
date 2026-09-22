import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { BUILT_IN_VIEWS, canSaveView, listSavedViews, saveView } from "./saved-views.server";

beforeEach(async () => {
  await prisma.savedView.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("saved views", () => {
  it("gives the Free plan the built-ins and nothing more", async () => {
    const shop = await prisma.shop.create({ data: { domain: "free.myshopify.com", plan: "FREE" } });
    expect(await listSavedViews(shop.id)).toHaveLength(BUILT_IN_VIEWS.length);
    expect(await canSaveView(shop.id, shop.plan)).toBe(false);
    const result = await saveView(shop.id, shop.plan, "Morning batch", "fulfillment=UNFULFILLED");
    expect(result).toEqual({ ok: false, reason: "plan" });
  });

  it("lets paid plans save unlimited views, rejecting duplicates", async () => {
    const shop = await prisma.shop.create({ data: { domain: "paid.myshopify.com", plan: "PREMIUM" } });
    for (let i = 0; i < 12; i += 1) {
      const result = await saveView(shop.id, shop.plan, `View ${i}`, `tag=t${i}`);
      expect(result.ok).toBe(true);
    }
    expect(await listSavedViews(shop.id)).toHaveLength(BUILT_IN_VIEWS.length + 12);
    expect(await saveView(shop.id, shop.plan, "view 3", "")).toEqual({ ok: false, reason: "duplicate" });
    expect(await saveView(shop.id, shop.plan, "all orders", "")).toEqual({ ok: false, reason: "duplicate" });
    expect(await saveView(shop.id, shop.plan, "   ", "")).toEqual({ ok: false, reason: "name" });
  });
});
