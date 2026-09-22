import prisma from "../../db.server";
import { DOCUMENT_TYPES, type DocumentType } from "../types";

/**
 * Job creation for bulk printing. Phase 4 stub: records the job as QUEUED
 * and returns it. Rendering, the queue worker and metering arrive in
 * Phases 5 and 6; nothing here touches the meter.
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
}

export async function createDocumentJob(input: CreateJobInput) {
  if (input.orderIds.length === 0) throw new Error("A job needs at least one order");
  return prisma.documentJob.create({
    data: {
      shopId: input.shopId,
      name: input.name ?? null,
      documentTypesJson: JSON.stringify(input.documentTypes),
      orderIdsJson: JSON.stringify(input.orderIds),
      state: "QUEUED",
      total: input.orderIds.length,
    },
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
