import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { conflictMessage, findRuleConflict } from "./rule-conflicts.server";
import { describeRank, previewRank, ruleKey } from "./rules";

beforeEach(async () => {
  await prisma.template.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

async function shopWithTemplates() {
  const shop = await prisma.shop.create({ data: { domain: `rc-${Math.random().toString(36).slice(2)}.myshopify.com`, plan: "PREMIUM" } });
  const mk = (name: string, documentType: string, rule: object) =>
    prisma.template.create({ data: { shopId: shop.id, documentType, name, settingsJson: "{}", assignmentRuleJson: JSON.stringify(rule) } });
  const all = await mk("Invoice — Default", "INVOICE", {});
  const jp = await mk("Invoice — Japan", "INVOICE", { countries: ["JP"] });
  const slip = await mk("Packing slip", "PACKING_SLIP", {});
  return { shop, all, jp, slip };
}

describe("ruleKey", () => {
  it("ignores order and case of conditions", () => {
    expect(ruleKey({ countries: ["jp", "KR"], tags: ["B2B"] })).toBe(ruleKey({ countries: ["KR", "JP"], tags: ["b2b"] }));
    expect(ruleKey({ countries: ["JP"], tags: [] })).not.toBe(ruleKey({ countries: [], tags: [] }));
  });
});

describe("findRuleConflict", () => {
  it("names the template that already covers the same rule for the same type", async () => {
    const { shop, jp } = await shopWithTemplates();
    const conflict = await findRuleConflict(shop.id, "INVOICE", { countries: ["jp"], tags: [] });
    expect(conflict?.templateId).toBe(jp.id);
    expect(conflictMessage(conflict!, { countries: ["JP"], tags: [] }, "Invoice")).toContain('"Invoice — Japan" already covers the same orders for invoices');
  });

  it("ignores the template being edited and other document types", async () => {
    const { shop, jp } = await shopWithTemplates();
    expect(await findRuleConflict(shop.id, "INVOICE", { countries: ["JP"], tags: [] }, jp.id)).toBeNull();
    expect(await findRuleConflict(shop.id, "PICK_LIST", { countries: [], tags: [] })).toBeNull();
  });

  it("treats a second catch-all as a conflict", async () => {
    const { shop, all } = await shopWithTemplates();
    const conflict = await findRuleConflict(shop.id, "INVOICE", { countries: [], tags: [] });
    expect(conflict?.templateId).toBe(all.id);
    expect(conflictMessage(conflict!, { countries: [], tags: [] }, "Invoice")).toContain("covers all orders");
  });
});

describe("previewRank", () => {
  const siblings = [
    { id: "all", name: "Invoice — Default", rule: { countries: [], tags: [] }, createdAt: "2026-01-01T00:00:00Z" },
    { id: "b2b", name: "Invoice — EU B2B", rule: { countries: [], tags: ["b2b"] }, createdAt: "2026-01-02T00:00:00Z" },
  ];

  it("places a country rule after a tag rule and before the fallback", () => {
    const rank = previewRank({ id: "new", rule: { countries: ["JP"], tags: [] }, createdAt: "2026-02-01T00:00:00Z" }, siblings);
    expect(rank).toEqual({ position: 2, total: 3, after: "Invoice — EU B2B", duplicateOf: null });
    expect(describeRank(rank, "Invoice")).toBe("Checked 2nd of 3, after Invoice — EU B2B.");
  });

  it("flags a duplicate rule and describes the fallback position", () => {
    const rank = previewRank({ id: "new", rule: { countries: [], tags: [] }, createdAt: "2026-02-01T00:00:00Z" }, siblings);
    expect(rank.duplicateOf).toBe("Invoice — Default");
    expect(describeRank(rank, "Invoice")).toContain("Checked last of 3");
  });
});
