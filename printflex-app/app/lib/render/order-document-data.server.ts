import { runGraphql, waitForBudget, type GraphqlClient, type ThrottleStatus } from "../graphql.server";

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
  hsCode: string | null;
  countryOfOrigin: string | null;
  /** Unit weight in grams, when Shopify knows it. */
  weightGrams: number | null;
}

export interface OrderDocumentData {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string;
  note: string | null;
  /** Note attributes, e.g. a gift message captured at checkout. */
  attributes: Array<{ key: string; value: string }>;
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

/** Line items per order in one query. Bigger orders are completed with a follow-up page. */
export const LINE_ITEMS_PER_ORDER = 30;
/** Orders per bulk query: keeps a query under ~1000 cost points. */
export const ORDERS_PER_QUERY = 10;

export const ORDER_DOCUMENT_FRAGMENT = `#graphql
  fragment PrintFlexOrderDocumentFields on Order {
    id
    name
    createdAt
    processedAt
    note
    customAttributes { key value }
    email
    phone
    taxesIncluded
    displayFinancialStatus
    displayFulfillmentStatus
    billingAddress { ${ADDRESS} }
    shippingAddress { ${ADDRESS} }
    shippingLine { title }
    currentSubtotalPriceSet { ${MONEY} }
    currentTotalDiscountsSet { ${MONEY} }
    currentShippingPriceSet { ${MONEY} }
    currentTotalTaxSet { ${MONEY} }
    currentTotalPriceSet { ${MONEY} }
    taxLines { title ratePercentage priceSet { ${MONEY} } }
    lineItems(first: ${LINE_ITEMS_PER_ORDER}) {
      pageInfo { hasNextPage endCursor }
      nodes { ...PrintFlexLineItemFields }
    }
  }
  fragment PrintFlexLineItemFields on LineItem {
    title
    variantTitle
    sku
    currentQuantity
    originalUnitPriceSet { ${MONEY} }
    discountedTotalSet { ${MONEY} }
    originalTotalSet { ${MONEY} }
    image { url(transform: { maxWidth: 200, maxHeight: 200 }) }
    variant {
      inventoryItem {
        harmonizedSystemCode
        countryCodeOfOrigin
        measurement { weight { value unit } }
      }
    }
  }
`;

const SHOP_FIELDS = `shop { name contactEmail billingAddress { ${ADDRESS} } }`;

export const ORDER_DOCUMENT_QUERY = `#graphql
  ${ORDER_DOCUMENT_FRAGMENT}
  query PrintFlexOrderDocument($id: ID!) {
    ${SHOP_FIELDS}
    order(id: $id) { ...PrintFlexOrderDocumentFields }
  }
`;

export const ORDERS_DOCUMENT_QUERY = `#graphql
  ${ORDER_DOCUMENT_FRAGMENT}
  query PrintFlexOrdersDocument($ids: [ID!]!) {
    ${SHOP_FIELDS}
    nodes(ids: $ids) { ...PrintFlexOrderDocumentFields }
  }
`;

export const MORE_LINE_ITEMS_QUERY = `#graphql
  query PrintFlexMoreLineItems($id: ID!, $after: String!) {
    order(id: $id) {
      lineItems(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          title
          variantTitle
          sku
          currentQuantity
          originalUnitPriceSet { ${MONEY} }
          discountedTotalSet { ${MONEY} }
          originalTotalSet { ${MONEY} }
          image { url(transform: { maxWidth: 200, maxHeight: 200 }) }
          variant {
            inventoryItem {
              harmonizedSystemCode
              countryCodeOfOrigin
              measurement { weight { value unit } }
            }
          }
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

export interface RawLineItem {
  title: string;
  variantTitle: string | null;
  sku: string | null;
  currentQuantity: number;
  originalUnitPriceSet: RawMoneyBag;
  discountedTotalSet: RawMoneyBag;
  originalTotalSet: RawMoneyBag;
  image: { url: string } | null;
  variant?: {
    inventoryItem: {
      harmonizedSystemCode: string | null;
      countryCodeOfOrigin: string | null;
      measurement: { weight: { value: number; unit: string } | null } | null;
    } | null;
  } | null;
}

const GRAMS: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.3495, POUNDS: 453.592 };

function toGrams(weight: { value: number; unit: string } | null | undefined): number | null {
  if (!weight) return null;
  const factor = GRAMS[weight.unit];
  return factor ? Math.round(weight.value * factor) : null;
}

export interface RawShop {
  name: string;
  contactEmail: string | null;
  billingAddress: RawAddress | null;
}

export interface RawOrder {
    id: string;
    name: string;
    createdAt: string;
    processedAt: string;
    note: string | null;
    customAttributes?: Array<{ key: string; value: string | null }>;
    email: string | null;
    phone: string | null;
    taxesIncluded: boolean;
    displayFinancialStatus: string | null;
    displayFulfillmentStatus: string;
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
      pageInfo?: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawLineItem[];
    };
}

export interface OrderDocumentQueryData {
  shop: RawShop;
  order: RawOrder | null;
}

interface OrdersDocumentQueryData {
  shop: RawShop;
  nodes: Array<RawOrder | null>;
}

interface MoreLineItemsData {
  order: { lineItems: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawLineItem[] } } | null;
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
  return data.order ? mapOrder(data.order, data.shop) : null;
}

export function mapOrder(o: RawOrder, shop: RawShop): OrderDocumentData {
  const total = money(o.currentTotalPriceSet);
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    processedAt: o.processedAt,
    note: o.note,
    attributes: (o.customAttributes ?? [])
      .filter((a): a is { key: string; value: string } => typeof a.value === "string" && a.value.trim().length > 0)
      .map((a) => ({ key: a.key, value: a.value })),
    email: o.email,
    phone: o.phone ?? o.shippingAddress?.phone ?? o.billingAddress?.phone ?? null,
    customerName: o.billingAddress?.name ?? o.shippingAddress?.name ?? null,
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
          hsCode: li.variant?.inventoryItem?.harmonizedSystemCode ?? null,
          countryOfOrigin: li.variant?.inventoryItem?.countryCodeOfOrigin ?? null,
          weightGrams: toGrams(li.variant?.inventoryItem?.measurement?.weight),
        };
      }),
    subtotal: money(o.currentSubtotalPriceSet),
    totalDiscounts: money(o.currentTotalDiscountsSet),
    shipping: money(o.currentShippingPriceSet),
    totalTax: money(o.currentTotalTaxSet),
    taxLines: o.taxLines.map((t) => ({ title: t.title, ratePercentage: t.ratePercentage, amount: money(t.priceSet) })),
    total,
    seller: {
      name: shop.name,
      email: shop.contactEmail,
      address: shop.billingAddress,
    },
  };
}

async function completeLineItems(client: GraphqlClient, order: RawOrder): Promise<RawOrder> {
  let pageInfo = order.lineItems.pageInfo;
  const nodes = [...order.lineItems.nodes];
  while (pageInfo?.hasNextPage && pageInfo.endCursor) {
    const { data } = await runGraphql<MoreLineItemsData>(client, MORE_LINE_ITEMS_QUERY, {
      id: order.id,
      after: pageInfo.endCursor,
    });
    if (!data.order) break;
    nodes.push(...data.order.lineItems.nodes);
    pageInfo = data.order.lineItems.pageInfo;
  }
  return { ...order, lineItems: { nodes } };
}

export async function fetchOrderDocumentData(
  client: GraphqlClient,
  orderGid: string,
): Promise<OrderDocumentData | null> {
  const { data } = await runGraphql<OrderDocumentQueryData>(client, ORDER_DOCUMENT_QUERY, { id: orderGid });
  if (!data.order) return null;
  return mapOrder(await completeLineItems(client, data.order), data.shop);
}

/** Estimated cost of one bulk query, used to pace against the API budget. */
const BULK_QUERY_COST = ORDERS_PER_QUERY * (LINE_ITEMS_PER_ORDER + 8) + 10;

/**
 * Fetch many orders in as few queries as the cost budget allows. Orders that
 * no longer exist are simply absent from the result.
 */
export async function fetchOrdersDocumentData(
  client: GraphqlClient,
  orderGids: readonly string[],
  onProgress?: (fetched: number) => void,
): Promise<Map<string, OrderDocumentData>> {
  const result = new Map<string, OrderDocumentData>();
  let throttle: ThrottleStatus | null = null;
  for (let i = 0; i < orderGids.length; i += ORDERS_PER_QUERY) {
    const chunk = orderGids.slice(i, i + ORDERS_PER_QUERY);
    await waitForBudget(throttle, BULK_QUERY_COST);
    const response = await runGraphql<OrdersDocumentQueryData>(client, ORDERS_DOCUMENT_QUERY, { ids: chunk });
    throttle = response.throttle;
    for (const raw of response.data.nodes) {
      if (!raw) continue;
      result.set(raw.id, mapOrder(await completeLineItems(client, raw), response.data.shop));
    }
    onProgress?.(Math.min(orderGids.length, i + chunk.length));
  }
  return result;
}
