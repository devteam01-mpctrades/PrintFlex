import type { Document } from "@prisma/client";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { recordGeneration } from "../meter.server";
import { addOrderTags } from "../orders/tags.server";
import { parseSettings } from "../settings.server";
import { parseTemplateSettings } from "../templates/templates.server";
import type { DocumentType } from "../types";
import { wrapDocument } from "./batch-html.server";
import { fetchOrderDocumentData } from "./order-document-data.server";
import { buildOrderFragment, loadBins, orderContext, templatePicker } from "./order-fragments.server";
import type { PdfRenderer } from "./pdf.server";
import { readDocument, writeDocument } from "./storage.server";

/**
 * Single-order rendering and the per-document PDF cache.
 *
 * A Document row is the record that a document exists for an order at a
 * template version. Its file may be produced eagerly (single-order print)
 * or lazily (batch print produced one combined PDF; the per-order file is
 * rendered the first time someone asks for it). Either way, one row per
 * (order, type, template version) is the cache key, and a reprint reuses
 * it instead of rendering again.
 *
 * Order of side effects: PDF and row first, then meter, then tag and status.
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

type SingleType = Exclude<DocumentType, "PICK_LIST">;

function assertSingleType(type: DocumentType): asserts type is SingleType {
  if (type === "PICK_LIST") throw new Error("A pick list spans a batch; print it from the Orders screen with a selection.");
}

export async function renderDocumentForOrder(
  shopId: string,
  orderId: string,
  documentType: DocumentType,
  deps: RenderDeps,
  jobId?: string,
): Promise<RenderOutcome> {
  assertSingleType(documentType);
  const now = deps.now?.() ?? new Date();
  const [shop, order] = await Promise.all([
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { id: true, timezone: true, settingsJson: true } }),
    prisma.orderIndex.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, shopId: true, shopifyOrderId: true, orderName: true, documentStatus: true, countryCode: true, tagsJson: true },
    }),
  ]);
  if (order.shopId !== shopId) throw new Error("Order does not belong to this shop");
  const resolved = await templatePicker(shopId)(documentType, orderContext(order));

  const cached = await prisma.document.findFirst({
    where: { shopId, orderId, documentType, templateId: resolved.template.id, templateVersion: resolved.template.version },
    orderBy: { renderedAt: "desc" },
  });
  if (cached) {
    const document = await ensureDocumentFile(cached.id, deps);
    await afterGeneration(shop, [order], deps.client, now);
    return { document, cached: true };
  }

  const data = await fetchOrderDocumentData(deps.client, order.shopifyOrderId);
  if (!data) throw new OrderGoneError(order.orderName);
  const bins = await loadBins(shopId);
  const fragment = await buildOrderFragment({ shopId, orderId, data, documentType, resolved, timezone: shop.timezone, bins, now });
  const pdf = await deps.pdf.render(
    wrapDocument([fragment.html], { title: `${documentType} ${order.orderName}`, paperSize: resolved.settings.paperSize }),
    { paperSize: resolved.settings.paperSize },
  );

  const row = await createDocumentRow({
    shopId, jobId, orderId, documentType,
    templateId: resolved.template.id,
    templateVersion: resolved.template.version,
    invoiceNumber: fragment.invoiceNumber,
    renderedAt: now,
  });
  const filePath = await writeDocument(shopId, row.id, pdf);
  const document = await prisma.document.update({ where: { id: row.id }, data: { filePath, byteSize: pdf.byteLength } });

  await afterGeneration(shop, [order], deps.client, now);
  return { document, cached: false };
}

/** Insert the Document row. The invoice number moves to the newest row for the order. */
export async function createDocumentRow(input: {
  shopId: string;
  jobId?: string;
  orderId: string;
  documentType: DocumentType;
  templateId: string;
  templateVersion: number;
  invoiceNumber: string | null;
  renderedAt: Date;
}): Promise<Document> {
  if (input.invoiceNumber) {
    await prisma.document.updateMany({
      where: { shopId: input.shopId, orderId: input.orderId, documentType: input.documentType, invoiceNumber: { not: null } },
      data: { invoiceNumber: null },
    });
  }
  return prisma.document.create({
    data: {
      shopId: input.shopId,
      jobId: input.jobId ?? null,
      orderId: input.orderId,
      documentType: input.documentType,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      invoiceNumber: input.invoiceNumber,
      renderedAt: input.renderedAt,
    },
  });
}

/**
 * Make sure a Document row has its PDF on disk, rendering it from the
 * current order data with the row's template version if not.
 */
export async function ensureDocumentFile(documentId: string, deps: RenderDeps): Promise<Document> {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: {
      order: { select: { id: true, shopifyOrderId: true, orderName: true } },
      template: true,
      shop: { select: { timezone: true } },
    },
  });
  if (document.filePath && (await readDocument(document.filePath))) return document;

  const documentType = document.documentType as DocumentType;
  assertSingleType(documentType);
  const version = await prisma.templateVersion.findUnique({
    where: { templateId_version: { templateId: document.templateId, version: document.templateVersion } },
  });
  const settings = parseTemplateSettings(version?.settingsJson ?? document.template.settingsJson);
  const data = await fetchOrderDocumentData(deps.client, document.order.shopifyOrderId);
  if (!data) throw new OrderGoneError(document.order.orderName);
  const bins = await loadBins(document.shopId);
  const fragment = await buildOrderFragment({
    shopId: document.shopId,
    orderId: document.orderId,
    data,
    documentType,
    resolved: { template: document.template, settings },
    timezone: document.shop.timezone,
    bins,
    now: document.renderedAt,
  });
  const pdf = await deps.pdf.render(
    wrapDocument([fragment.html], { title: `${documentType} ${document.order.orderName}`, paperSize: settings.paperSize }),
    { paperSize: settings.paperSize },
  );
  const filePath = await writeDocument(document.shopId, document.id, pdf);
  return prisma.document.update({ where: { id: document.id }, data: { filePath, byteSize: pdf.byteLength } });
}

/** Meter, tag and flip status for orders that now have documents. Idempotent. */
export async function afterGeneration(
  shop: { id: string; settingsJson: string },
  orders: ReadonlyArray<{ id: string; shopifyOrderId: string; documentStatus: string }>,
  client: GraphqlClient,
  now: Date,
): Promise<void> {
  if (orders.length === 0) return;
  await recordGeneration(shop.id, orders.map((o) => o.shopifyOrderId), now);

  const { tagNames } = parseSettings(shop.settingsJson);
  for (const order of orders) {
    await addOrderTags(client, order.shopifyOrderId, [tagNames.printed]);
  }

  const ids = orders.map((o) => o.id);
  await prisma.orderIndex.updateMany({ where: { id: { in: ids } }, data: { lastPrintedAt: now } });
  await prisma.orderIndex.updateMany({
    where: { id: { in: ids }, documentStatus: "NEW" },
    data: { documentStatus: "PRINTED" },
  });
}
