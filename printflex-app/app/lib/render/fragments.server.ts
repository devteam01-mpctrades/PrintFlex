import type { TemplateSettings } from "../templates/templates.server";
import type { BarcodeBlock } from "./codes.server";
import { escapeHtml, escapeMultiline, formatDate, formatMoney } from "./html.server";
import type { Address, OrderDocumentData } from "./order-document-data.server";
import { articleStyle } from "./document-css.server";

/**
 * Document fragments. Each function returns one <article class="doc"> for
 * one sheet (or run of sheets). wrapDocument (batch-html.server.ts) turns a
 * list of fragments into a printable HTML document.
 */

export interface Codes {
  qr?: string;
  barcode?: BarcodeBlock;
}

export interface FragmentContext {
  settings: TemplateSettings;
  timezone: string;
  codes?: Codes;
}

const STATUS_LABEL: Record<string, string> = {
  PAID: "Paid",
  PENDING: "Payment pending",
  AUTHORIZED: "Authorized",
  PARTIALLY_PAID: "Partially paid",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
  VOIDED: "Voided",
  EXPIRED: "Expired",
};

export function addressLines(address: Address | null, fallbackName: string | null): string[] {
  if (!address) return fallbackName ? [fallbackName] : [];
  const cityLine = [address.zip, address.city].filter(Boolean).join(" ");
  return [
    address.name ?? fallbackName,
    address.company,
    address.address1,
    address.address2,
    [cityLine, address.province].filter(Boolean).join(", "),
    address.country,
  ].filter((line): line is string => Boolean(line && line.trim()));
}

function party(title: string, lines: string[]): string {
  return `<section class="party"><h3>${escapeHtml(title)}</h3>${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</section>`;
}

export function codesHtml(codes: Codes | undefined, settings: TemplateSettings): string {
  if (!codes) return "";
  const parts: string[] = [];
  if (settings.codes.qr && codes.qr) parts.push(`<div class="code qr">${codes.qr}</div>`);
  if (settings.codes.barcode && codes.barcode) {
    const value = settings.fields.barcodeValue ? `<div class="value">${escapeHtml(codes.barcode.value)}</div>` : "";
    parts.push(`<div class="code barcode">${codes.barcode.svg}${value}</div>`);
  }
  return parts.join("");
}

