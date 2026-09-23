import type { OrderDocumentData } from "../render/order-document-data.server";

/**
 * A clearly labelled stand-in used by the template preview only when the
 * shop has no synced orders. Long titles and many lines on purpose: that is
 * what breaks layouts. Never shown as if it were the merchant's data.
 */
export const SAMPLE_ORDER_NAME = "#SAMPLE-1001";

export function sampleOrderData(sellerName: string): OrderDocumentData {
  const money = (amount: string) => ({ amount, currencyCode: "USD" });
  const line = (title: string, variantTitle: string | null, sku: string, quantity: number, unit: string, hsCode: string | null, weightGrams: number | null) => {
    const total = (Number(unit) * quantity).toFixed(2);
    return { title, variantTitle, sku, quantity, unitPrice: money(unit), lineDiscount: money("0.00"), lineTotal: money(total), imageUrl: null, hsCode, countryOfOrigin: hsCode ? "KR" : null, weightGrams };
  };
  const lineItems = [
    line("Ginseng Revitalising Overnight Recovery Cream with Fermented Red Ginseng Extract 50 ml", "Fragrance-free", "SMP-CREAM-50", 2, "28.00", "330499", 120),
    line("Snail Mucin 96% Power Repairing Essence", "100 ml", "SMP-ESSENCE-100", 1, "24.00", "330499", 160),
    line("Sheet Mask Discovery Pack", "Set of 10", "SMP-MASK-10", 3, "32.00", "330499", 280),
    line("Hydrating Serum with Hyaluronic Acid", null, "SMP-SERUM-30", 1, "22.00", "330499", 75),
    line("Gift Wrap", null, "SMP-GIFT", 1, "6.00", null, 30),
  ];
  const subtotal = lineItems.reduce((sum, li) => sum + Number(li.lineTotal.amount), 0);
  const tax = subtotal * 0.1;
  const shipping = 8;
  return {
    id: "gid://shopify/Order/0",
    name: SAMPLE_ORDER_NAME,
    createdAt: "2026-09-21T09:30:00Z",
    processedAt: "2026-09-21T09:30:00Z",
    note: null,
    attributes: [{ key: "Gift message", value: "Happy birthday, Yuki! Enjoy the essence." }],
    email: "sample.customer@example.com",
    phone: "+81 90 0000 0000",
    customerName: "Sample Customer",
    financialStatus: "PAID",
    fulfillmentStatus: "UNFULFILLED",
    taxesIncluded: false,
    currency: "USD",
    billingAddress: { name: "Sample Customer", company: null, address1: "1-2-3 Sample Street", address2: "Apt 4", city: "Tokyo", province: "Tokyo", zip: "100-0001", country: "Japan", phone: "+81 90 0000 0000" },
    shippingAddress: { name: "Sample Customer", company: null, address1: "1-2-3 Sample Street", address2: "Apt 4", city: "Tokyo", province: "Tokyo", zip: "100-0001", country: "Japan", phone: "+81 90 0000 0000" },
    shippingMethod: "Standard shipping",
    lineItems,
    subtotal: money(subtotal.toFixed(2)),
    totalDiscounts: money("0.00"),
    shipping: money(shipping.toFixed(2)),
    totalTax: money(tax.toFixed(2)),
    taxLines: [{ title: "Sales tax", ratePercentage: 10, amount: money(tax.toFixed(2)) }],
    total: money((subtotal + tax + shipping).toFixed(2)),
    seller: { name: sellerName, email: null, address: null },
  };
}
