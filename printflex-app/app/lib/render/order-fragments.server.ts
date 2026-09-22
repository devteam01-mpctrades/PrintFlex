import type { Template } from "@prisma/client";
import prisma from "../../db.server";
import { allocateInvoiceNumber } from "../invoices/invoice-number.server";
import { mintScanToken, scanUrl } from "../scan/tokens.server";
import {
  parseTemplateSettings,
  templateResolver,
  type OrderContext,
  type TemplateSettings,
} from "../templates/templates.server";
import type { DocumentType } from "../types";
import { barcodeBlock, qrSvg } from "./codes.server";
import { renderInvoiceFragment, renderPackingSlipFragment, type BinEntry, type Codes } from "./fragments.server";
import type { OrderDocumentData } from "./order-document-data.server";

/**
 * Builds the fragment for one order and one document type. Shared by the
 * single-order path, the batch path, the browser fallback and (later) the
 * template preview, so there is exactly one renderer.
 */

export interface ResolvedTemplate {
  template: Template;
  settings: TemplateSettings;
}

export type TemplatePicker = (documentType: DocumentType, order?: OrderContext) => Promise<ResolvedTemplate>;

/** Per-order template picking with assignment rules, cached per batch. */
export function templatePicker(shopId: string): TemplatePicker {
  const resolve = templateResolver(shopId);
  return async (documentType, order) => {
    const template = await resolve(documentType, order);
    return { template, settings: parseTemplateSettings(template.settingsJson) };
  };
}

export function orderContext(row: { countryCode: string | null; tagsJson: string }): OrderContext {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tagsJson);
    tags = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    tags = [];
  }
  return { countryCode: row.countryCode, tags };
}

export async function loadBins(shopId: string): Promise<Map<string, BinEntry>> {
  const rows = await prisma.binMap.findMany({ where: { shopId }, select: { sku: true, bin: true, sequence: true } });
  return new Map(rows.map((r) => [r.sku, { bin: r.bin, sequence: r.sequence }]));
}

export interface OrderCodesInput {
  shopId: string;
  orderId: string;
  orderName: string;
  settings: TemplateSettings;
  now: Date;
  /** Preview: encode a placeholder instead of minting a real token. */
  preview?: boolean;
}

/** QR (a fresh signed scan token) and barcode for one order, sized per template. */
export async function buildOrderCodes(input: OrderCodesInput): Promise<Codes> {
  const codes: Codes = {};
  if (input.settings.codes.qr) {
    if (input.preview) {
      codes.qr = await qrSvg(scanUrl("preview.preview"), input.settings.codes.size);
    } else {
      const { token } = await mintScanToken(input.shopId, { kind: "order", orderId: input.orderId }, input.now);
      codes.qr = await qrSvg(scanUrl(token), input.settings.codes.size);
    }
  }
  if (input.settings.codes.barcode) {
    codes.barcode = barcodeBlock(input.orderName, input.settings.codes.size);
  }
  return codes;
}

export interface OrderFragmentInput {
  shopId: string;
  orderId: string;
  data: OrderDocumentData;
  documentType: Exclude<DocumentType, "PICK_LIST">;
  resolved: ResolvedTemplate;
  timezone: string;
  bins: ReadonlyMap<string, BinEntry>;
  now: Date;
  /** Preview: no invoice number is allocated and no scan token is minted. */
  preview?: boolean;
}

export interface OrderFragment {
  html: string;
  invoiceNumber: string | null;
}

export async function buildOrderFragment(input: OrderFragmentInput): Promise<OrderFragment> {
  const { settings } = input.resolved;
  const codes = await buildOrderCodes({
    shopId: input.shopId,
    orderId: input.orderId,
    orderName: input.data.name,
    settings,
    now: input.now,
    preview: input.preview,
  });
  if (input.documentType === "INVOICE") {
    const invoiceNumber = input.preview ? await previewInvoiceNumber(input.shopId, input.orderId) : (await allocateInvoiceNumber(input.shopId, input.orderId)).formatted;
    return {
      invoiceNumber,
      html: renderInvoiceFragment({
        order: input.data,
        invoiceNumber,
        invoiceDate: input.now.toISOString(),
        settings,
        timezone: input.timezone,
        codes,
      }),
    };
  }
  const binNames = new Map([...input.bins].map(([sku, entry]) => [sku, entry.bin]));
  return {
    invoiceNumber: null,
    html: renderPackingSlipFragment({ order: input.data, settings, timezone: input.timezone, codes, bins: binNames }),
  };
}

/** The order's real number if it has one, otherwise a clearly fake one. */
async function previewInvoiceNumber(shopId: string, orderId: string): Promise<string> {
  const existing = await prisma.invoiceNumber.findUnique({ where: { shopId_orderId: { shopId, orderId } } });
  if (existing) return existing.formatted;
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { invoicePrefix: true } });
  return `${shop.invoicePrefix}PREVIEW`;
}
