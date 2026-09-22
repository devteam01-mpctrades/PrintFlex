import type { OrderNode } from "./order-query.server";

/** The subset of an order that OrderIndex stores. */
export interface OrderSnapshot {
  shopifyOrderId: string;
  orderName: string;
  customerName: string | null;
  customerEmail: string | null;
  countryCode: string | null;
  shippingCity: string | null;
  itemCount: number;
  totalAmount: string;
  currency: string;
  fulfillmentStatus: string;
  financialStatus: string | null;
  shippingMethod: string | null;
  tags: string[];
  shopifyCreatedAt: Date;
  shopifyUpdatedAt: Date;
  cancelledAt: Date | null;
  lineItems: LineItemSnapshot[];
}

export interface LineItemSnapshot {
  shopifyLineItemId: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  variantId: string | null;
  productId: string | null;
  imageUrl: string | null;
  position: number;
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function mapOrderNode(node: OrderNode): OrderSnapshot {
  const money = node.currentTotalPriceSet.presentmentMoney;
  return {
    shopifyOrderId: node.id,
    orderName: node.name,
    customerName:
      blankToNull(node.customer?.displayName) ?? blankToNull(node.shippingAddress?.name),
    customerEmail: blankToNull(node.customer?.email) ?? blankToNull(node.email),
    countryCode: blankToNull(node.shippingAddress?.countryCodeV2),
    shippingCity: blankToNull(node.shippingAddress?.city),
    itemCount: node.currentSubtotalLineItemsQuantity,
    totalAmount: money.amount,
    currency: money.currencyCode,
    fulfillmentStatus: node.displayFulfillmentStatus,
    financialStatus: blankToNull(node.displayFinancialStatus),
    shippingMethod: blankToNull(node.shippingLine?.title),
    tags: node.tags.map((t) => t.trim()).filter((t) => t.length > 0),
    shopifyCreatedAt: new Date(node.createdAt),
    shopifyUpdatedAt: new Date(node.updatedAt),
    cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
    lineItems: node.lineItems.nodes.map((item, position) => ({
      shopifyLineItemId: item.id,
      title: item.title,
      variantTitle: blankToNull(item.variantTitle),
      sku: blankToNull(item.sku),
      quantity: item.quantity,
      variantId: item.variant?.id ?? null,
      productId: item.product?.id ?? null,
      imageUrl: item.image?.url ?? null,
      position,
    })),
  };
}
