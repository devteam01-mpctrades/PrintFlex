import prisma from "../../db.server";
import { sampleOrderData, SAMPLE_ORDER_NAME } from "../templates/sample-order.server";
import type { PackSettings } from "../settings.server";
import type { PackSheet } from "./pack.server";

/**
 * The pack sheet the packer preview shows when the shop has no synced
 * orders. Built from the same sample order the template preview uses, and
 * labelled as a sample wherever it appears.
 */
export function samplePackSheet(settings: PackSettings): PackSheet {
  const order = sampleOrderData("Sample store");
  return {
    order: {
      id: "sample",
      orderName: SAMPLE_ORDER_NAME,
      customerName: order.customerName,
      itemCount: order.lineItems.reduce((n, li) => n + li.quantity, 0),
      destination: "Tokyo, JP",
      shippingMethod: order.shippingMethod,
      documentStatus: "PRINTED",
    },
    lines: order.lineItems.map((li, index) => ({
      id: `sample-${index}`,
      title: li.title,
      variantTitle: li.variantTitle,
      sku: li.sku,
      barcode: null,
      imageUrl: null,
      quantity: li.quantity,
      partOf: null,
    })),
    settings,
    lastEvent: null,
  };
}

/**
 * The order the packer preview shows: a recent one with 3 to 6 lines, so the
 * whole checklist and the pack button fit in the phone frame. Falls back to
 * the most recent order of any size.
 */
export async function pickPackPreviewOrderId(shopId: string): Promise<string | null> {
  const recent = await prisma.orderIndex.findMany({
    where: { shopId, cancelledAt: null },
    orderBy: { shopifyCreatedAt: "desc" },
    take: 100,
    select: { id: true, _count: { select: { lineItems: true } } },
  });
  const fit = recent.find((o) => o._count.lineItems >= 3 && o._count.lineItems <= 6);
  return fit?.id ?? recent[0]?.id ?? null;
}
