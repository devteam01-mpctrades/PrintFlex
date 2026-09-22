import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { setOrderMetafields } from "../orders/metafields.server";
import { addOrderTags } from "../orders/tags.server";
import { parseSettings, type PackSettings } from "../settings.server";
import type { PackOutcome } from "../types";

/**
 * Packing. The checklist is built from the synced line items, expanded
 * through the BundleMap. Packing and flagging write to Shopify (tag and
 * metafields) and to the index, and are idempotent: the same event is never
 * recorded twice, and an already packed order is never packed again.
 */

export interface PackLine {
  /** Stable id for client state: the line item id, suffixed for components. */
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  quantity: number;
  /** For a bundle component: the bundle it came from. */
  partOf: string | null;
}

export interface PackSheet {
  order: {
    id: string;
    orderName: string;
    customerName: string | null;
    itemCount: number;
    destination: string | null;
    shippingMethod: string | null;
    documentStatus: string;
  };
  lines: PackLine[];
  settings: PackSettings;
  /** Latest pack outcome, if any. */
  lastEvent: { outcome: PackOutcome; deviceName: string; occurredAt: string; note: string | null } | null;
}

export async function loadPackSheet(shopId: string, orderId: string): Promise<PackSheet | null> {
  const [shop, order] = await Promise.all([
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { settingsJson: true } }),
    prisma.orderIndex.findFirst({
      where: { id: orderId, shopId },
      include: {
        lineItems: { orderBy: { position: "asc" } },
        packEvents: { orderBy: { occurredAt: "desc" }, take: 1 },
      },
    }),
  ]);
  if (!order) return null;

  const bundles = await prisma.bundleMap.findMany({ where: { shopId } });
  const byBundle = new Map<string, typeof bundles>();
  for (const b of bundles) byBundle.set(b.bundleSku, [...(byBundle.get(b.bundleSku) ?? []), b]);
  // Titles for components: borrow from any line item in the shop that has the SKU.
  const componentSkus = bundles.map((b) => b.componentSku);
  const known = componentSkus.length
    ? await prisma.orderLineItem.findMany({ where: { sku: { in: componentSkus }, order: { shopId } }, distinct: ["sku"], select: { sku: true, title: true, barcode: true, imageUrl: true } })
    : [];
  const knownBySku = new Map(known.map((k) => [k.sku as string, k]));

  const lines: PackLine[] = [];
  for (const li of order.lineItems) {
    const components = li.sku ? byBundle.get(li.sku) : undefined;
    if (components?.length) {
      for (const c of components) {
        const k = knownBySku.get(c.componentSku);
        lines.push({
          id: `${li.id}:${c.componentSku}`,
          title: c.componentTitle ?? k?.title ?? c.componentSku,
          variantTitle: null,
          sku: c.componentSku,
          barcode: k?.barcode ?? null,
          imageUrl: k?.imageUrl ?? null,
          quantity: li.quantity * c.quantity,
          partOf: li.title,
        });
      }
      continue;
    }
    lines.push({
      id: li.id,
      title: li.title,
      variantTitle: li.variantTitle && li.variantTitle !== "Default Title" ? li.variantTitle : null,
      sku: li.sku,
      barcode: li.barcode,
      imageUrl: li.imageUrl,
      quantity: li.quantity,
      partOf: null,
    });
  }

  const last = order.packEvents[0];
  return {
    order: {
      id: order.id,
      orderName: order.orderName,
      customerName: order.customerName,
      itemCount: order.itemCount,
      destination: [order.shippingCity, order.countryCode].filter(Boolean).join(", ") || null,
      shippingMethod: order.shippingMethod,
      documentStatus: order.documentStatus,
    },
    lines,
    settings: parseSettings(shop.settingsJson).pack,
    lastEvent: last ? { outcome: last.outcome as PackOutcome, deviceName: last.deviceName, occurredAt: last.occurredAt.toISOString(), note: last.note } : null,
  };
}

export interface PackInput {
  shopId: string;
  orderId: string;
  deviceName: string;
  /** Client-generated idempotency key; a retry with the same key is a no-op. */
  clientEventId: string;
  itemCount: number;
  weightGrams: number | null;
  client: GraphqlClient;
  now?: Date;
}

export type PackResult = { ok: true; already: boolean } | { ok: false; reason: "not-found" };

