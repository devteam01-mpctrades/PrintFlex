import type { Template, TemplateVersion } from "@prisma/client";
import prisma from "../../db.server";
import { audit } from "../audit.server";
import { canCreateAnother } from "../plans.server";
import type { DocumentType } from "../types";

/**
 * Templates, their settings, their assignment rules and their versions.
 *
 * Every save is a new TemplateVersion and bumps Template.version. The PDF
 * cache key includes the version, so saving invalidates cached PDFs for
 * that template and no other.
 */

export * from "./template-constants";
import { EMPTY_RULE, orderByPrecedence, parseAssignmentRule, pickTemplate, type AssignmentRule, type OrderContext } from "./rules";
import {
  DEFAULT_NAMES,
  DEFAULT_TEMPLATE_SETTINGS,
  MAX_LOGO_BYTES,
  type TemplateFields,
  type TemplateSettings,
} from "./template-constants";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export {
  EMPTY_RULE,
  comparePrecedence,
  describeRank,
  describeRule,
  orderByPrecedence,
  parseAssignmentRule,
  pickTemplate,
  previewRank,
  ruleKey,
  ruleMatches,
  ruleSpecificity,
  type AssignmentRule,
  type OrderContext,
  type RankPreview,
  type RankedTemplate,
} from "./rules";

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
  await audit(shopId, "merchant", "template.created", template.id, { name: trimmed, documentType });
  return { ok: true, template };
}

export interface SaveInput {
  name?: string;
  settings: TemplateSettings;
  rule: AssignmentRule;
  /** Set by restoreVersion for the audit log. */
  restoredFrom?: number;
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
  await audit(shopId, "merchant", input.restoredFrom ? "template.restored" : "template.saved", templateId, { name, version, ...(input.restoredFrom ? { from: input.restoredFrom } : {}) });
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
    restoredFrom: version,
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
  await audit(shopId, "merchant", "template.deleted", templateId, { name: template.name });
  return { ok: true };
}
