import type { TemplateSettings } from "../templates/templates.server";
import type { Address, OrderDocumentData } from "./order-document-data.server";
import { escapeHtml, escapeMultiline, formatDate, formatMoney, safeColor, safeFont } from "./html.server";

/**
 * The invoice. One HTML document per order, styled entirely through CSS
 * variables so branding is a settings change, not a template change. The
 * same function feeds the PDF renderer, the browser fallback print view and
 * the template preview, so what you preview is what prints.
 */

export interface InvoiceRenderInput {
  order: OrderDocumentData;
  invoiceNumber: string;
  invoiceDate: string; // ISO
  settings: TemplateSettings;
  timezone: string;
  /** Inline SVG markup for codes; Phase 6 supplies these. */
  codes?: { qr?: string; barcode?: string };
}

const PAGE_SIZE: Record<TemplateSettings["paperSize"], string> = { A4: "A4", LETTER: "Letter" };

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

function addressLines(address: Address | null, fallbackName: string | null): string[] {
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

function block(title: string, lines: string[]): string {
  return `
    <section class="party">
      <h3>${escapeHtml(title)}</h3>
      ${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}
    </section>`;
}

export function renderInvoiceHtml(input: InvoiceRenderInput): string {
  const { order, settings, timezone } = input;
  const f = settings.fields;
  const money = (m: { amount: string; currencyCode: string }) => formatMoney(m.amount, m.currencyCode);
  const accent = safeColor(settings.accentColor, "#1f2937");
  const headingFont = safeFont(settings.headingFont, "Inter");
  const bodyFont = safeFont(settings.bodyFont, "Inter");
  const compact = settings.density === "compact";

  const sellerLines = [order.seller.name, ...addressLines(order.seller.address, null).slice(1)];
  if (order.seller.email) sellerLines.push(order.seller.email);

  const buyerLines = addressLines(order.billingAddress ?? order.shippingAddress, order.customerName);
  if (f.customerEmail && order.email) buyerLines.push(order.email);
  if (f.customerPhone && order.phone) buyerLines.push(order.phone);

  const shipToLines =
    order.shippingAddress && order.billingAddress ? addressLines(order.shippingAddress, order.customerName) : [];

  const showDiscountCol = f.lineDiscounts && order.lineItems.some((li) => Number(li.lineDiscount.amount) > 0);
  const columns = 2 + (f.sku ? 1 : 0) + (f.unitPrices ? 1 : 0) + (showDiscountCol ? 1 : 0);

  const rows = order.lineItems
    .map((li) => {
      const title = li.variantTitle && li.variantTitle !== "Default Title"
        ? `${li.title} <span class="variant">${escapeHtml(li.variantTitle)}</span>`
        : escapeHtml(li.title);
      return `
        <tr>
          <td class="item">${title}</td>
          ${f.sku ? `<td class="sku">${escapeHtml(li.sku ?? "")}</td>` : ""}
          <td class="num">${li.quantity}</td>
          ${f.unitPrices ? `<td class="num">${money(li.unitPrice)}</td>` : ""}
          ${showDiscountCol ? `<td class="num">${Number(li.lineDiscount.amount) > 0 ? `−${money(li.lineDiscount)}` : ""}</td>` : ""}
          <td class="num">${money(li.lineTotal)}</td>
        </tr>`;
    })
    .join("");

  const taxRows = f.taxBreakdown && order.taxLines.length > 0
    ? order.taxLines
        .map(
          (t) => `
          <tr><th>${escapeHtml(t.title)}${t.ratePercentage !== null ? ` (${t.ratePercentage}%)` : ""}${order.taxesIncluded ? " incl." : ""}</th><td>${money(t.amount)}</td></tr>`,
        )
        .join("")
    : `<tr><th>Tax${order.taxesIncluded ? " (included)" : ""}</th><td>${money(order.totalTax)}</td></tr>`;

  const paymentStatus = order.financialStatus ? STATUS_LABEL[order.financialStatus] ?? order.financialStatus : null;

  const codesHtml = `
    ${input.codes?.qr ? `<div class="code qr">${input.codes.qr}</div>` : ""}
    ${input.codes?.barcode ? `<div class="code barcode">${input.codes.barcode}</div>` : ""}`;
  const codesInHeader = settings.codes.position === "header" ? codesHtml : "";
  const codesInFooter = settings.codes.position === "footer" ? codesHtml : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice ${escapeHtml(input.invoiceNumber)} · ${escapeHtml(order.name)}</title>
<style>
  :root {
    --accent: ${accent};
    --ink: #111827;
    --muted: #6b7280;
    --rule: #e5e7eb;
    --font-heading: "${headingFont}", system-ui, sans-serif;
    --font-body: "${bodyFont}", system-ui, sans-serif;
    --base: ${compact ? "10.5pt" : "11.5pt"};
    --gap: ${compact ? "10mm" : "14mm"};
  }
  @page { size: ${PAGE_SIZE[settings.paperSize]}; margin: 16mm 16mm 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: var(--font-body); font-size: var(--base); color: var(--ink); line-height: 1.4; }
  h1, h2, h3 { font-family: var(--font-heading); margin: 0; }
  h1 { font-size: 2em; letter-spacing: -0.01em; color: var(--accent); }
  h3 { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 0.4em; }
  .page { page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; border-bottom: 2px solid var(--accent); padding-bottom: 6mm; margin-bottom: var(--gap); }
  .brand { display: flex; align-items: center; gap: 6mm; }
  .brand img { max-height: 18mm; max-width: 60mm; }
  .brand .name { font-family: var(--font-heading); font-size: 1.4em; font-weight: 600; }
  .meta { text-align: right; }
  .meta table { border-collapse: collapse; margin-left: auto; }
  .meta th { text-align: left; color: var(--muted); font-weight: 500; padding: 0 4mm 0 0; }
  .meta td { text-align: right; font-variant-numeric: tabular-nums; }
  .codes { display: flex; gap: 6mm; align-items: center; }
  .code svg { display: block; }
  .parties { display: grid; grid-template-columns: repeat(${shipToLines.length ? 3 : 2}, 1fr); gap: 8mm; margin-bottom: var(--gap); }
  .party div { line-height: 1.35; }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  table.lines th { text-align: left; font-weight: 600; font-size: 0.85em; color: var(--muted); border-bottom: 1px solid var(--ink); padding: 2mm 2mm; }
  table.lines td { padding: 2.2mm 2mm; border-bottom: 1px solid var(--rule); vertical-align: top; }
  table.lines .num, table.lines th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.lines .sku { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .variant { color: var(--muted); }
  .totals { display: flex; justify-content: flex-end; }
  .totals table { border-collapse: collapse; min-width: 70mm; }
  .totals th { text-align: left; font-weight: 500; color: var(--muted); padding: 1.2mm 6mm 1.2mm 0; }
  .totals td { text-align: right; font-variant-numeric: tabular-nums; padding: 1.2mm 0; }
  .totals tr.grand th, .totals tr.grand td { border-top: 2px solid var(--accent); padding-top: 2.5mm; font-weight: 700; color: var(--ink); font-size: 1.15em; }
  .status { display: inline-block; margin-top: 3mm; padding: 1mm 3mm; border: 1px solid var(--accent); border-radius: 2mm; color: var(--accent); font-weight: 600; font-size: 0.85em; }
  .notes { margin-top: var(--gap); color: var(--muted); }
  footer { margin-top: var(--gap); padding-top: 4mm; border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.85em; display: flex; justify-content: space-between; gap: 8mm; align-items: flex-end; }
</style>
</head>
<body>
<article class="page">
  <header>
    <div class="brand">
      ${settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="">` : ""}
      <div>
        <div class="name">${escapeHtml(order.seller.name)}</div>
        <h1>Invoice</h1>
      </div>
    </div>
    <div class="codes">${codesInHeader}</div>
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

  <div class="parties">
    ${block("From", sellerLines)}
    ${block("Bill to", buyerLines)}
    ${shipToLines.length ? block("Ship to", shipToLines) : ""}
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th>Item</th>
        ${f.sku ? "<th>SKU</th>" : ""}
        <th class="num">Qty</th>
        ${f.unitPrices ? '<th class="num">Unit price</th>' : ""}
        ${showDiscountCol ? '<th class="num">Discount</th>' : ""}
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="${columns}">No items</td></tr>`}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><th>Subtotal</th><td>${money(order.subtotal)}</td></tr>
      ${Number(order.totalDiscounts.amount) > 0 ? `<tr><th>Discounts</th><td>−${money(order.totalDiscounts)}</td></tr>` : ""}
      <tr><th>Shipping</th><td>${money(order.shipping)}</td></tr>
      ${taxRows}
      <tr class="grand"><th>Total (${escapeHtml(order.currency)})</th><td>${money(order.total)}</td></tr>
    </table>
  </div>

  ${f.orderNotes && order.note ? `<div class="notes"><h3>Order notes</h3><div>${escapeMultiline(order.note)}</div></div>` : ""}

  <footer>
    <div>${escapeMultiline(settings.footerText)}</div>
    <div class="codes">${codesInFooter}</div>
  </footer>
</article>
</body>
</html>`;
}
