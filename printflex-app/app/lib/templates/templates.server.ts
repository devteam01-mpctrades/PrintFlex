import type { Template, TemplateVersion } from "@prisma/client";
import prisma from "../../db.server";
import { canCreateAnother } from "../plans.server";
import type { DocumentType } from "../types";

/**
 * Templates, their settings, their assignment rules and their versions.
 *
 * Every save is a new TemplateVersion and bumps Template.version. The PDF
 * cache key includes the version, so saving invalidates cached PDFs for
 * that template and no other.
 */

export type PaperSize = "A4" | "LETTER";
export type CodePosition = "header" | "footer";
export type CodeSize = "small" | "medium" | "large";

export interface TemplateFields {
  unitPrices: boolean;
  lineDiscounts: boolean;
  taxBreakdown: boolean;
  customerPhone: boolean;
  customerEmail: boolean;
  orderNotes: boolean;
  giftMessage: boolean;
  sku: boolean;
  barcodeValue: boolean;
  binLocation: boolean;
  hsCode: boolean;
  countryOfOrigin: boolean;
  weight: boolean;
  paymentStatus: boolean;
}

export type EmailTrigger = "creation" | "payment" | "fulfillment";

export interface TemplateSettings {
  /** Automatic invoice email (INVOICE templates only). */
  email: { enabled: boolean; trigger: EmailTrigger };
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  paperSize: PaperSize;
  density: "compact" | "normal";
  /** A data: URL (PNG, JPEG or SVG, under 400 KB) or null. */
  logoUrl: string | null;
  footerText: string;
  fields: TemplateFields;
  codes: { qr: boolean; barcode: boolean; position: CodePosition; size: CodeSize };
}

/** Curated fonts that headless Chrome can render without web font loading. */
export const FONT_CHOICES = [
  "Inter",
  "Helvetica Neue",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Courier New",
] as const;

export const FIELD_LABELS: Record<keyof TemplateFields, string> = {
  unitPrices: "Unit prices",
  lineDiscounts: "Line discounts",
  taxBreakdown: "Tax breakdown",
  customerPhone: "Customer phone",
  customerEmail: "Customer email",
  orderNotes: "Order notes",
  giftMessage: "Gift message",
  sku: "SKU",
  barcodeValue: "Barcode value",
  binLocation: "Bin location",
  hsCode: "HS code",
  countryOfOrigin: "Country of origin",
  weight: "Weight",
  paymentStatus: "Payment status",
};

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  email: { enabled: false, trigger: "payment" },
  accentColor: "#1f2937",
  headingFont: "Inter",
  bodyFont: "Inter",
  paperSize: "A4",
  density: "normal",
  logoUrl: null,
  footerText: "",
  fields: {
    unitPrices: true,
    lineDiscounts: true,
    taxBreakdown: true,
    customerPhone: false,
    customerEmail: true,
    orderNotes: false,
    giftMessage: false,
    sku: true,
    barcodeValue: true,
    binLocation: true,
    hsCode: false,
    countryOfOrigin: false,
    weight: false,
    paymentStatus: true,
  },
  codes: { qr: true, barcode: true, position: "header", size: "medium" },
};

/** Which toggles make sense on which document. */
export const FIELDS_BY_TYPE: Record<DocumentType, Array<keyof TemplateFields>> = {
  INVOICE: ["unitPrices", "lineDiscounts", "taxBreakdown", "customerEmail", "customerPhone", "orderNotes", "sku", "hsCode", "countryOfOrigin", "weight", "paymentStatus", "barcodeValue"],
  PACKING_SLIP: ["sku", "binLocation", "giftMessage", "orderNotes", "customerEmail", "customerPhone", "weight", "countryOfOrigin", "barcodeValue"],
  PICK_LIST: ["binLocation", "weight"],
};

