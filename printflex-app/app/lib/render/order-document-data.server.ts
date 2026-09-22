import type { GraphqlClient } from "../graphql.server";
import { runGraphql } from "../graphql.server";

/**
 * Everything a document needs about one order, fetched from Shopify at
 * render time so amounts and taxes are exactly what Shopify reports now.
 * Nothing here is persisted.
 */

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface Address {
  name: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
}

export interface TaxLine {
  title: string;
  ratePercentage: number | null;
  amount: Money;
}

export interface DocumentLineItem {
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: Money;
  lineDiscount: Money;
  lineTotal: Money;
  imageUrl: string | null;
}

export interface OrderDocumentData {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string;
  note: string | null;
  email: string | null;
  phone: string | null;
  customerName: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string;
  taxesIncluded: boolean;
  currency: string;
  billingAddress: Address | null;
  shippingAddress: Address | null;
  shippingMethod: string | null;
  lineItems: DocumentLineItem[];
  subtotal: Money;
  totalDiscounts: Money;
  shipping: Money;
  totalTax: Money;
  taxLines: TaxLine[];
  total: Money;
  seller: Seller;
}

export interface Seller {
  name: string;
  email: string | null;
  address: Address | null;
}

const MONEY = `presentmentMoney { amount currencyCode }`;
const ADDRESS = `name company address1 address2 city province zip country phone`;

export const ORDER_DOCUMENT_QUERY = `#graphql
  query PrintFlexOrderDocument($id: ID!) {
    shop {
      name
      contactEmail
      billingAddress { ${ADDRESS} }
    }
    order(id: $id) {
      id
      name
      createdAt
      processedAt
      note
      email
      phone
      taxesIncluded
      displayFinancialStatus
      displayFulfillmentStatus
      customer { displayName }
      billingAddress { ${ADDRESS} }
      shippingAddress { ${ADDRESS} }
      shippingLine { title }
      currentSubtotalPriceSet { ${MONEY} }
      currentTotalDiscountsSet { ${MONEY} }
      currentShippingPriceSet { ${MONEY} }
      currentTotalTaxSet { ${MONEY} }
      currentTotalPriceSet { ${MONEY} }
      taxLines { title ratePercentage priceSet { ${MONEY} } }
      lineItems(first: 100) {
        nodes {
          title
          variantTitle
          sku
          currentQuantity
          originalUnitPriceSet { ${MONEY} }
          discountedTotalSet { ${MONEY} }
          originalTotalSet { ${MONEY} }
          image { url(transform: { maxWidth: 200, maxHeight: 200 }) }
        }
      }
    }
  }
`;

interface RawMoneyBag {
  presentmentMoney: Money;
}

interface RawAddress {
  name: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
}

export interface OrderDocumentQueryData {
  shop: { name: string; contactEmail: string | null; billingAddress: RawAddress | null };
  order: {
    id: string;
    name: string;
    createdAt: string;
    processedAt: string;
    note: string | null;
    email: string | null;
    phone: string | null;
    taxesIncluded: boolean;
    displayFinancialStatus: string | null;
    displayFulfillmentStatus: string;
    customer: { displayName: string } | null;
    billingAddress: RawAddress | null;
    shippingAddress: RawAddress | null;
    shippingLine: { title: string } | null;
    currentSubtotalPriceSet: RawMoneyBag;
    currentTotalDiscountsSet: RawMoneyBag;
    currentShippingPriceSet: RawMoneyBag;
    currentTotalTaxSet: RawMoneyBag;
    currentTotalPriceSet: RawMoneyBag;
    taxLines: Array<{ title: string; ratePercentage: number | null; priceSet: RawMoneyBag }>;
    lineItems: {
      nodes: Array<{
        title: string;
        variantTitle: string | null;
        sku: string | null;
        currentQuantity: number;
        originalUnitPriceSet: RawMoneyBag;
        discountedTotalSet: RawMoneyBag;
        originalTotalSet: RawMoneyBag;
        image: { url: string } | null;
      }>;
    };
  } | null;
}

function money(bag: RawMoneyBag): Money {
  return { amount: bag.presentmentMoney.amount, currencyCode: bag.presentmentMoney.currencyCode };
}

function subtractMoney(a: Money, b: Money): Money {
  const cents = Math.round(Number(a.amount) * 100) - Math.round(Number(b.amount) * 100);
  return { amount: (cents / 100).toFixed(2), currencyCode: a.currencyCode };
}

/** Pure mapping from the query result to document data. */
export function mapOrderDocumentData(data: OrderDocumentQueryData): OrderDocumentData | null {
  const o = data.order;
  if (!o) return null;
  const total = money(o.currentTotalPriceSet);
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    processedAt: o.processedAt,
    note: o.note,
    email: o.email,
    phone: o.phone ?? o.shippingAddress?.phone ?? o.billingAddress?.phone ?? null,
    customerName: o.customer?.displayName ?? o.billingAddress?.name ?? o.shippingAddress?.name ?? null,
    financialStatus: o.displayFinancialStatus,
    fulfillmentStatus: o.displayFulfillmentStatus,
    taxesIncluded: o.taxesIncluded,
    currency: total.currencyCode,
    billingAddress: o.billingAddress,
    shippingAddress: o.shippingAddress,
    shippingMethod: o.shippingLine?.title ?? null,
    lineItems: o.lineItems.nodes
      .filter((li) => li.currentQuantity > 0)
      .map((li) => {
        const lineTotal = money(li.discountedTotalSet);
        return {
          title: li.title,
          variantTitle: li.variantTitle,
          sku: li.sku,
          quantity: li.currentQuantity,
          unitPrice: money(li.originalUnitPriceSet),
          lineDiscount: subtractMoney(money(li.originalTotalSet), lineTotal),
          lineTotal,
          imageUrl: li.image?.url ?? null,
        };
      }),
    subtotal: money(o.currentSubtotalPriceSet),
    totalDiscounts: money(o.currentTotalDiscountsSet),
    shipping: money(o.currentShippingPriceSet),
    totalTax: money(o.currentTotalTaxSet),
    taxLines: o.taxLines.map((t) => ({ title: t.title, ratePercentage: t.ratePercentage, amount: money(t.priceSet) })),
    total,
    seller: {
      name: data.shop.name,
      email: data.shop.contactEmail,
      address: data.shop.billingAddress,
    },
  };
}

export async function fetchOrderDocumentData(
  client: GraphqlClient,
  orderGid: string,
): Promise<OrderDocumentData | null> {
  const { data } = await runGraphql<OrderDocumentQueryData>(client, ORDER_DOCUMENT_QUERY, { id: orderGid });
  return mapOrderDocumentData(data);
}
