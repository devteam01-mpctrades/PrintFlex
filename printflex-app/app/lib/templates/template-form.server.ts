import {
  DEFAULT_TEMPLATE_SETTINGS,
  FONT_CHOICES,
  isValidLogo,
  type AssignmentRule,
  type TemplateFields,
  type TemplateSettings,
} from "./templates.server";

/**
 * FormData from the studio into settings and a rule. The edit form and the
 * live preview both go through here, so what the merchant previews is
 * exactly what saving stores.
 */

function on(form: FormData, key: string): boolean {
  const value = form.get(key);
  return value === "on" || value === "true" || value === "1";
}

function text(form: FormData, key: string, fallback: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : fallback;
}

export function settingsFromForm(form: FormData, current: TemplateSettings): TemplateSettings {
  const fields = Object.fromEntries(
    (Object.keys(DEFAULT_TEMPLATE_SETTINGS.fields) as Array<keyof TemplateFields>).map((key) => [
      key,
      form.has(`field.${key}.present`) ? on(form, `field.${key}`) : current.fields[key],
    ]),
  ) as unknown as TemplateFields;

  const font = (key: string, fallback: string) => {
    const value = text(form, key, fallback);
    return (FONT_CHOICES as readonly string[]).includes(value) ? value : fallback;
  };
  const accent = text(form, "accentColor", current.accentColor).trim();
  const logoAction = text(form, "logoAction", "keep");
  const logoData = form.get("logoDataUrl");

  return {
    accentColor: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent) ? accent.toLowerCase() : current.accentColor,
    headingFont: font("headingFont", current.headingFont),
    bodyFont: font("bodyFont", current.bodyFont),
    paperSize: text(form, "paperSize", current.paperSize) === "LETTER" ? "LETTER" : "A4",
    density: text(form, "density", current.density) === "compact" ? "compact" : "normal",
    logoUrl: logoAction === "remove" ? null : isValidLogo(logoData) ? logoData : current.logoUrl,
    footerText: text(form, "footerText", current.footerText).slice(0, 2000),
    fields,
    codes: {
      qr: form.has("codes.qr.present") ? on(form, "codes.qr") : current.codes.qr,
      barcode: form.has("codes.barcode.present") ? on(form, "codes.barcode") : current.codes.barcode,
      position: text(form, "codes.position", current.codes.position) === "footer" ? "footer" : "header",
      size: (["small", "medium", "large"] as const).find((s) => s === text(form, "codes.size", current.codes.size)) ?? current.codes.size,
    },
  };
}

function list(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}

export function ruleFromForm(form: FormData): AssignmentRule {
  return {
    countries: list(text(form, "rule.countries", "")).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
    tags: list(text(form, "rule.tags", "")),
  };
}
