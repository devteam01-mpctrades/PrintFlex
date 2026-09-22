import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import type { GraphqlClient, ThrottleStatus } from "../graphql.server";
import { runGraphql, waitForBudget } from "../graphql.server";
import { parseSettings, type TagNames } from "../settings.server";
import type { OrderDocumentStatus } from "../types";
import { mapOrderNode, type OrderSnapshot } from "./order-mapper.server";
import {
  ORDER_BY_ID_QUERY,
  ORDER_ID_BY_NAME_QUERY,
  ORDERS_PAGE_QUERY,
  type OrderByIdData,
  type OrderIdByNameData,
  type OrdersPageData,
} from "./order-query.server";

export type ApplyOutcome = "created" | "updated" | "stale";

/**
 * A brand-new row takes its status from the tags PrintFlex writes, so a
 * reinstall recovers what was already printed or packed. Existing rows keep
 * the status the app set; sync never recomputes it.
 */
export function initialStatusFromTags(
  tags: readonly string[],
  tagNames: TagNames,
): OrderDocumentStatus {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  if (set.has(tagNames.needsReview.toLowerCase())) return "NEEDS_REVIEW";
  if (set.has(tagNames.packed.toLowerCase())) return "PACKED";
  if (set.has(tagNames.printed.toLowerCase())) return "PRINTED";
  return "NEW";
}

function toUpdateData(snapshot: OrderSnapshot) {
  return {
    orderName: snapshot.orderName,
    customerName: snapshot.customerName,
    customerEmail: snapshot.customerEmail,
    countryCode: snapshot.countryCode,
    itemCount: snapshot.itemCount,
    totalAmount: new Prisma.Decimal(snapshot.totalAmount),
    currency: snapshot.currency,
    fulfillmentStatus: snapshot.fulfillmentStatus,
    financialStatus: snapshot.financialStatus,
    shippingMethod: snapshot.shippingMethod,
    tagsJson: JSON.stringify(snapshot.tags),
    shopifyCreatedAt: snapshot.shopifyCreatedAt,
    shopifyUpdatedAt: snapshot.shopifyUpdatedAt,
    cancelledAt: snapshot.cancelledAt,
  };
}

/**
 * Write a snapshot into OrderIndex unless a newer one is already there.
 * The guard is Shopify's own updatedAt, compared inside the UPDATE, so two
 * webhooks arriving out of order cannot leave the older payload in place.
 */
export async function applyOrderSnapshot(
  shopId: string,
  snapshot: OrderSnapshot,
  tagNames: TagNames,
): Promise<ApplyOutcome> {
  const data = toUpdateData(snapshot);

  const updated = await prisma.orderIndex.updateMany({
    where: {
      shopId,
      shopifyOrderId: snapshot.shopifyOrderId,
      shopifyUpdatedAt: { lte: snapshot.shopifyUpdatedAt },
    },
    data,
  });

  const existing = await prisma.orderIndex.findUnique({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId: snapshot.shopifyOrderId } },
    select: { id: true },
  });

  if (updated.count > 0 && existing) {
    await replaceLineItems(existing.id, snapshot);
    return "updated";
  }
  if (existing) return "stale";

  try {
    const created = await prisma.orderIndex.create({
      data: {
        shopId,
        shopifyOrderId: snapshot.shopifyOrderId,
        documentStatus: initialStatusFromTags(snapshot.tags, tagNames),
        ...data,
      },
    });
    await replaceLineItems(created.id, snapshot);
    return "created";
  } catch (error) {
    // Lost a race with a concurrent insert for the same order: apply as an update.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const retry = await prisma.orderIndex.updateMany({
        where: {
          shopId,
          shopifyOrderId: snapshot.shopifyOrderId,
          shopifyUpdatedAt: { lte: snapshot.shopifyUpdatedAt },
        },
        data,
      });
      if (retry.count > 0) {
        const row = await prisma.orderIndex.findUniqueOrThrow({
          where: { shopId_shopifyOrderId: { shopId, shopifyOrderId: snapshot.shopifyOrderId } },
          select: { id: true },
        });
        await replaceLineItems(row.id, snapshot);
        return "updated";
      }
      return "stale";
    }
    throw error;
  }
}

async function replaceLineItems(orderId: string, snapshot: OrderSnapshot): Promise<void> {
  await prisma.$transaction([
    prisma.orderLineItem.deleteMany({ where: { orderId } }),
    prisma.orderLineItem.createMany({
      data: snapshot.lineItems.map((item) => ({ orderId, ...item })),
    }),
  ]);
}

async function tagNamesForShop(shopId: string): Promise<TagNames> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { settingsJson: true },
  });
  return parseSettings(shop.settingsJson).tagNames;
}

export type SyncOrderOutcome = ApplyOutcome | "missing";

/** Re-fetch one order from Shopify and apply it. */
export async function syncOrderById(
  client: GraphqlClient,
  shopId: string,
  shopifyOrderId: string,
): Promise<SyncOrderOutcome> {
  const { data } = await runGraphql<OrderByIdData>(client, ORDER_BY_ID_QUERY, {
    id: shopifyOrderId,
  });
  if (!data.order) return "missing";
  const tagNames = await tagNamesForShop(shopId);
  return applyOrderSnapshot(shopId, mapOrderNode(data.order), tagNames);
}

/** Look up an order's id by its name, with or without the leading "#". */
export async function findOrderIdByName(
  client: GraphqlClient,
  orderName: string,
): Promise<string | null> {
  const bare = orderName.trim().replace(/^#/, "");
  if (!bare) return null;
  const { data } = await runGraphql<OrderIdByNameData>(client, ORDER_ID_BY_NAME_QUERY, {
    query: `name:${bare}`,
  });
  return data.orders.nodes[0]?.id ?? null;
}

export interface BackfillSummary {
  pages: number;
  seen: number;
  created: number;
  updated: number;
  stale: number;
}

const PAGE_SIZE = 20;
/** Conservative estimate of one page's cost (20 orders × up to 50 line items). */
const ESTIMATED_PAGE_COST = 700;

/**
 * Walk every order Shopify will return (the last 60 days without the
 * read_all_orders scope), oldest update first, pacing requests against the
 * API cost budget.
 */
export async function backfillOrders(
  client: GraphqlClient,
  shopId: string,
  options: { updatedSince?: Date } = {},
): Promise<BackfillSummary> {
  const tagNames = await tagNamesForShop(shopId);
  const summary: BackfillSummary = { pages: 0, seen: 0, created: 0, updated: 0, stale: 0 };
  const query = options.updatedSince
    ? `updated_at:>='${options.updatedSince.toISOString()}'`
    : null;

  let after: string | null = null;
  let throttle: ThrottleStatus | null = null;

  do {
    await waitForBudget(throttle, ESTIMATED_PAGE_COST);
    const result: Awaited<ReturnType<typeof runGraphql<OrdersPageData>>> = await runGraphql<OrdersPageData>(client, ORDERS_PAGE_QUERY, {
      first: PAGE_SIZE,
      after,
      query,
    });
    throttle = result.throttle;
    summary.pages += 1;

    for (const node of result.data.orders.nodes) {
      summary.seen += 1;
      const outcome = await applyOrderSnapshot(shopId, mapOrderNode(node), tagNames);
      summary[outcome] += 1;
    }

    after = result.data.orders.pageInfo.hasNextPage
      ? result.data.orders.pageInfo.endCursor
      : null;
  } while (after);

  return summary;
}