function grams(value: number | null): string {
  if (value === null) return "";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kg` : `${value} g`;
}

/** Optional customs/logistics columns shared by invoice and packing slip. */
function extraColumns(settings: TemplateSettings, items: OrderDocumentData["lineItems"]) {
  const f = settings.fields;
  const cols: Array<{ head: string; cell: (li: OrderDocumentData["lineItems"][number]) => string }> = [];
  if (f.hsCode && items.some((li) => li.hsCode)) cols.push({ head: "HS code", cell: (li) => `<td class="mono">${escapeHtml(li.hsCode ?? "")}</td>` });
  if (f.countryOfOrigin && items.some((li) => li.countryOfOrigin)) cols.push({ head: "Origin", cell: (li) => `<td class="mono">${escapeHtml(li.countryOfOrigin ?? "")}</td>` });
  if (f.weight && items.some((li) => li.weightGrams !== null)) cols.push({ head: "Weight", cell: (li) => `<td class="num">${li.weightGrams === null ? "" : grams(li.weightGrams * li.quantity)}</td>` });
  return cols;
}

function brandHtml(order: OrderDocumentData, settings: TemplateSettings, title: string): string {
  return `<div class="brand">
      ${settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="">` : ""}
      <div><div class="name">${escapeHtml(order.seller.name)}</div><h1>${escapeHtml(title)}</h1></div>
    </div>`;
}

function variantLabel(title: string, variantTitle: string | null): string {
  return variantTitle && variantTitle !== "Default Title"
    ? `${escapeHtml(title)} <span class="variant">${escapeHtml(variantTitle)}</span>`
    : escapeHtml(title);
}

function giftMessage(order: OrderDocumentData): string | null {
  const attr = order.attributes.find((a) => /gift/i.test(a.key));
  return attr?.value ?? null;
}

// ---------------------------------------------------------------- Invoice

export interface InvoiceFragmentInput extends FragmentContext {
  order: OrderDocumentData;
  invoiceNumber: string;
  invoiceDate: string;
}

export function renderInvoiceFragment(input: InvoiceFragmentInput): string {
  const { order, settings, timezone } = input;
  const f = settings.fields;
  const money = (m: { amount: string; currencyCode: string }) => formatMoney(m.amount, m.currencyCode);

  const sellerLines = [order.seller.name, ...addressLines(order.seller.address, null).slice(1)];
  if (order.seller.email) sellerLines.push(order.seller.email);
  const buyerLines = addressLines(order.billingAddress ?? order.shippingAddress, order.customerName);
  if (f.customerEmail && order.email) buyerLines.push(order.email);
  if (f.customerPhone && order.phone) buyerLines.push(order.phone);
  const shipToLines = order.shippingAddress && order.billingAddress ? addressLines(order.shippingAddress, order.customerName) : [];

  const showDiscountCol = f.lineDiscounts && order.lineItems.some((li) => Number(li.lineDiscount.amount) > 0);
  const extras = extraColumns(settings, order.lineItems);
  const rows = order.lineItems
    .map(
      (li) => `<tr>
        <td class="item">${variantLabel(li.title, li.variantTitle)}</td>
        ${f.sku ? `<td class="mono">${escapeHtml(li.sku ?? "")}</td>` : ""}
        ${extras.map((c) => c.cell(li)).join("")}
        <td class="num">${li.quantity}</td>
        ${f.unitPrices ? `<td class="num">${money(li.unitPrice)}</td>` : ""}
        ${showDiscountCol ? `<td class="num">${Number(li.lineDiscount.amount) > 0 ? `−${money(li.lineDiscount)}` : ""}</td>` : ""}
        <td class="num">${money(li.lineTotal)}</td>
      </tr>`,
    )
    .join("");

  const taxRows =
    f.taxBreakdown && order.taxLines.length > 0
      ? order.taxLines
          .map(
            (t) =>
              `<tr><th>${escapeHtml(t.title)}${t.ratePercentage !== null ? ` (${t.ratePercentage}%)` : ""}${order.taxesIncluded ? " incl." : ""}</th><td>${money(t.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><th>Tax${order.taxesIncluded ? " (included)" : ""}</th><td>${money(order.totalTax)}</td></tr>`;

  const paymentStatus = order.financialStatus ? (STATUS_LABEL[order.financialStatus] ?? order.financialStatus) : null;
  const codes = codesHtml(input.codes, settings);
  const inHeader = settings.codes.position === "header" ? codes : "";
  const inFooter = settings.codes.position === "footer" ? codes : "";

  return `<article class="doc invoice" style="${articleStyle(settings)}">
  <header>
    ${brandHtml(order, settings, "Invoice")}
    <div class="codes">${inHeader}</div>
    <div class="meta">
      <table>
        <tr><th>Invoice no.</th><td>${escapeHtml(input.invoiceNumber)}</td></tr>
        <tr><th>Invoice date</th><td>${formatDate(input.invoiceDate, timezone)}</td></tr>
        <tr><th>Order</th><td>${escapeHtml(order.name)}</td></tr>
        <tr><th>Order date</th><td>${formatDate(order.processedAt, timezone)}</td></tr>
        ${order.shippingMethod ? `<tr><th>Shipping</th><td>${escapeHtml(order.shippingMethod)}</td></tr>` : ""}
      </table>
      ${f.paymentStatus && paymentStatus ? `<div class="status">${escapeHtml(paymentStatus)}</div>` : ""}
    </div>
  </header>
  <div class="parties cols-${shipToLines.length ? 3 : 2}">
    ${party("From", sellerLines)}
    ${party("Bill to", buyerLines)}
    ${shipToLines.length ? party("Ship to", shipToLines) : ""}
  </div>
  <table class="lines">
    <thead><tr>
      <th>Item</th>${f.sku ? "<th>SKU</th>" : ""}${extras.map((c) => `<th>${c.head}</th>`).join("")}<th class="num">Qty</th>
      ${f.unitPrices ? '<th class="num">Unit price</th>' : ""}${showDiscountCol ? '<th class="num">Discount</th>' : ""}<th class="num">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals"><table>
    <tr><th>Subtotal</th><td>${money(order.subtotal)}</td></tr>
    ${Number(order.totalDiscounts.amount) > 0 ? `<tr><th>Discounts</th><td>−${money(order.totalDiscounts)}</td></tr>` : ""}
    <tr><th>Shipping</th><td>${money(order.shipping)}</td></tr>
    ${taxRows}
    <tr class="grand"><th>Total (${escapeHtml(order.currency)})</th><td>${money(order.total)}</td></tr>
  </table></div>
  ${f.orderNotes && order.note ? `<div class="notes"><h3>Order notes</h3><div>${escapeMultiline(order.note)}</div></div>` : ""}
  <footer><div>${escapeMultiline(settings.footerText)}</div><div class="codes">${inFooter}</div></footer>
</article>`;
}

// ----------------------------------------------------------- Packing slip

export interface PackingSlipFragmentInput extends FragmentContext {
  order: OrderDocumentData;
  /** SKU -> bin location, from the shop's BinMap. */
  bins: ReadonlyMap<string, string>;
}

export function renderPackingSlipFragment(input: PackingSlipFragmentInput): string {
  const { order, settings, timezone, bins } = input;
  const f = settings.fields;
  const shipLines = addressLines(order.shippingAddress ?? order.billingAddress, order.customerName);
  if (f.customerPhone && order.phone) shipLines.push(order.phone);
  if (f.customerEmail && order.email) shipLines.push(order.email);
  const anyBin = f.binLocation && order.lineItems.some((li) => li.sku && bins.has(li.sku));
  const gift = f.giftMessage ? giftMessage(order) : null;
  const totalUnits = order.lineItems.reduce((n, li) => n + li.quantity, 0);
  const extras = extraColumns(settings, order.lineItems);

  const rows = order.lineItems
    .map(
      (li) => `<tr>
        <td><span class="box"></span></td>
        <td class="qty">${li.quantity}</td>
        <td class="item">${variantLabel(li.title, li.variantTitle)}</td>
        ${f.sku ? `<td class="mono">${escapeHtml(li.sku ?? "")}</td>` : ""}
        ${extras.map((c) => c.cell(li)).join("")}
        ${anyBin ? `<td class="bin">${escapeHtml((li.sku && bins.get(li.sku)) ?? "")}</td>` : ""}
      </tr>`,
    )
    .join("");

  const codes = codesHtml(input.codes, settings);
  const inHeader = settings.codes.position === "header" ? codes : "";
  const inFooter = settings.codes.position === "footer" ? codes : "";

  return `<article class="doc packing-slip" style="${articleStyle(settings)}">
  <header>
    ${brandHtml(order, settings, "Packing slip")}
    <div class="codes">${inHeader}</div>
    <div class="meta">
      <table>
        <tr><th>Order</th><td>${escapeHtml(order.name)}</td></tr>
        <tr><th>Order date</th><td>${formatDate(order.processedAt, timezone)}</td></tr>
        ${order.shippingMethod ? `<tr><th>Shipping</th><td>${escapeHtml(order.shippingMethod)}</td></tr>` : ""}
        <tr><th>Items</th><td>${totalUnits}</td></tr>
      </table>
    </div>
  </header>
  <div class="parties cols-2">
    ${party("Ship to", shipLines)}
    ${party("From", [order.seller.name, ...addressLines(order.seller.address, null).slice(1)])}
  </div>
  ${gift ? `<div class="callout"><h3>Gift message</h3><div>${escapeMultiline(gift)}</div></div>` : ""}
  ${f.orderNotes && order.note ? `<div class="callout"><h3>Order notes</h3><div>${escapeMultiline(order.note)}</div></div>` : ""}
  <table class="lines">
    <thead><tr><th></th><th class="qty">Qty</th><th>Item</th>${f.sku ? "<th>SKU</th>" : ""}${extras.map((c) => `<th>${c.head}</th>`).join("")}${anyBin ? "<th>Bin</th>" : ""}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <footer><div>${escapeMultiline(settings.footerText)}</div><div class="codes">${inFooter}</div></footer>
</article>`;
}

// -------------------------------------------------------------- Pick list

export interface PickLine {
  sku: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  orderCount: number;
  bin: string | null;
  sequence: number | null;
}

export interface BinEntry {
  bin: string;
  sequence: number | null;
}

/**
 * Aggregate line items across orders. Grouped and sorted by bin when the
 * shop has a BinMap (walking sequence first, then bin code), by SKU
 * otherwise. Items without a SKU are aggregated by title.
 */
export function aggregatePickList(
  orders: readonly OrderDocumentData[],
  bins: ReadonlyMap<string, BinEntry>,
): PickLine[] {
  const lines = new Map<string, PickLine & { orders: Set<string> }>();
  for (const order of orders) {
    for (const li of order.lineItems) {
      const key = li.sku ? `sku:${li.sku}` : `title:${li.title}|${li.variantTitle ?? ""}`;
      let line = lines.get(key);
      if (!line) {
        const entry = li.sku ? bins.get(li.sku) : undefined;
        line = {
          sku: li.sku,
          title: li.title,
          variantTitle: li.variantTitle,
          quantity: 0,
          orderCount: 0,
          bin: entry?.bin ?? null,
          sequence: entry?.sequence ?? null,
          orders: new Set(),
        };
        lines.set(key, line);
      }
      line.quantity += li.quantity;
      line.orders.add(order.id);
    }
  }
  const useBins = bins.size > 0;
  const result = [...lines.values()].map(({ orders: set, ...line }) => ({ ...line, orderCount: set.size }));
  result.sort((a, b) => {
    // Items without a SKU always go last.
    if ((a.sku === null) !== (b.sku === null)) return a.sku === null ? 1 : -1;
    if (useBins) {
      // Known bins first, walking sequence, then bin code, then SKU.
      if ((a.bin === null) !== (b.bin === null)) return a.bin === null ? 1 : -1;
      if (a.sequence !== null || b.sequence !== null) {
        if (a.sequence === null) return 1;
        if (b.sequence === null) return -1;
        if (a.sequence !== b.sequence) return a.sequence - b.sequence;
      }
      const byBin = (a.bin ?? "").localeCompare(b.bin ?? "", undefined, { numeric: true });
      if (byBin !== 0) return byBin;
    }
    return (a.sku ?? a.title).localeCompare(b.sku ?? b.title, undefined, { numeric: true });
  });
  return result;
}

export interface PickListFragmentInput extends FragmentContext {
  lines: PickLine[];
  orderCount: number;
  batchLabel: string;
  generatedAt: string;
  sellerName: string;
}

export function renderPickListFragment(input: PickListFragmentInput): string {
  const { settings, timezone, lines } = input;
  const useBins = lines.some((l) => l.bin !== null);
  const totalUnits = lines.reduce((n, l) => n + l.quantity, 0);

  let lastBin: string | null | undefined;
  const rows = lines
    .map((l) => {
      let group = "";
      if (useBins && l.bin !== lastBin) {
        lastBin = l.bin;
        group = `<tr class="group"><td colspan="5">${l.bin ? `Bin ${escapeHtml(l.bin)}` : "No bin location"}</td></tr>`;
      }
      return `${group}<tr>
        <td><span class="box"></span></td>
        <td class="qty">${l.quantity}</td>
        <td class="mono">${escapeHtml(l.sku ?? "")}</td>
        <td class="item">${variantLabel(l.title, l.variantTitle)}</td>
        <td class="num">${l.orderCount}</td>
      </tr>`;
    })
    .join("");

  return `<article class="doc pick-list" style="${articleStyle(settings)}">
  <header>
    <div class="brand"><div><div class="name">${escapeHtml(input.sellerName)}</div><h1>Pick list</h1></div></div>
    <div class="meta"><table>
      <tr><th>Batch</th><td>${escapeHtml(input.batchLabel)}</td></tr>
      <tr><th>Generated</th><td>${formatDate(input.generatedAt, timezone)}</td></tr>
      <tr><th>Orders</th><td>${input.orderCount}</td></tr>
      <tr><th>Units</th><td>${totalUnits}</td></tr>
      <tr><th>Sorted by</th><td>${useBins ? "bin location" : "SKU"}</td></tr>
    </table></div>
  </header>
  <table class="lines">
    <thead><tr><th></th><th class="qty">Qty</th><th>SKU</th><th>Item</th><th class="num">Orders</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <footer><div>${escapeMultiline(settings.footerText)}</div></footer>
</article>`;
}

// ------------------------------------------------------------ Cover sheet

export interface CoverFragmentInput extends FragmentContext {
  batchLabel: string;
  orderCount: number;
  generatedAt: string;
  documentTypes: string[];
  sellerName: string;
  /** QR of the batch scan URL. */
  batchQr: string;
}

export function renderCoverFragment(input: CoverFragmentInput): string {
  const { settings, timezone } = input;
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input.generatedAt));
  return `<article class="doc cover" style="${articleStyle(settings)}">
  <div class="name" style="font-family: var(--font-heading); font-size: 1.4em; font-weight: 600;">${escapeHtml(input.sellerName)}</div>
  <h1>${escapeHtml(input.batchLabel)}</h1>
  <div class="summary" style="max-width: 150mm; margin: 10mm auto;">
    <div class="stat"><div class="n">${input.orderCount}</div><div class="l">orders</div></div>
    <div class="stat"><div class="n">${input.documentTypes.length}</div><div class="l">${escapeHtml(input.documentTypes.join(" + "))}</div></div>
    <div class="stat"><div class="n" style="font-size: 1.1em; padding-top: 2mm;">${escapeHtml(when)}</div><div class="l">generated</div></div>
  </div>
  <div class="codes"><div class="code qr">${input.batchQr}</div></div>
  <p class="hint">Scan this sheet on any phone on the floor to follow the batch as it is packed.</p>
</article>`;
}
