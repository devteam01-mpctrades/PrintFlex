import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { zonedDayEnd, zonedDayStart } from "../period.server";
import { ORDER_DOCUMENT_STATUSES, type DocumentType, type OrderDocumentStatus } from "../types";

/**
 * The orders list: URL query string in, rows and counts out. Every filter
 * lives in the URL so a view is exactly its query string.
 */

import { MAX_BULK_ORDERS, PAGE_SIZE } from "./constants";

export { MAX_BULK_ORDERS, PAGE_SIZE };

export interface OrderFilters {
  q: string;
  fulfillment: string;
  docStatus: OrderDocumentStatus | "";
  country: string;
  shipping: string;
  tag: string;
  from: string;
  to: string;
  page: number;
}

const FILTER_KEYS = ["q", "fulfillment", "docStatus", "country", "shipping", "tag", "from", "to"] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function str(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? "").trim();
}

export function parseFilters(params: URLSearchParams): OrderFilters {
  const docStatus = str(params, "docStatus");
  const page = Number(params.get("page") ?? "1");
  const from = str(params, "from");
  const to = str(params, "to");
  return {
    q: str(params, "q"),
    fulfillment: str(params, "fulfillment").toUpperCase(),
    docStatus: (ORDER_DOCUMENT_STATUSES as readonly string[]).includes(docStatus)
      ? (docStatus as OrderDocumentStatus)
      : "",
    country: str(params, "country").toUpperCase(),
    shipping: str(params, "shipping"),
    tag: str(params, "tag"),
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The filter part of the query string, without paging, for view matching. */
export function filterQueryString(filters: OrderFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function hasActiveFilters(filters: OrderFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key] !== "");
}

/** "#1042" and "1042" both match the order named "#1042". */
function nameVariants(q: string): string[] {
  const bare = q.replace(/^#/, "");
  return bare ? [...new Set([q, bare, `#${bare}`])] : [];
}

export function buildWhere(
  shopId: string,
  filters: OrderFilters,
  timezone: string,
): Prisma.OrderIndexWhereInput {
  const and: Prisma.OrderIndexWhereInput[] = [{ shopId }];

  if (filters.fulfillment) and.push({ fulfillmentStatus: filters.fulfillment });
  if (filters.docStatus) and.push({ documentStatus: filters.docStatus });
  if (filters.country) and.push({ countryCode: filters.country });
  if (filters.shipping) and.push({ shippingMethod: filters.shipping });
  if (filters.tag) {
    // tagsJson is a JSON array of strings, so the quoted tag is a substring.
    and.push({ tagsJson: { contains: JSON.stringify(filters.tag) } });
  }
  if (filters.from) and.push({ shopifyCreatedAt: { gte: zonedDayStart(filters.from, timezone) } });
  if (filters.to) and.push({ shopifyCreatedAt: { lt: zonedDayEnd(filters.to, timezone) } });

  if (filters.q) {
    const q = filters.q;
    and.push({
      OR: [
        ...nameVariants(q).map((name) => ({ orderName: { contains: name } })),
        { customerName: { contains: q } },
        { customerEmail: { contains: q } },
        { lineItems: { some: { sku: { contains: q } } } },
      ],
    });
  }

  return { AND: and };
}

export interface OrderRow {
  id: string;
  /** Numeric part of the Shopify order GID, for links into the Shopify admin. */
  shopifyOrderNumber: string;
  orderName: string;
  customerName: string | null;
  countryCode: string | null;
  itemCount: number;
  totalAmount: string;
  currency: string;
  fulfillmentStatus: string;
  shippingMethod: string | null;
  tags: string[];
  documentStatus: OrderDocumentStatus;
  documents: DocumentType[];
  shopifyCreatedAt: string;
}

export interface OrderListResult {
  rows: OrderRow[];
  total: number;
  page: number;
  pageCount: number;
  /** Orders matching the filter whose status is Printed or Packed. */
  alreadyPrintedTotal: number;
  /** Set when the search text names exactly one order, e.g. a scanned barcode. */
  jumpToId: string | null;
}

export async function listOrders(
  shopId: string,
  filters: OrderFilters,
  timezone: string,
): Promise<OrderListResult> {
  const where = buildWhere(shopId, filters, timezone);
  const [total, alreadyPrintedTotal] = await Promise.all([
    prisma.orderIndex.count({ where }),
    prisma.orderIndex.count({
      where: { AND: [where, { documentStatus: { in: ["PRINTED", "PACKED"] } }] },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);

  const orders = await prisma.orderIndex.findMany({
    where,
    orderBy: [{ shopifyCreatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      shopifyOrderId: true,
      orderName: true,
      customerName: true,
      countryCode: true,
      itemCount: true,
      totalAmount: true,
      currency: true,
      fulfillmentStatus: true,
      shippingMethod: true,
      tagsJson: true,
      documentStatus: true,
      shopifyCreatedAt: true,
      documents: { select: { documentType: true }, distinct: ["documentType"] },
    },
  });

  let jumpToId: string | null = null;
  if (filters.q) {
    const variants = nameVariants(filters.q);
    const exact = orders.filter((o) => variants.includes(o.orderName));
    if (exact.length === 1) jumpToId = exact[0].id;
  }

  return {
    rows: orders.map((o) => ({
      id: o.id,
      shopifyOrderNumber: o.shopifyOrderId.split("/").pop() ?? "",
      orderName: o.orderName,
      customerName: o.customerName,
      countryCode: o.countryCode,
      itemCount: o.itemCount,
      totalAmount: o.totalAmount.toFixed(2),
      currency: o.currency,
      fulfillmentStatus: o.fulfillmentStatus,
      shippingMethod: o.shippingMethod,
      tags: parseTags(o.tagsJson),
      documentStatus: o.documentStatus as OrderDocumentStatus,
      documents: o.documents.map((d) => d.documentType as DocumentType),
      shopifyCreatedAt: o.shopifyCreatedAt.toISOString(),
    })),
    total,
    page,
    pageCount,
    alreadyPrintedTotal,
    jumpToId,
  };
}

function parseTags(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export interface OrderFacets {
  fulfillmentStatuses: string[];
  countries: string[];
  shippingMethods: string[];
  tags: string[];
}

/** Distinct values for the filter dropdowns, from this shop's orders only. */
export async function loadFacets(shopId: string): Promise<OrderFacets> {
  const [statuses, countries, shipping, tagRows] = await Promise.all([
    prisma.orderIndex.findMany({ where: { shopId }, distinct: ["fulfillmentStatus"], select: { fulfillmentStatus: true } }),
    prisma.orderIndex.findMany({ where: { shopId, countryCode: { not: null } }, distinct: ["countryCode"], select: { countryCode: true } }),
    prisma.orderIndex.findMany({ where: { shopId, shippingMethod: { not: null } }, distinct: ["shippingMethod"], select: { shippingMethod: true } }),
    prisma.orderIndex.findMany({ where: { shopId, NOT: { tagsJson: "[]" } }, distinct: ["tagsJson"], select: { tagsJson: true } }),
  ]);
  const tags = new Set<string>();
  for (const row of tagRows) for (const tag of parseTags(row.tagsJson)) tags.add(tag);
  return {
    fulfillmentStatuses: statuses.map((s) => s.fulfillmentStatus).sort(),
    countries: countries.flatMap((c) => (c.countryCode ? [c.countryCode] : [])).sort(),
    shippingMethods: shipping.flatMap((s) => (s.shippingMethod ? [s.shippingMethod] : [])).sort(),
    tags: [...tags].sort(),
  };
}

/** How a bulk action names its orders. */
export type SelectionSpec =
  | { mode: "ids"; ids: string[] }
  | { mode: "filter"; query: string; excludeIds: string[]; excludePrinted: boolean };

export function parseSelectionSpec(json: string): SelectionSpec {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid selection");
  const record = parsed as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  if (record.mode === "ids") return { mode: "ids", ids: strings(record.ids) };
  if (record.mode === "filter") {
    return {
      mode: "filter",
      query: typeof record.query === "string" ? record.query : "",
      excludeIds: strings(record.excludeIds),
      excludePrinted: record.excludePrinted === true,
    };
  }
  throw new Error("Invalid selection mode");
}

export interface ResolvedSelection {
  orders: Array<{ id: string; shopifyOrderId: string; documentStatus: OrderDocumentStatus }>;
  truncated: boolean;
}

/** Turn a selection spec into concrete orders belonging to this shop. */
export async function resolveSelection(
  shopId: string,
  spec: SelectionSpec,
  timezone: string,
): Promise<ResolvedSelection> {
  let where: Prisma.OrderIndexWhereInput;
  if (spec.mode === "ids") {
    where = { shopId, id: { in: spec.ids } };
  } else {
    const filters = parseFilters(new URLSearchParams(spec.query));
    const and: Prisma.OrderIndexWhereInput[] = [buildWhere(shopId, filters, timezone)];
    if (spec.excludeIds.length) and.push({ id: { notIn: spec.excludeIds } });
    if (spec.excludePrinted) and.push({ documentStatus: { notIn: ["PRINTED", "PACKED"] } });
    where = { AND: and };
  }
  const rows = await prisma.orderIndex.findMany({
    where,
    orderBy: [{ shopifyCreatedAt: "asc" }],
    take: MAX_BULK_ORDERS + 1,
    select: { id: true, shopifyOrderId: true, documentStatus: true },
  });
  const truncated = rows.length > MAX_BULK_ORDERS;
  return {
    orders: rows.slice(0, MAX_BULK_ORDERS).map((r) => ({
      ...r,
      documentStatus: r.documentStatus as OrderDocumentStatus,
    })),
    truncated,
  };
}
