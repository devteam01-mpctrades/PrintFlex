import prisma from "../../db.server";
import { DOCUMENT_TYPES, type DocumentType } from "../types";

/**
 * Job creation for bulk printing. Records the job as QUEUED; the queue
 * (app/lib/jobs/queue.server.ts) picks it up. Nothing here touches the meter.
 */

export function parseDocumentTypes(value: string): DocumentType[] {
  const requested = value === "ALL" ? [...DOCUMENT_TYPES] : value.split(",");
  const valid = requested.filter((t): t is DocumentType =>
    (DOCUMENT_TYPES as readonly string[]).includes(t),
  );
  if (valid.length === 0) throw new Error("No valid document types requested");
  return [...new Set(valid)];
}

export interface CreateJobInput {
  shopId: string;
  documentTypes: DocumentType[];
  orderIds: string[];
  name?: string;
  options?: { coverSheet?: boolean };
}

/**
 * Create a job with the next batch number. The counter increment and the
 * job insert share one transaction, so concurrent prints get consecutive
 * numbers and a failed insert rolls the counter back: no gaps, no reuse.
 */
export async function createDocumentJob(input: CreateJobInput) {
  if (input.orderIds.length === 0) throw new Error("A job needs at least one order");
  return prisma.$transaction(async (tx) => {
    const shop = await tx.shop.update({ where: { id: input.shopId }, data: { batchNextNumber: { increment: 1 } }, select: { batchNextNumber: true } });
    return tx.documentJob.create({
    data: {
      shopId: input.shopId,
      number: shop.batchNextNumber - 1,
      name: input.name ?? null,
      documentTypesJson: JSON.stringify(input.documentTypes),
      orderIdsJson: JSON.stringify(input.orderIds),
      optionsJson: JSON.stringify({ coverSheet: input.options?.coverSheet === true }),
      state: "QUEUED",
      total: input.orderIds.length,
    },
    });
  });
}

/**
 * Mark orders printed without generating documents. Only New orders move to
 * Printed: Packed and Needs review are later states and must not regress.
 * Writing the printed tag to Shopify is part of the print flow in Phase 5.
 */
export async function markOrdersPrinted(
  shopId: string,
  orderIds: string[],
  now: Date = new Date(),
): Promise<{ marked: number }> {
  const result = await prisma.orderIndex.updateMany({
    where: { shopId, id: { in: orderIds }, documentStatus: "NEW" },
    data: { documentStatus: "PRINTED", lastPrintedAt: now },
  });
  return { marked: result.count };
}
