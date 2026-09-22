import prisma from "../../db.server";
import { tokenFromScan } from "./token-parse";

/**
 * Resolve what a scanner or a person typed to an order. Accepts "#KS-10236",
 * "KS-10236", "10236" and a full scan URL. A full URL is returned as such so
 * the caller can follow it (its token carries the authorisation).
 */

export type LookupResult =
  | { kind: "url"; token: string }
  | { kind: "order"; orderId: string }
  | { kind: "ambiguous"; candidates: Array<{ id: string; orderName: string }> }
  | { kind: "none" };

export { tokenFromScan } from "./token-parse";

export async function lookupOrder(shopId: string, raw: string): Promise<LookupResult> {
  const value = raw.trim();
  if (!value) return { kind: "none" };
  const token = tokenFromScan(value);
  if (token) return { kind: "url", token };

  const bare = value.replace(/^#/, "");
  const exact = await prisma.orderIndex.findMany({
    where: { shopId, orderName: { in: [value, bare, `#${bare}`] } },
    select: { id: true, orderName: true },
    take: 2,
  });
  if (exact.length === 1) return { kind: "order", orderId: exact[0].id };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  // Digits only: match the trailing number of any order name (#KS-10236 ← 10236).
  if (/^\d+$/.test(bare)) {
    const ending = await prisma.orderIndex.findMany({
      where: { shopId, orderName: { endsWith: bare } },
      select: { id: true, orderName: true },
      take: 5,
    });
    const strict = ending.filter((o) => new RegExp(`(^|\\D)${bare}$`).test(o.orderName));
    if (strict.length === 1) return { kind: "order", orderId: strict[0].id };
    if (strict.length > 1) return { kind: "ambiguous", candidates: strict };
  }
  return { kind: "none" };
}

export interface OrderSummary {
  id: string;
  orderName: string;
  customerName: string | null;
  itemCount: number;
  destination: string | null;
  shippingMethod: string | null;
  documentStatus: string;
  fulfillmentStatus: string;
}

export async function loadOrderSummary(shopId: string, orderId: string): Promise<OrderSummary | null> {
  const order = await prisma.orderIndex.findFirst({
    where: { id: orderId, shopId },
    select: { id: true, orderName: true, customerName: true, itemCount: true, shippingCity: true, countryCode: true, shippingMethod: true, documentStatus: true, fulfillmentStatus: true },
  });
  if (!order) return null;
  const country = order.countryCode ? countryName(order.countryCode) : null;
  return {
    id: order.id,
    orderName: order.orderName,
    customerName: order.customerName,
    itemCount: order.itemCount,
    destination: [order.shippingCity, country].filter(Boolean).join(", ") || null,
    shippingMethod: order.shippingMethod,
    documentStatus: order.documentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
  };
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