export const DEFAULT_NAMES: Record<DocumentType, string> = {
  INVOICE: "Invoice — Default",
  PACKING_SLIP: "Packing slip",
  PICK_LIST: "Pick list",
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  INVOICE: "Invoice",
  PACKING_SLIP: "Packing slip",
  PICK_LIST: "Pick list",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_LOGO_BYTES = 400 * 1024;
const LOGO_DATA_URL = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

export function isValidLogo(value: unknown): value is string {
  return typeof value === "string" && LOGO_DATA_URL.test(value) && value.length * 0.75 <= MAX_LOGO_BYTES;
}

/** Merge stored JSON over the defaults so old templates keep working when settings grow. */
export function parseTemplateSettings(json: string): TemplateSettings {
  let raw: unknown = {};
  try {
    raw = JSON.parse(json);
  } catch {
    raw = {};
  }
  const root = isRecord(raw) ? raw : {};
  const fields = isRecord(root.fields) ? root.fields : {};
  const codes = isRecord(root.codes) ? root.codes : {};
  const d = DEFAULT_TEMPLATE_SETTINGS;
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const parsedFields = Object.fromEntries(
    (Object.keys(d.fields) as Array<keyof TemplateFields>).map((key) => [key, bool(fields[key], d.fields[key])]),
  ) as unknown as TemplateFields;
  const email = isRecord(root.email) ? root.email : {};
  return {
    email: {
      enabled: bool(email.enabled, d.email.enabled),
      trigger: email.trigger === "creation" || email.trigger === "fulfillment" ? email.trigger : "payment",
    },
    accentColor: str(root.accentColor, d.accentColor),
    headingFont: str(root.headingFont, d.headingFont),
    bodyFont: str(root.bodyFont, d.bodyFont),
    paperSize: root.paperSize === "LETTER" ? "LETTER" : "A4",
    density: root.density === "compact" ? "compact" : "normal",
    logoUrl: isValidLogo(root.logoUrl) ? root.logoUrl : null,
    footerText: str(root.footerText, d.footerText),
    fields: parsedFields,
    codes: {
      qr: bool(codes.qr, d.codes.qr),
      barcode: bool(codes.barcode, d.codes.barcode),
      position: codes.position === "footer" ? "footer" : "header",
      size: codes.size === "small" || codes.size === "large" ? codes.size : "medium",
    },
  };
}

// ------------------------------------------------------------ Assignment

/**
 * A rule matches an order when every listed condition holds. An empty rule
 * matches all orders. Precedence when several templates of one type match:
 *   1. a rule with a tag condition beats one without,
 *   2. then a rule with a country condition beats one without,
 *   3. then more conditions beat fewer,
 *   4. then the older template wins.
 * So "Tag b2b + ships to DE" beats "Tag b2b", which beats "Ships to DE",
 * which beats "All orders".
 */
export interface AssignmentRule {
  countries: string[];
  tags: string[];
}

export const EMPTY_RULE: AssignmentRule = { countries: [], tags: [] };

export function parseAssignmentRule(json: string): AssignmentRule {
  try {
    const raw: unknown = JSON.parse(json);
    if (!isRecord(raw)) return EMPTY_RULE;
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
    return { countries: list(raw.countries).map((c) => c.toUpperCase()), tags: list(raw.tags) };
  } catch {
    return EMPTY_RULE;
  }
}

export interface OrderContext {
  countryCode: string | null;
  tags: readonly string[];
}

export function ruleMatches(rule: AssignmentRule, order: OrderContext): boolean {
  if (rule.countries.length && !(order.countryCode && rule.countries.includes(order.countryCode.toUpperCase()))) return false;
  if (rule.tags.length) {
    const have = new Set(order.tags.map((t) => t.toLowerCase()));
    if (!rule.tags.some((t) => have.has(t.toLowerCase()))) return false;
  }
  return true;
}

/** Higher sorts first. */
export function ruleSpecificity(rule: AssignmentRule): number {
  return (rule.tags.length ? 100 : 0) + (rule.countries.length ? 10 : 0) + rule.tags.length + rule.countries.length;
}

export function describeRule(rule: AssignmentRule): string {
  const parts: string[] = [];
  if (rule.tags.length) parts.push(`Tag: ${rule.tags.join(" or ")}`);
  if (rule.countries.length) parts.push(`Ships to ${rule.countries.join(", ")}`);
  return parts.length ? parts.join(" · ") : "All orders";
}

/** Templates of a type in precedence order: the first matching one is used. */
export function orderByPrecedence<T extends { assignmentRuleJson: string; createdAt: Date }>(templates: T[]): T[] {
  return [...templates].sort((a, b) => {
    const diff = ruleSpecificity(parseAssignmentRule(b.assignmentRuleJson)) - ruleSpecificity(parseAssignmentRule(a.assignmentRuleJson));
    return diff !== 0 ? diff : a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function pickTemplate<T extends { assignmentRuleJson: string; createdAt: Date }>(templates: T[], order: OrderContext): T | null {
  return orderByPrecedence(templates).find((t) => ruleMatches(parseAssignmentRule(t.assignmentRuleJson), order)) ?? null;
}

// ------------------------------------------------------------------ CRUD

async function createDefault(shopId: string, documentType: DocumentType): Promise<Template> {
  const settingsJson = JSON.stringify(DEFAULT_TEMPLATE_SETTINGS);
  const assignmentRuleJson = JSON.stringify(EMPTY_RULE);
  const template = await prisma.template.create({
    data: { shopId, documentType, name: DEFAULT_NAMES[documentType], settingsJson, assignmentRuleJson, version: 1 },
  });
  await prisma.templateVersion.create({ data: { templateId: template.id, version: 1, settingsJson, assignmentRuleJson } });
  return template;
}

/** All active templates of a type, creating the default when there are none. */
export async function templatesForType(shopId: string, documentType: DocumentType): Promise<Template[]> {
  const existing = await prisma.template.findMany({ where: { shopId, documentType, active: true }, orderBy: { createdAt: "asc" } });
  if (existing.length > 0) return existing;
  return [await createDefault(shopId, documentType)];
}

/** The template for one order and document type, by assignment precedence. */
export async function resolveTemplate(shopId: string, documentType: DocumentType, order?: OrderContext): Promise<Template> {
  const templates = await templatesForType(shopId, documentType);
  if (!order) return orderByPrecedence(templates).at(-1) ?? templates[0];
  return pickTemplate(templates, order) ?? orderByPrecedence(templates).at(-1) ?? templates[0];
}

/** A resolver that caches per document type for the life of one batch. */
export function templateResolver(shopId: string) {
  const cache = new Map<DocumentType, Promise<Template[]>>();
  return async (documentType: DocumentType, order?: OrderContext): Promise<Template> => {
    if (!cache.has(documentType)) cache.set(documentType, templatesForType(shopId, documentType));
    const templates = await cache.get(documentType)!;
    if (!order) return orderByPrecedence(templates).at(-1) ?? templates[0];
    return pickTemplate(templates, order) ?? orderByPrecedence(templates).at(-1) ?? templates[0];
  };
}

export type CreateResult = { ok: true; template: Template } | { ok: false; reason: "plan" | "name" };

export async function createTemplate(
  shopId: string,
  planId: string,
  documentType: DocumentType,
  name: string,
  copyFromId?: string,
): Promise<CreateResult> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) return { ok: false, reason: "name" };
  const count = await prisma.template.count({ where: { shopId, active: true } });
  if (!canCreateAnother(planId, "templates", count)) return { ok: false, reason: "plan" };

  const source = copyFromId ? await prisma.template.findFirst({ where: { id: copyFromId, shopId } }) : null;
  const settingsJson = source?.settingsJson ?? JSON.stringify(DEFAULT_TEMPLATE_SETTINGS);
  const assignmentRuleJson = JSON.stringify(EMPTY_RULE);
  const template = await prisma.template.create({
    data: { shopId, documentType, name: trimmed, settingsJson, assignmentRuleJson, version: 1 },
  });
  await prisma.templateVersion.create({ data: { templateId: template.id, version: 1, settingsJson, assignmentRuleJson } });
  return { ok: true, template };
}

export interface SaveInput {
  name?: string;
  settings: TemplateSettings;
  rule: AssignmentRule;
}

/**
 * Save as a new version. The version bump is the cache invalidation: every
 * Document cached at the old version is bypassed on the next print of that
 * template, while other templates keep their cache.
 */
export async function saveTemplate(shopId: string, templateId: string, input: SaveInput): Promise<Template> {
  const current = await prisma.template.findFirstOrThrow({ where: { id: templateId, shopId } });
  const settingsJson = JSON.stringify(input.settings);
  const assignmentRuleJson = JSON.stringify({
    countries: input.rule.countries.map((c) => c.toUpperCase()),
    tags: input.rule.tags,
  });
  const name = input.name?.trim() || current.name;
  const unchanged =
    settingsJson === current.settingsJson && assignmentRuleJson === current.assignmentRuleJson && name === current.name;
  if (unchanged) return current;

  const version = current.version + 1;
  const [template] = await prisma.$transaction([
    prisma.template.update({ where: { id: templateId }, data: { name, settingsJson, assignmentRuleJson, version } }),
    prisma.templateVersion.create({ data: { templateId, version, settingsJson, assignmentRuleJson } }),
  ]);
  return template;
}

export const VERSION_HISTORY_LIMIT = 10;

export async function listVersions(shopId: string, templateId: string): Promise<TemplateVersion[]> {
  await prisma.template.findFirstOrThrow({ where: { id: templateId, shopId }, select: { id: true } });
  return prisma.templateVersion.findMany({ where: { templateId }, orderBy: { version: "desc" }, take: VERSION_HISTORY_LIMIT });
}

/** Restoring writes the old settings as a new version, so history is never rewritten. */
export async function restoreVersion(shopId: string, templateId: string, version: number): Promise<Template> {
  const old = await prisma.templateVersion.findUnique({ where: { templateId_version: { templateId, version } } });
  if (!old) throw new Error(`Version ${version} does not exist for this template.`);
  return saveTemplate(shopId, templateId, {
    settings: parseTemplateSettings(old.settingsJson),
    rule: parseAssignmentRule(old.assignmentRuleJson),
  });
}

export type DeleteResult = { ok: true } | { ok: false; reason: "last-of-type" | "missing" };

/** Soft delete. The last template of a type cannot go: printing must never be blocked. */
export async function deleteTemplate(shopId: string, templateId: string): Promise<DeleteResult> {
  const template = await prisma.template.findFirst({ where: { id: templateId, shopId, active: true } });
  if (!template) return { ok: false, reason: "missing" };
  const siblings = await prisma.template.count({ where: { shopId, documentType: template.documentType, active: true } });
  if (siblings <= 1) return { ok: false, reason: "last-of-type" };
  await prisma.template.update({ where: { id: templateId }, data: { active: false } });
  return { ok: true };
}
