import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { mintScanToken, scanUrl } from "../scan/tokens.server";
import type { DocumentType } from "../types";
import { wrapDocument } from "./batch-html.server";
import { qrSvg } from "./codes.server";
import { aggregatePickList, renderCoverFragment, renderPickListFragment } from "./fragments.server";
import { fetchOrdersDocumentData, type OrderDocumentData } from "./order-document-data.server";
import { buildOrderFragment, loadBins, orderContext, templatePicker, type ResolvedTemplate } from "./order-fragments.server";
import type { PdfRenderer } from "./pdf.server";
import { afterGeneration, createDocumentRow } from "./render-order.server";
import { writeJobOutput } from "./storage.server";

/**
 * Batch rendering. One HTML document, one Puppeteer pass, one PDF:
 * [cover sheet] + for each order in the merchant's order: [invoice] [packing
 * slip] + [pick list]. Per-order Document rows are created without files;
 * ensureDocumentFile renders one on demand.
 *
 * buildBatch prepares everything and has no side effects beyond allocating
 * invoice numbers and minting scan tokens (both idempotent for a retry).
 * finalizeBatch records rows, meters once per order, tags and flips status.
 * renderBatch = build + PDF + finalize. The browser fallback = build + HTML + finalize.
 */

export interface JobOptions {
  coverSheet: boolean;
}

export function parseJobOptions(json: string): JobOptions {
  try {
    const parsed: unknown = JSON.parse(json);
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    return { coverSheet: record.coverSheet === true };
  } catch {
    return { coverSheet: false };
  }
}

import { batchLabel } from "../jobs/batch-label";
export { batchLabel };

export interface BatchDeps {
  client: GraphqlClient;
  pdf: PdfRenderer;
  now?: () => Date;
  onProgress?: (done: number, total: number) => void;
}

interface OrderRef {
  id: string;
  shopifyOrderId: string;
  orderName: string;
  documentStatus: string;
  countryCode: string | null;
  tagsJson: string;
}

