import type { Template } from "@prisma/client";
import prisma from "../../db.server";
import type { DocumentType } from "../types";

/**
 * Templates and their settings. Phase 5 ships defaults only; the template
 * studio (Phase 7) edits them and bumps the version on every save.
 */

export type PaperSize = "A4" | "LETTER";
export type CodePosition = "header" | "footer";
export type CodeSize = "small" | "medium" | "large";

export interface TemplateSettings {
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  paperSize: PaperSize;
  density: "compact" | "normal";
  logoUrl: string | null;
  footerText: string;
  fields: {
    unitPrices: boolean;
    lineDiscounts: boolean;
    taxBreakdown: boolean;
    customerPhone: boolean;
    customerEmail: boolean;
    orderNotes: boolean;
    giftMessage: boolean;
    sku: boolean;
    paymentStatus: boolean;
  };
  codes: {
    qr: boolean;
    barcode: boolean;
    position: CodePosition;
    size: CodeSize;
  };
}

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
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
    paymentStatus: true,
  },
  codes: { qr: true, barcode: true, position: "header", size: "medium" },
};

const DEFAULT_NAMES: Record<DocumentType, string> = {
  INVOICE: "Invoice — Default",
  PACKING_SLIP: "Packing slip",
  PICK_LIST: "Pick list",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return {
    accentColor: str(root.accentColor, d.accentColor),
    headingFont: str(root.headingFont, d.headingFont),
    bodyFont: str(root.bodyFont, d.bodyFont),
    paperSize: root.paperSize === "LETTER" ? "LETTER" : "A4",
    density: root.density === "compact" ? "compact" : "normal",
    logoUrl: typeof root.logoUrl === "string" && root.logoUrl ? root.logoUrl : null,
    footerText: str(root.footerText, d.footerText),
    fields: {
      unitPrices: bool(fields.unitPrices, d.fields.unitPrices),
      lineDiscounts: bool(fields.lineDiscounts, d.fields.lineDiscounts),
      taxBreakdown: bool(fields.taxBreakdown, d.fields.taxBreakdown),
      customerPhone: bool(fields.customerPhone, d.fields.customerPhone),
      customerEmail: bool(fields.customerEmail, d.fields.customerEmail),
      orderNotes: bool(fields.orderNotes, d.fields.orderNotes),
      giftMessage: bool(fields.giftMessage, d.fields.giftMessage),
      sku: bool(fields.sku, d.fields.sku),
      paymentStatus: bool(fields.paymentStatus, d.fields.paymentStatus),
    },
    codes: {
      qr: bool(codes.qr, d.codes.qr),
      barcode: bool(codes.barcode, d.codes.barcode),
      position: codes.position === "footer" ? "footer" : "header",
      size: codes.size === "small" || codes.size === "large" ? codes.size : "medium",
    },
  };
}

/**
 * The template to use for a document type. Phase 5: the shop's single active
 * template for that type, created with defaults on first use. Assignment
 * rules (country, market, tag) arrive in Phase 7.
 */
export async function resolveTemplate(shopId: string, documentType: DocumentType): Promise<Template> {
  const existing = await prisma.template.findFirst({
    where: { shopId, documentType, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const settingsJson = JSON.stringify(DEFAULT_TEMPLATE_SETTINGS);
  const template = await prisma.template.create({
    data: {
      shopId,
      documentType,
      name: DEFAULT_NAMES[documentType],
      settingsJson,
      assignmentRuleJson: JSON.stringify({ kind: "all" }),
      version: 1,
    },
  });
  await prisma.templateVersion.create({
    data: {
      templateId: template.id,
      version: 1,
      settingsJson,
      assignmentRuleJson: template.assignmentRuleJson,
    },
  });
  return template;
}
