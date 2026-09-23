import type { DocumentType } from "../types";

/**
 * Template types, labels and defaults. Pure and client-safe: route
 * components import from here, server code via templates.server.ts.
 */

export type PaperSize = "A4" | "LETTER";
export type CodePosition = "header" | "footer";
export type CodeSize = "small" | "medium" | "large";

export interface TemplateFields {
  unitPrices: boolean;
  lineDiscounts: boolean;
  taxBreakdown: boolean;
  customerPhone: boolean;
  customerEmail: boolean;
  orderNotes: boolean;
  giftMessage: boolean;
  sku: boolean;
  barcodeValue: boolean;
  binLocation: boolean;
  hsCode: boolean;
  countryOfOrigin: boolean;
  weight: boolean;
  paymentStatus: boolean;
}

export type EmailTrigger = "creation" | "payment" | "fulfillment";

export interface TemplateSettings {
  /** Automatic invoice email (INVOICE templates only). */
  email: { enabled: boolean; trigger: EmailTrigger };
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  paperSize: PaperSize;
  density: "compact" | "normal";
  /** A data: URL (PNG, JPEG or SVG, under 400 KB) or null. */
  logoUrl: string | null;
  footerText: string;
  fields: TemplateFields;
  codes: { qr: boolean; barcode: boolean; position: CodePosition; size: CodeSize };
}

/** Curated fonts that headless Chrome can render without web font loading. */
export const FONT_CHOICES = [
  "Inter",
  "Helvetica Neue",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Courier New",
] as const;

export const FIELD_LABELS: Record<keyof TemplateFields, string> = {
  unitPrices: "Unit prices",
  lineDiscounts: "Line discounts",
  taxBreakdown: "Tax breakdown",
  customerPhone: "Customer phone",
  customerEmail: "Customer email",
  orderNotes: "Order notes",
  giftMessage: "Gift message",
  sku: "SKU",
  barcodeValue: "Barcode value",
  binLocation: "Bin location",
  hsCode: "HS code",
  countryOfOrigin: "Country of origin",
  weight: "Weight",
  paymentStatus: "Payment status",
};

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  email: { enabled: false, trigger: "payment" },
  accentColor: "#1f2937",
  headingFont: "Inter",
  bodyFont: "Inter",
  paperSize: "A4",
  density: "normal",
  logoUrl: null,
  footerText: "",
  fields: {
    unitPrices: true,
    lineDiscounts: true,
    taxBreakdown: true,
    customerPhone: false,
    customerEmail: true,
    orderNotes: false,
    giftMessage: false,
    sku: true,
    barcodeValue: true,
    binLocation: true,
    hsCode: false,
    countryOfOrigin: false,
    weight: false,
    paymentStatus: true,
  },
  codes: { qr: true, barcode: true, position: "header", size: "medium" },
};

/** Which toggles make sense on which document. */
export const FIELDS_BY_TYPE: Record<DocumentType, Array<keyof TemplateFields>> = {
  INVOICE: ["unitPrices", "lineDiscounts", "taxBreakdown", "customerEmail", "customerPhone", "orderNotes", "sku", "hsCode", "countryOfOrigin", "weight", "paymentStatus", "barcodeValue"],
  PACKING_SLIP: ["sku", "binLocation", "giftMessage", "orderNotes", "customerEmail", "customerPhone", "weight", "countryOfOrigin", "barcodeValue"],
  PICK_LIST: ["binLocation", "weight"],
};

/** Logos are stored inline as data URLs, so the cap keeps template rows small. */
export const MAX_LOGO_BYTES = 400 * 1024;
export const MAX_LOGO_LABEL = "400 KB";

/** Accent swatches offered in the editor; any hex value is also accepted. */
export const ACCENT_SWATCHES: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: "#e25b07", name: "Orange" },
  { hex: "#1f2937", name: "Charcoal" },
  { hex: "#0c5132", name: "Forest" },
  { hex: "#1d4ed8", name: "Blue" },
  { hex: "#7e22ce", name: "Plum" },
  { hex: "#b91c1c", name: "Red" },
];

/** A toggle in the editor's "Show on this document" list and the setting it drives. */
export type DocumentToggle =
  | { kind: "field"; key: keyof TemplateFields; label: string }
  | { kind: "code"; key: "qr" | "barcode"; label: string };

const FIELD_TOGGLE = (key: keyof TemplateFields): DocumentToggle => ({ kind: "field", key, label: FIELD_LABELS[key] });

/**
 * The toggles shown per document type, in display order. Each one drives a
 * real branch in the render fragments; nothing here is decorative.
 */
export const TOGGLES_BY_TYPE: Record<DocumentType, DocumentToggle[]> = {
  INVOICE: [
    FIELD_TOGGLE("unitPrices"),
    FIELD_TOGGLE("taxBreakdown"),
    FIELD_TOGGLE("sku"),
    { kind: "code", key: "qr", label: "QR code" },
    { kind: "code", key: "barcode", label: "Barcode" },
    FIELD_TOGGLE("customerPhone"),
    FIELD_TOGGLE("hsCode"),
  ],
  PACKING_SLIP: [
    FIELD_TOGGLE("sku"),
    { kind: "code", key: "qr", label: "QR code" },
    { kind: "code", key: "barcode", label: "Barcode" },
    FIELD_TOGGLE("binLocation"),
    FIELD_TOGGLE("customerPhone"),
  ],
  PICK_LIST: [FIELD_TOGGLE("binLocation"), FIELD_TOGGLE("weight")],
};

export const DEFAULT_NAMES: Record<DocumentType, string> = {
  INVOICE: "Invoice — Default",
  PACKING_SLIP: "Packing slip",
  PICK_LIST: "Pick list",
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  INVOICE: "Invoice",
  PACKING_SLIP: "Packing slip",
  PICK_LIST: "Pick list",
};

