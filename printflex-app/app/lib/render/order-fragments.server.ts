import type { Template } from "@prisma/client";
import prisma from "../../db.server";
import { allocateInvoiceNumber } from "../invoices/invoice-number.server";
import { mintScanToken, scanUrl } from "../scan/tokens.server";
import { parseTemplateSettings, resolveTemplate, type TemplateSettings } from "../templates/templates.server";
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

export async function resolveTemplates(
  shopId: string,
  documentTypes: readonly DocumentType[],
): Promise<Map<DocumentType, ResolvedTemplate>> {
  const map = new Map<DocumentType, ResolvedTemplate>();
  for (const type of documentTypes) {
    const template = await resolveTemplate(shopId, type);
    map.set(type, { template, settings: parseTemplateSettings(template.settingsJson) });
  }
  return map;
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
}

/** QR (a fresh signed scan token) and barcode for one order, sized per template. */
export async function buildOrderCodes(input: OrderCodesInput): Promise<Codes> {
  const codes: Codes = {};
  if (input.settings.codes.qr) {
    const { token } = await mintScanToken(input.shopId, { kind: "order", orderId: input.orderId }, input.now);
    codes.qr = await qrSvg(scanUrl(token), input.settings.codes.size);
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
  });
  if (input.documentType === "INVOICE") {
    const invoice = await allocateInvoiceNumber(input.shopId, input.orderId);
    return {
      invoiceNumber: invoice.formatted,
      html: renderInvoiceFragment({
        order: input.data,
        invoiceNumber: invoice.formatted,
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
