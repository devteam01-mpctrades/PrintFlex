import prisma from "../../db.server";
import { capacityMessage, checkCapacity } from "../meter.server";
import { OrderGoneError, renderDocumentForOrder, TemplateNotUsableError, type RenderDeps } from "../render/render-order.server";
import { batchLabel } from "../render/render-batch.server";
import type { DocumentType } from "../types";
import { createDocumentJob } from "./create-job.server";

/**
 * Two ways to print again from a finished batch:
 *
 * - printTypeFromBatch: the same orders, one document type only (e.g. just the
 *   invoices out of an Invoice + Packing slip batch), as a new batch.
 * - reprintDocument: one order's document again with a template the merchant
 *   picks by hand, added to the same batch.
 *
 * Both go through the normal render path, so the meter (one unit per order per
 * month), invoice numbers (one per order) and tags behave exactly as a first
 * print. The capacity check runs first, as on the Orders screen.
 */

const TYPE_WORDS: Record<Exclude<DocumentType, "PICK_LIST">, string> = { INVOICE: "Invoices", PACKING_SLIP: "Packing slips" };

export type PrintTypeResult = { ok: true; jobId: string; label: string; count: number } | { ok: false; message: string };

export async function printTypeFromBatch(shopId: string, jobId: string, documentType: DocumentType): Promise<PrintTypeResult> {
  if (documentType === "PICK_LIST") return { ok: false, message: "The pick list is already a single file: use Pick list only." };
  const job = await prisma.documentJob.findFirst({ where: { id: jobId, shopId } });
  if (!job) return { ok: false, message: "This batch does not exist." };
  const orderIds = JSON.parse(job.orderIdsJson) as string[];
  const orders = await prisma.orderIndex.findMany({ where: { id: { in: orderIds }, shopId }, select: { id: true, shopifyOrderId: true } });
  if (orders.length === 0) return { ok: false, message: "None of this batch's orders exist any more." };

  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { timezone: true } });
  const capacity = await checkCapacity(shopId, orders.map((o) => o.shopifyOrderId));
  if (!capacity.allowed) return { ok: false, message: capacityMessage(capacity, shop.timezone) };

  // Keep the original batch order; orders deleted since are left out.
  const present = new Set(orders.map((o) => o.id));
  const created = await createDocumentJob({
    shopId,
    documentTypes: [documentType],
    orderIds: orderIds.filter((id) => present.has(id)),
    name: `${TYPE_WORDS[documentType]} from ${batchLabel(job)}`,
  });
  return { ok: true, jobId: created.id, label: batchLabel(created), count: present.size };
}

export type ReprintResult = { ok: true; documentId: string; templateName: string; orderName: string } | { ok: false; message: string };

export async function reprintDocument(shopId: string, documentId: string, templateId: string, deps: RenderDeps): Promise<ReprintResult> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, shopId },
    include: { order: { select: { id: true, orderName: true, shopifyOrderId: true } } },
  });
  if (!document) return { ok: false, message: "This document does not exist any more. Reload the page." };
  const type = document.documentType as DocumentType;
  if (type === "PICK_LIST") return { ok: false, message: "A pick list covers the whole batch; print it again from Orders." };

  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { timezone: true } });
  const capacity = await checkCapacity(shopId, [document.order.shopifyOrderId]);
  if (!capacity.allowed) return { ok: false, message: capacityMessage(capacity, shop.timezone) };

  try {
    const { document: fresh } = await renderDocumentForOrder(shopId, document.orderId, type, deps, document.jobId ?? undefined, { templateId });
    // A cached render from another batch keeps its own batch; attach it here too so it shows on this page.
    if (document.jobId && fresh.jobId !== document.jobId) {
      await prisma.document.update({ where: { id: fresh.id }, data: { jobId: document.jobId, renderedAt: new Date() } });
    } else if (fresh.id !== document.id) {
      await prisma.document.update({ where: { id: fresh.id }, data: { renderedAt: new Date() } });
    }
    const template = await prisma.template.findUniqueOrThrow({ where: { id: fresh.templateId }, select: { name: true } });
    return { ok: true, documentId: fresh.id, templateName: template.name, orderName: document.order.orderName };
  } catch (error) {
    if (error instanceof TemplateNotUsableError || error instanceof OrderGoneError) return { ok: false, message: error.message };
    throw error;
  }
}

/** The newest document per order and type, in the batch's order: what the batch page lists. */
export function latestPerOrderAndType<T extends { orderId: string; type: string; renderedAt: string | Date }>(documents: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const d of documents) {
    const key = `${d.orderId}:${d.type}`;
    const seen = latest.get(key);
    if (!seen || new Date(d.renderedAt).getTime() >= new Date(seen.renderedAt).getTime()) latest.set(key, d);
  }
  const firstSeen = new Map<string, number>();
  documents.forEach((d, i) => {
    const key = `${d.orderId}:${d.type}`;
    if (!firstSeen.has(key)) firstSeen.set(key, i);
  });
  return [...latest.entries()].sort((a, b) => firstSeen.get(a[0])! - firstSeen.get(b[0])!).map(([, d]) => d);
}

const TYPE_ORDER: Record<string, number> = { INVOICE: 0, PACKING_SLIP: 1 };

/**
 * The per-order documents a batch page lists: the newest document of each of the batch's types for
 * each of its orders, in the batch's order. Not just rows with this jobId: a reprint reuses the
 * document an earlier batch produced (same template version, no new row), and that document is
 * still what this batch printed.
 */
export async function documentsForBatch(shopId: string, job: { id: string; orderIdsJson: string; documentTypesJson: string }) {
  const orderIds = JSON.parse(job.orderIdsJson) as string[];
  const types = (JSON.parse(job.documentTypesJson) as DocumentType[]).filter((t) => t !== "PICK_LIST");
  const rows = await prisma.document.findMany({
    where: { shopId, OR: [{ jobId: job.id }, { orderId: { in: orderIds }, documentType: { in: types } }] },
    orderBy: { renderedAt: "asc" },
    include: { order: { select: { orderName: true, customerName: true } }, template: { select: { name: true } } },
  });
  const position = new Map(orderIds.map((id, i) => [id, i]));
  const latest = latestPerOrderAndType(rows.map((d) => ({ ...d, type: d.documentType })));
  return latest.sort(
    (a, b) => (position.get(a.orderId) ?? Infinity) - (position.get(b.orderId) ?? Infinity) || (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9),
  );
}
