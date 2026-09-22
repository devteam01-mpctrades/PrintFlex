import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import {
  createTemplate,
  deleteTemplate,
  describeRule,
  listVersions,
  parseAssignmentRule,
  pickTemplate,
  restoreVersion,
  resolveTemplate,
  saveTemplate,
  DEFAULT_TEMPLATE_SETTINGS,
} from "./templates.server";
import { ruleFromForm, settingsFromForm } from "./template-form.server";

beforeEach(async () => {
  await prisma.template.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

async function shop(plan = "PREMIUM") {
  return prisma.shop.create({ data: { domain: `tpl-${Math.random().toString(36).slice(2)}.myshopify.com`, plan } });
}

describe("assignment precedence", () => {
  const t = (id: string, rule: object, created: number) => ({ id, assignmentRuleJson: JSON.stringify(rule), createdAt: new Date(created) });
  const all = t("all", {}, 1);
  const de = t("de", { countries: ["DE"] }, 2);
  const b2b = t("b2b", { tags: ["b2b"] }, 3);
  const b2bDe = t("b2b-de", { tags: ["b2b"], countries: ["DE"] }, 4);
  const jp = t("jp", { countries: ["JP"] }, 5);
  const templates = [all, de, b2b, b2bDe, jp];

  it("prefers tag, then country, then more conditions, then the older template", () => {
    expect(pickTemplate(templates, { countryCode: "DE", tags: ["b2b"] })?.id).toBe("b2b-de");
    expect(pickTemplate(templates, { countryCode: "FR", tags: ["b2b"] })?.id).toBe("b2b");
    expect(pickTemplate(templates, { countryCode: "DE", tags: [] })?.id).toBe("de");
    expect(pickTemplate(templates, { countryCode: "jp", tags: ["express"] })?.id).toBe("jp");
    expect(pickTemplate(templates, { countryCode: "US", tags: [] })?.id).toBe("all");
    expect(pickTemplate([de, jp], { countryCode: "US", tags: [] })).toBeNull();
  });

  it("describes rules for the list", () => {
    expect(describeRule(parseAssignmentRule("{}"))).toBe("All orders");
    expect(describeRule(parseAssignmentRule(JSON.stringify({ tags: ["b2b"], countries: ["de", "AT"] })))).toBe("Tag: b2b · Ships to DE, AT");
  });
});

describe("templates", () => {
  it("limits the Free plan to one template through plans.server.ts", async () => {
    const s = await shop("FREE");
    expect(await resolveTemplate(s.id, "INVOICE")).toBeTruthy(); // the default counts as the one
    const second = await createTemplate(s.id, s.plan, "INVOICE", "Invoice — Japan");
    expect(second).toEqual({ ok: false, reason: "plan" });
    const paid = await shop("PREMIUM");
    await resolveTemplate(paid.id, "INVOICE");
    expect((await createTemplate(paid.id, paid.plan, "INVOICE", "Invoice — Japan")).ok).toBe(true);
  });

  it("saves as a new version, keeps the last ten, and restores by writing a new version", async () => {
    const s = await shop();
    const template = await resolveTemplate(s.id, "INVOICE");
    let current = template;
    for (let i = 1; i <= 12; i += 1) {
      current = await saveTemplate(s.id, template.id, {
        settings: { ...DEFAULT_TEMPLATE_SETTINGS, footerText: `Footer ${i}` },
        rule: { countries: [], tags: [] },
      });
    }
    expect(current.version).toBe(13);
    const versions = await listVersions(s.id, template.id);
    expect(versions).toHaveLength(10);
    expect(versions[0].version).toBe(13);

    const restored = await restoreVersion(s.id, template.id, 5);
    expect(restored.version).toBe(14);
    expect(JSON.parse(restored.settingsJson).footerText).toBe("Footer 4");

    // Saving identical content is not a new version.
    const same = await saveTemplate(s.id, template.id, {
      settings: { ...DEFAULT_TEMPLATE_SETTINGS, footerText: "Footer 4" },
      rule: { countries: [], tags: [] },
    });
    expect(same.version).toBe(14);
  });

  it("resolves per order and never deletes the last template of a type", async () => {
    const s = await shop();
    const base = await resolveTemplate(s.id, "INVOICE");
    const jp = await createTemplate(s.id, s.plan, "INVOICE", "Invoice — Japan");
    if (!jp.ok) throw new Error("expected ok");
    await saveTemplate(s.id, jp.template.id, { settings: DEFAULT_TEMPLATE_SETTINGS, rule: { countries: ["JP"], tags: [] } });

    expect((await resolveTemplate(s.id, "INVOICE", { countryCode: "JP", tags: [] })).id).toBe(jp.template.id);
    expect((await resolveTemplate(s.id, "INVOICE", { countryCode: "FR", tags: [] })).id).toBe(base.id);

    expect(await deleteTemplate(s.id, jp.template.id)).toEqual({ ok: true });
    expect(await deleteTemplate(s.id, base.id)).toEqual({ ok: false, reason: "last-of-type" });
  });
});

describe("form parsing", () => {
  it("turns the studio form into settings and a rule", () => {
    const form = new FormData();
    form.set("accentColor", "#B45309");
    form.set("headingFont", "Georgia");
    form.set("bodyFont", "Comic Sans"); // not curated: ignored
    form.set("paperSize", "LETTER");
    form.set("density", "compact");
    form.set("footerText", "VAT KR 123");
    form.set("field.unitPrices.present", "1");
    form.set("field.unitPrices", "off");
    form.set("field.hsCode.present", "1");
    form.set("field.hsCode", "on");
    form.set("codes.size", "large");
    form.set("codes.position", "footer");
    form.set("logoAction", "remove");
    form.set("rule.countries", "de, at,usa, fr");
    form.set("rule.tags", "b2b\nwholesale, b2b");

    const settings = settingsFromForm(form, DEFAULT_TEMPLATE_SETTINGS);
    expect(settings).toMatchObject({
      accentColor: "#b45309",
      headingFont: "Georgia",
      bodyFont: "Inter",
      paperSize: "LETTER",
      density: "compact",
      footerText: "VAT KR 123",
      logoUrl: null,
      codes: { size: "large", position: "footer", qr: true, barcode: true },
    });
    expect(settings.fields.unitPrices).toBe(false);
    expect(settings.fields.hsCode).toBe(true);
    expect(settings.fields.sku).toBe(true); // untouched fields keep their value
    expect(ruleFromForm(form)).toEqual({ countries: ["DE", "AT", "FR"], tags: ["b2b", "wholesale"] });
  });
});
