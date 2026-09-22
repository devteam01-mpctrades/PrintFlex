import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { capacityMessage, checkCapacity, recordGeneration } from "../meter.server";
import { PLANS } from "../plans.server";
import { handleUninstall } from "../lifecycle.server";
import { runRetention } from "../retention.server";
import { writeDocument } from "../render/storage.server";
import fs from "node:fs";
import { cancelSubscription, requestPlan, stateFromSubscriptions, syncSubscription, type BillingApi } from "./billing.server";
import { BILLING_CONFIG, BILLING_PLAN_NAMES } from "./plans-config.server";

beforeEach(async () => {
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("billing plans", () => {
  it("prices annual plans at ten months and maps subscription names back to plans", () => {
    expect(BILLING_CONFIG[BILLING_PLAN_NAMES.PREMIUM.monthly].lineItems[0].amount).toBe(4.99);
    expect(BILLING_CONFIG[BILLING_PLAN_NAMES.PREMIUM.annual].lineItems[0].amount).toBe(49.9);
    expect(BILLING_CONFIG[BILLING_PLAN_NAMES.UNLIMITED.annual].lineItems[0].amount).toBe(99.9);
    expect(PLANS.UNLIMITED.annualPriceUsd).toBe(99.9);

    expect(stateFromSubscriptions([])).toEqual({ planId: "FREE", annual: false, subscription: null });
    const sub = { id: "gid://shopify/AppSubscription/1", name: "PrintFlex Premium (annual)", test: true };
    expect(stateFromSubscriptions([sub])).toEqual({ planId: "PREMIUM", annual: true, subscription: sub });
    expect(stateFromSubscriptions([sub, { id: "2", name: "PrintFlex Unlimited", test: true }]).planId).toBe("UNLIMITED");
    expect(stateFromSubscriptions([{ id: "3", name: "Some other app plan", test: true }]).planId).toBe("FREE");
  });

  it("mirrors Shopify's answer onto the shop and only talks to Shopify to change it", async () => {
    const shop = await prisma.shop.create({ data: { domain: "bill.myshopify.com", plan: "FREE" } });
    const calls: string[] = [];
    const fake = {
      async check() {
        calls.push("check");
        return { appSubscriptions: [{ id: "gid://shopify/AppSubscription/9", name: "PrintFlex Unlimited", test: true }] };
      },
      async request({ plan, returnUrl }: { plan: string; returnUrl?: string }) {
        calls.push(`request:${plan}:${returnUrl}`);
        throw new Response(null, { status: 302 });
      },
      async cancel({ subscriptionId }: { subscriptionId: string }) {
        calls.push(`cancel:${subscriptionId}`);
        return {};
      },
    };
    const billing = fake as unknown as BillingApi;
    const state = await syncSubscription(billing, shop.id);
    expect(state.planId).toBe("UNLIMITED");
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("UNLIMITED");

    await expect(requestPlan(billing, "PREMIUM", true, "https://app/return")).rejects.toBeInstanceOf(Response);
    await cancelSubscription(billing, shop.id, "gid://shopify/AppSubscription/9");
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("FREE");
    expect(calls).toEqual(["check", "request:PrintFlex Premium (annual):https://app/return", "cancel:gid://shopify/AppSubscription/9"]);
  });
});

describe("the cap", () => {
  it("counts only unmetered orders, stops at the limit, and never changes the plan", async () => {
    const shop = await prisma.shop.create({ data: { domain: "cap.myshopify.com", plan: "FREE", timezone: "UTC" } });
    const now = new Date("2026-09-10T12:00:00Z");
    await recordGeneration(shop.id, Array.from({ length: 48 }, (_, i) => `gid://shopify/Order/${i}`), now);

    const reprint = await checkCapacity(shop.id, ["gid://shopify/Order/1", "gid://shopify/Order/2"], now);
    expect(reprint).toMatchObject({ allowed: true, newUnits: 0, used: 48, limit: 50 });

    const two = await checkCapacity(shop.id, ["gid://shopify/Order/100", "gid://shopify/Order/101"], now);
    expect(two.allowed).toBe(true);
    expect(two.afterRatio).toBe(1);

    const three = await checkCapacity(shop.id, ["gid://shopify/Order/100", "gid://shopify/Order/101", "gid://shopify/Order/102"], now);
    expect(three.allowed).toBe(false);
    expect(capacityMessage(three, "UTC")).toContain("paused until the period resets on 1 October");
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("FREE");

    await prisma.shop.update({ where: { id: shop.id }, data: { limitBehaviour: "PROMPT_UPGRADE" } });
    expect(capacityMessage(await checkCapacity(shop.id, ["gid://shopify/Order/200", "gid://shopify/Order/201", "gid://shopify/Order/202"], now), "UTC")).toContain("never upgrades your plan by itself");

    await prisma.shop.update({ where: { id: shop.id }, data: { plan: "UNLIMITED" } });
    expect((await checkCapacity(shop.id, Array.from({ length: 5000 }, (_, i) => `o${i}`), now)).allowed).toBe(true);
  });
});

describe("uninstall and retention", () => {
  it("uninstall mirrors Free, cancels jobs, stops emails and starts the clock; retention prunes files and history", async () => {
    const shop = await prisma.shop.create({ data: { domain: "bye.myshopify.com", plan: "PREMIUM" } });
    const job = await prisma.documentJob.create({ data: { shopId: shop.id, documentTypesJson: "[]", orderIdsJson: "[]", state: "RUNNING" } });
    await handleUninstall(shop.domain, new Date("2026-09-22T00:00:00Z"));
    const after = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
    expect(after.plan).toBe("FREE");
    expect(after.uninstalledAt).toEqual(new Date("2026-09-22T00:00:00Z"));
    expect(JSON.parse(after.settingsJson).emailsEnabled).toBe(false);
    expect((await prisma.documentJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe("CANCELLED");

    // Retention: an old PDF loses its file but keeps its row; old history goes; the uninstalled shop is redacted after 30 days.
    const live = await prisma.shop.create({ data: { domain: "live.myshopify.com" } });
    const template = await prisma.template.create({ data: { shopId: live.id, documentType: "INVOICE", name: "T" } });
    const order = await prisma.orderIndex.create({ data: { shopId: live.id, shopifyOrderId: "o", orderName: "#1", shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() } });
    const oldDoc = await prisma.document.create({ data: { shopId: live.id, orderId: order.id, documentType: "INVOICE", templateId: template.id, templateVersion: 1, renderedAt: new Date("2026-08-01T00:00:00Z") } });
    const oldPath = await writeDocument(live.id, oldDoc.id, Buffer.from("%PDF old"));
    await prisma.document.update({ where: { id: oldDoc.id }, data: { filePath: oldPath } });
    const freshDoc = await prisma.document.create({ data: { shopId: live.id, orderId: order.id, documentType: "PACKING_SLIP", templateId: template.id, templateVersion: 1, renderedAt: new Date("2026-10-20T00:00:00Z") } });
    const freshPath = await writeDocument(live.id, freshDoc.id, Buffer.from("%PDF fresh"));
    await prisma.document.update({ where: { id: freshDoc.id }, data: { filePath: freshPath } });
    await prisma.packEvent.create({ data: { shopId: live.id, orderId: order.id, deviceName: "d", outcome: "PACKED", occurredAt: new Date("2026-06-01T00:00:00Z") } });
    await prisma.packEvent.create({ data: { shopId: live.id, orderId: order.id, deviceName: "d", outcome: "PACKED", occurredAt: new Date("2026-10-15T00:00:00Z") } });

    const report = await runRetention(new Date("2026-10-23T00:00:00Z"));
    expect(report).toEqual({ pdfFiles: 1, jobFiles: 0, packEvents: 1, shopsRedacted: 1 });
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(freshPath)).toBe(true);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: oldDoc.id } })).filePath).toBeNull();
    expect(await prisma.shop.findUnique({ where: { id: shop.id } })).toBeNull();
    expect(await prisma.shop.findUnique({ where: { id: live.id } })).not.toBeNull();
  });
});
