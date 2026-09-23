import type { Template } from "@prisma/client";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { wrapDocument } from "../render/batch-html.server";
import { aggregatePickList, renderPickListFragment } from "../render/fragments.server";
import { fetchOrderDocumentData, type OrderDocumentData } from "../render/order-document-data.server";
import { buildOrderFragment, loadBins } from "../render/order-fragments.server";
import type { DocumentType } from "../types";
import { sampleOrderData } from "./sample-order.server";
import type { TemplateSettings } from "./template-constants";

/**
 * The template preview. It calls the same fragment builders as batch and
 * single-order printing (buildOrderFragment, renderPickListFragment,
 * wrapDocument), with the preview flag so no invoice number is consumed
 * and no scan token is minted. There is no second renderer.
 */

export interface PreviewOrder {
  id: string;
  orderName: string;
  customerName: string | null;
  countryCode: string | null;
  itemCount: number;
  /** Length of the longest line-item title, the thing most likely to break a layout. */
  longestTitle: number;
}

/** Recent orders for the picker, hardest layout first. */
export async function listPreviewOrders(shopId: string, limit = 30): Promise<PreviewOrder[]> {
  const rows = await prisma.orderIndex.findMany({
    where: { shopId, cancelledAt: null },
    orderBy: [{ itemCount: "desc" }, { shopifyCreatedAt: "desc" }],
    take: limit,
    select: { id: true, orderName: true, customerName: true, countryCode: true, itemCount: true, lineItems: { select: { title: true } } },
  });
  return rows
    .map((r) => ({
      id: r.id,
      orderName: r.orderName,
      customerName: r.customerName,
      countryCode: r.countryCode,
      itemCount: r.itemCount,
      longestTitle: r.lineItems.reduce((max, li) => Math.max(max, li.title.length), 0),
    }))
    .sort((a, b) => b.itemCount - a.itemCount || b.longestTitle - a.longestTitle);
}

/** The order that stresses a layout most: most lines, then longest title. */
export async function pickPreviewOrder(shopId: string): Promise<PreviewOrder | null> {
  return (await listPreviewOrders(shopId, 30))[0] ?? null;
}

export interface PreviewResult {
  html: string;
  /** True when no synced order was available and the sample order was rendered. */
  sample: boolean;
  orderName: string;
}

function notice(paperSize: TemplateSettings["paperSize"], heading: string, text: string): string {
  return wrapDocument([`<article class="doc" style="padding:20mm"><h2>${heading}</h2><p>${text}</p></article>`], { title: "Preview", paperSize });
}

export async function renderPreview(input: {
  shopId: string;
  timezone: string;
  template: Template;
  settings: TemplateSettings;
  orderId: string | null;
  client: GraphqlClient;
}): Promise<PreviewResult> {
  const { shopId, timezone, template, settings, client } = input;
  const type = template.documentType as DocumentType;

  const order = input.orderId
    ? await prisma.orderIndex.findFirst({ where: { id: input.orderId, shopId }, select: { id: true, shopifyOrderId: true, orderName: true } })
    : await pickPreviewOrder(shopId).then((p) => (p ? { id: p.id, shopifyOrderId: "", orderName: p.orderName } : null));

  let data: OrderDocumentData | null = null;
  let sample = false;
  if (order) {
    const row = order.shopifyOrderId
      ? order
      : await prisma.orderIndex.findUniqueOrThrow({ where: { id: order.id }, select: { id: true, shopifyOrderId: true, orderName: true } });
    data = await fetchOrderDocumentData(client, row.shopifyOrderId);
    if (!data) {
      return { html: notice(settings.paperSize, `${row.orderName} is gone`, "That order no longer exists in Shopify. Pick another one."), sample: false, orderName: row.orderName };
    }
  } else {
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { domain: true } });
    data = sampleOrderData(shop.domain.replace(".myshopify.com", ""));
    sample = true;
  }

  const bins = await loadBins(shopId);
  if (type === "PICK_LIST") {
    const fragment = renderPickListFragment({
      lines: aggregatePickList([data], bins),
      orderCount: 1,
      batchLabel: "BATCH-PREVIEW",
      generatedAt: new Date().toISOString(),
      sellerName: data.seller.name,
      settings,
      timezone,
    });
    return { html: wrapDocument([fragment], { title: "Preview", paperSize: settings.paperSize }), sample, orderName: data.name };
  }
  const fragment = await buildOrderFragment({
    shopId,
    orderId: order?.id ?? "preview",
    data,
    documentType: type,
    resolved: { template, settings },
    timezone,
    bins,
    now: new Date(),
    preview: true,
  });
  return { html: wrapDocument([fragment.html], { title: "Preview", paperSize: settings.paperSize }), sample, orderName: data.name };
}