export interface BuiltBatch {
  jobId: string;
  shop: { id: string; timezone: string; settingsJson: string; domain: string };
  label: string;
  documentTypes: DocumentType[];
  options: JobOptions;
  fragments: string[];
  paperSize: "A4" | "LETTER";
  pickListFragment: string | null;
  /** Orders rendered, in output order, with the invoice number and templates each received. */
  rendered: Array<{ order: OrderRef; invoiceNumber: string | null; templates: Map<DocumentType, ResolvedTemplate> }>;
  missing: OrderRef[];
  now: Date;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export async function buildBatch(jobId: string, deps: BatchDeps): Promise<BuiltBatch> {
  const now = deps.now?.() ?? new Date();
  const job = await prisma.documentJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { shop: { select: { id: true, timezone: true, settingsJson: true, domain: true } } },
  });
  const orderIds: unknown = JSON.parse(job.orderIdsJson);
  const documentTypes: unknown = JSON.parse(job.documentTypesJson);
  if (!isStringArray(orderIds) || !isStringArray(documentTypes)) throw new Error("Malformed job payload");
  const types = documentTypes as DocumentType[];
  const options = parseJobOptions(job.optionsJson);

  const rows = await prisma.orderIndex.findMany({
    where: { id: { in: orderIds }, shopId: job.shopId },
    select: { id: true, shopifyOrderId: true, orderName: true, documentStatus: true, countryCode: true, tagsJson: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = orderIds.flatMap((id) => (byId.has(id) ? [byId.get(id) as OrderRef] : []));

  const pick = templatePicker(job.shopId);
  const bins = await loadBins(job.shopId);
  const data = await fetchOrdersDocumentData(
    deps.client,
    ordered.map((o) => o.shopifyOrderId),
    (fetched) => deps.onProgress?.(fetched, ordered.length),
  );

  const perOrderTypes = types.filter((t): t is Exclude<DocumentType, "PICK_LIST"> => t !== "PICK_LIST");
  const fragments: string[] = [];
  const rendered: BuiltBatch["rendered"] = [];
  const missing: OrderRef[] = [];
  const renderedData: OrderDocumentData[] = [];

  for (const order of ordered) {
    const orderData = data.get(order.shopifyOrderId);
    if (!orderData) {
      missing.push(order);
      continue;
    }
    let invoiceNumber: string | null = null;
    const used = new Map<DocumentType, ResolvedTemplate>();
    for (const type of perOrderTypes) {
      const resolved = await pick(type, orderContext(order));
      used.set(type, resolved);
      const fragment = await buildOrderFragment({
        shopId: job.shopId, orderId: order.id, data: orderData, documentType: type, resolved,
        timezone: job.shop.timezone, bins, now,
      });
      fragments.push(fragment.html);
      invoiceNumber = fragment.invoiceNumber ?? invoiceNumber;
    }
    rendered.push({ order, invoiceNumber, templates: used });
    renderedData.push(orderData);
  }

  const label = batchLabel(job);
  const firstSettings = (await pick(types[0])).settings;
  const paperSize = firstSettings.paperSize;

  let pickListFragment: string | null = null;
  if (types.includes("PICK_LIST") && renderedData.length > 0) {
    const resolved = await pick("PICK_LIST");
    {
      pickListFragment = renderPickListFragment({
        lines: aggregatePickList(renderedData, bins),
        orderCount: renderedData.length,
        batchLabel: label,
        generatedAt: now.toISOString(),
        sellerName: renderedData[0].seller.name,
        settings: resolved.settings,
        timezone: job.shop.timezone,
      });
      fragments.push(pickListFragment);
    }
  }

  if (options.coverSheet && renderedData.length > 0) {
    const { token } = await mintScanToken(job.shopId, { kind: "batch", jobId }, now);
    fragments.unshift(
      renderCoverFragment({
        batchLabel: label,
        orderCount: renderedData.length,
        generatedAt: now.toISOString(),
        documentTypes: types.map((t) => ({ INVOICE: "Invoices", PACKING_SLIP: "Packing slips", PICK_LIST: "Pick list" })[t]),
        sellerName: renderedData[0].seller.name,
        batchQr: await qrSvg(scanUrl(token), "large"),
        settings: firstSettings,
        timezone: job.shop.timezone,
      }),
    );
  }

  return { jobId, shop: job.shop, label, documentTypes: types, options, fragments, paperSize, pickListFragment, rendered, missing, now };
}

/** Rows, meter, tags, status. Idempotent for the same job. */
export async function finalizeBatch(built: BuiltBatch, client: GraphqlClient): Promise<void> {
  const perOrderTypes = built.documentTypes.filter((t) => t !== "PICK_LIST");
  for (const { order, invoiceNumber, templates } of built.rendered) {
    for (const type of perOrderTypes) {
      const resolved = templates.get(type);
      if (!resolved) continue;
      const exists = await prisma.document.findFirst({
        where: { shopId: built.shop.id, orderId: order.id, documentType: type, templateId: resolved.template.id, templateVersion: resolved.template.version },
        select: { id: true },
      });
      if (exists) continue;
      await createDocumentRow({
        shopId: built.shop.id, jobId: built.jobId, orderId: order.id, documentType: type,
        templateId: resolved.template.id, templateVersion: resolved.template.version,
        invoiceNumber: type === "INVOICE" ? invoiceNumber : null,
        renderedAt: built.now,
      });
    }
  }
  await afterGeneration(built.shop, built.rendered.map((r) => r.order), client, built.now);
}

export interface BatchReport {
  rendered: number;
  missing: string[];
  outputPath: string | null;
  pickListPath: string | null;
  bytes: number;
  ms: number;
}

export async function renderBatch(jobId: string, deps: BatchDeps): Promise<BatchReport> {
  const started = Date.now();
  const built = await buildBatch(jobId, deps);
  if (built.rendered.length === 0) {
    return { rendered: 0, missing: built.missing.map((m) => m.orderName), outputPath: null, pickListPath: null, bytes: 0, ms: Date.now() - started };
  }

  const html = wrapDocument(built.fragments, { title: built.label, paperSize: built.paperSize });
  const pdf = await deps.pdf.render(html, { paperSize: built.paperSize });
  const outputPath = await writeJobOutput(built.shop.id, jobId, "batch", pdf);

  let pickListPath: string | null = null;
  if (built.pickListFragment) {
    const pickPdf = await deps.pdf.render(wrapDocument([built.pickListFragment], { title: `${built.label} pick list`, paperSize: built.paperSize }), { paperSize: built.paperSize });
    pickListPath = await writeJobOutput(built.shop.id, jobId, "picklist", pickPdf);
  }

  await prisma.documentJob.update({ where: { id: jobId }, data: { outputPath, pickListPath, outputBytes: pdf.byteLength } });
  await finalizeBatch(built, deps.client);

  return { rendered: built.rendered.length, missing: built.missing.map((m) => m.orderName), outputPath, pickListPath, bytes: pdf.byteLength, ms: Date.now() - started };
}