export async function packOrder(input: PackInput): Promise<PackResult> {
  const now = input.now ?? new Date();
  const order = await prisma.orderIndex.findFirst({ where: { id: input.orderId, shopId: input.shopId } });
  if (!order) return { ok: false, reason: "not-found" };

  // Same event again (retry, double tap, offline replay): nothing to do.
  if (await prisma.packEvent.findUnique({ where: { clientEventId: input.clientEventId } })) return { ok: true, already: true };
  // Already packed by any event: do not tag, count or write again.
  if (await prisma.packEvent.findFirst({ where: { orderId: order.id, outcome: "PACKED" } })) return { ok: true, already: true };

  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: input.shopId }, select: { settingsJson: true } });
  const { tagNames } = parseSettings(shop.settingsJson);

  await prisma.packEvent.create({
    data: {
      shopId: input.shopId,
      orderId: order.id,
      deviceName: input.deviceName,
      outcome: "PACKED",
      itemCount: input.itemCount,
      parcelWeightGrams: input.weightGrams,
      clientEventId: input.clientEventId,
      occurredAt: now,
    },
  });

  await addOrderTags(input.client, order.shopifyOrderId, [tagNames.packed]);
  await setOrderMetafields(input.client, order.shopifyOrderId, [
    { key: "packed", type: "json", value: JSON.stringify({ at: now.toISOString(), device: input.deviceName, items: input.itemCount }) },
    ...(input.weightGrams !== null ? [{ key: "parcel_weight_grams", type: "number_integer" as const, value: String(input.weightGrams) }] : []),
  ]);

  await prisma.orderIndex.update({
    where: { id: order.id },
    data: { documentStatus: "PACKED", lastPackedAt: now },
  });
  return { ok: true, already: false };
}

export interface FlagLine {
  lineId: string;
  title: string;
  outcome: Exclude<PackOutcome, "PACKED" | "WRONG_ITEM">;
  note: string;
}

export interface FlagInput {
  shopId: string;
  orderId: string;
  deviceName: string;
  clientEventId: string;
  lines: FlagLine[];
  client: GraphqlClient;
  now?: Date;
}

const OUTCOME_WORD: Record<FlagLine["outcome"], string> = { SHORT_PICK: "missing", DAMAGED: "damaged", SUBSTITUTED: "substituted" };

/** The honest path: the order goes to Needs review, never to Packed. */
export async function flagOrder(input: FlagInput): Promise<PackResult> {
  const now = input.now ?? new Date();
  if (input.lines.length === 0) throw new Error("Flag at least one line.");
  const order = await prisma.orderIndex.findFirst({ where: { id: input.orderId, shopId: input.shopId } });
  if (!order) return { ok: false, reason: "not-found" };
  if (await prisma.packEvent.findUnique({ where: { clientEventId: input.clientEventId } })) return { ok: true, already: true };

  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: input.shopId }, select: { settingsJson: true } });
  const { tagNames } = parseSettings(shop.settingsJson);

  await prisma.packEvent.createMany({
    data: input.lines.map((line, index) => ({
      shopId: input.shopId,
      orderId: order.id,
      deviceName: input.deviceName,
      outcome: line.outcome,
      note: `${line.title}: ${OUTCOME_WORD[line.outcome]}${line.note.trim() ? ` — ${line.note.trim()}` : ""}`,
      clientEventId: index === 0 ? input.clientEventId : `${input.clientEventId}:${index}`,
      occurredAt: now,
    })),
  });

  await addOrderTags(input.client, order.shopifyOrderId, [tagNames.needsReview]);
  await setOrderMetafields(input.client, order.shopifyOrderId, [
    {
      key: "needs_review",
      type: "json",
      value: JSON.stringify({ at: now.toISOString(), device: input.deviceName, lines: input.lines.map((l) => ({ title: l.title, problem: OUTCOME_WORD[l.outcome], note: l.note.trim() || null })) }),
    },
  ]);
  await prisma.orderIndex.update({ where: { id: order.id }, data: { documentStatus: "NEEDS_REVIEW" } });
  return { ok: true, already: false };
}

/** Record a wrong scan in strict mode so the history shows it. Never changes status. */
export async function recordWrongScan(shopId: string, orderId: string, deviceName: string, scanned: string, now: Date = new Date()): Promise<void> {
  await prisma.packEvent.create({
    data: { shopId, orderId, deviceName, outcome: "WRONG_ITEM", note: `Scanned ${scanned.slice(0, 60)}`, occurredAt: now },
  });
}
