import type { Document } from "@prisma/client";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { allocateInvoiceNumber } from "../invoices/invoice-number.server";
import { recordGeneration } from "../meter.server";
import { addOrderTags } from "../orders/tags.server";
import { parseSettings } from "../settings.server";
import { parseTemplateSettings, resolveTemplate } from "../templates/templates.server";
import type { DocumentType } from "../types";
import { renderInvoiceHtml } from "./invoice-html.server";
import { fetchOrderDocumentData, type OrderDocumentData } from "./order-document-data.server";
import type { PdfRenderer } from "./pdf.server";
import { readDocument, writeDocument } from "./storage.server";

/**
 * Render one document for one order: resolve the template, serve the cache
 * if that order was already rendered with this template version, otherwise
 * fetch the order, render, store, then meter and tag.
 *
 * Order of side effects matters:
 *   1. The PDF is written and the Document row exists (the merchant has
 *      something to print) before
 *   2. the meter records the order (a failed render never meters) and
 *   3. the printed tag is written to Shopify and the index status flips.
 */

export interface RenderDeps {
  client: GraphqlClient;
  pdf: PdfRenderer;
  now?: () => Date;
}

export interface RenderOutcome {
  document: Document;
  cached: boolean;
}

export class OrderGoneError extends Error {
  constructor(readonly orderName: string) {
    super(`${orderName} no longer exists in Shopify, so no document can be generated for it.`);
    this.name = "OrderGoneError";
  }
}

async function loadShop(shopId: string) {
  return prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { id: true, timezone: true, settingsJson: true },
  });
}

export async function renderDocumentForOrder(
  shopId: string,
  orderId: string,
  documentType: DocumentType,
  deps: RenderDeps,
  jobId?: string,
): Promise<RenderOutcome> {
  if (documentType !== "INVOICE") {
    throw new Error(`${documentType} rendering arrives in Phase 6.`);
  }
  const now = deps.now?.() ?? new Date();
  const [shop, order, template] = await Promise.all([
    loadShop(shopId),
    prisma.orderIndex.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, shopId: true, shopifyOrderId: true, orderName: true, documentStatus: true },
    }),
    resolveTemplate(shopId, documentType),
  ]);
  if (order.shopId !== shopId) throw new Error("Order does not belong to this shop");

  const cached = await prisma.document.findFirst({
    where: { shopId, orderId, documentType, templateId: template.id, templateVersion: template.version },
    orderBy: { renderedAt: "desc" },
  });
  if (cached?.filePath && (await readDocument(cached.filePath))) {
    await afterGeneration(shop, order, deps.client, now);
    return { document: cached, cached: true };
  }

  const data = await fetchOrderDocumentData(deps.client, order.shopifyOrderId);
  if (!data) throw new OrderGoneError(order.orderName);

  const invoice = await allocateInvoiceNumber(shopId, orderId);
  const settings = parseTemplateSettings(template.settingsJson);
  const html = renderInvoiceHtml({
    order: data,
    invoiceNumber: invoice.formatted,
    invoiceDate: now.toISOString(),
    settings,
    timezone: shop.timezone,
  });
  const pdf = await deps.pdf.render(html, { paperSize: settings.paperSize });

  const document = await persistDocument({
    shopId,
    jobId,
    orderId,
    documentType,
    templateId: template.id,
    templateVersion: template.version,
    invoiceNumber: invoice.formatted,
    pdf,
    renderedAt: now,
  });

  await afterGeneration(shop, order, deps.client, now);
  return { document, cached: false };
}

async function persistDocument(input: {
  shopId: string;
  jobId?: string;
  orderId: string;
  documentType: DocumentType;
  templateId: string;
  templateVersion: number;
  invoiceNumber: string | null;
  pdf: Buffer;
  renderedAt: Date;
}): Promise<Document> {
  // Older renders of the same order keep their rows; the invoice number is
  // unique per shop, so it moves to the newest Document for that order.
  await prisma.document.updateMany({
    where: { shopId: input.shopId, orderId: input.orderId, documentType: input.documentType, invoiceNumber: { not: null } },
    data: { invoiceNumber: null },
  });
  const document = await prisma.document.create({
    data: {
      shopId: input.shopId,
      jobId: input.jobId ?? null,
      orderId: input.orderId,
      documentType: input.documentType,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      invoiceNumber: input.invoiceNumber,
      byteSize: input.pdf.byteLength,
      renderedAt: input.renderedAt,
    },
  });
  const filePath = await writeDocument(input.shopId, document.id, input.pdf);
  return prisma.document.update({ where: { id: document.id }, data: { filePath } });
}

/** Meter, tag and flip status. Idempotent: safe to run on cache hits and retries. */
async function afterGeneration(
  shop: { id: string; settingsJson: string },
  order: { id: string; shopifyOrderId: string; documentStatus: string },
  client: GraphqlClient,
  now: Date,
): Promise<void> {
  await recordGeneration(shop.id, [order.shopifyOrderId], now);

  const { tagNames } = parseSettings(shop.settingsJson);
  await addOrderTags(client, order.shopifyOrderId, [tagNames.printed]);

  await prisma.orderIndex.update({
    where: { id: order.id },
    data: {
      lastPrintedAt: now,
      ...(order.documentStatus === "NEW" ? { documentStatus: "PRINTED" } : {}),
    },
  });
}

export type { OrderDocumentData };
