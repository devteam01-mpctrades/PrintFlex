import { Prisma } from "@prisma/client";
import prisma from "../../db.server";

/**
 * Gapless, sequential invoice numbers per shop.
 *
 * The counter lives on Shop (invoicePrefix, invoiceNextNumber). Allocation
 * increments the counter and binds the number to the order in ONE
 * transaction, so:
 *   - two concurrent allocations for different orders get consecutive numbers,
 *   - two allocations for the same order get the same number,
 *   - a render that fails after allocation leaves no gap: the number stays
 *     with its order and the retry reuses it.
 */

export interface AllocatedInvoiceNumber {
  number: number;
  formatted: string;
  /** True when this call created the binding; false when it already existed. */
  fresh: boolean;
}

export const INVOICE_NUMBER_PADDING = 6;

export function formatInvoiceNumber(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(INVOICE_NUMBER_PADDING, "0")}`;
}

export async function allocateInvoiceNumber(
  shopId: string,
  orderId: string,
): Promise<AllocatedInvoiceNumber> {
  const existing = await prisma.invoiceNumber.findUnique({
    where: { shopId_orderId: { shopId, orderId } },
  });
  if (existing) return { number: existing.number, formatted: existing.formatted, fresh: false };

  try {
    return await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.update({
        where: { id: shopId },
        data: { invoiceNextNumber: { increment: 1 } },
        select: { invoiceNextNumber: true, invoicePrefix: true },
      });
      const number = shop.invoiceNextNumber - 1;
      const formatted = formatInvoiceNumber(shop.invoicePrefix, number);
      await tx.invoiceNumber.create({ data: { shopId, orderId, number, formatted } });
      return { number, formatted, fresh: true };
    });
  } catch (error) {
    // Lost a race for the same order: the transaction (including the counter
    // increment) rolled back, so read the winner's number.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.invoiceNumber.findUniqueOrThrow({
        where: { shopId_orderId: { shopId, orderId } },
      });
      return { number: winner.number, formatted: winner.formatted, fresh: false };
    }
    throw error;
  }
}

/**
 * Change the prefix and/or the next number. The next number may only move
 * forward past every number already issued, so the sequence stays gapless
 * and never reuses a value.
 */
export async function configureInvoiceNumbering(
  shopId: string,
  input: { prefix?: string; nextNumber?: number },
): Promise<{ prefix: string; nextNumber: number }> {
  return prisma.$transaction(async (tx) => {
    const shop = await tx.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { invoicePrefix: true, invoiceNextNumber: true },
    });
    const data: { invoicePrefix?: string; invoiceNextNumber?: number } = {};
    if (input.prefix !== undefined) data.invoicePrefix = input.prefix.trim();
    if (input.nextNumber !== undefined) {
      const highest = await tx.invoiceNumber.aggregate({ where: { shopId }, _max: { number: true } });
      const floor = Math.max(shop.invoiceNextNumber, (highest._max.number ?? 0) + 1);
      if (!Number.isInteger(input.nextNumber) || input.nextNumber < 1) {
        throw new Error("The next invoice number must be a positive whole number.");
      }
      if (input.nextNumber < floor) {
        throw new Error(
          `The next invoice number cannot be lower than ${floor}: numbers up to ${floor - 1} are already issued.`,
        );
      }
      data.invoiceNextNumber = input.nextNumber;
    }
    const updated = await tx.shop.update({
      where: { id: shopId },
      data,
      select: { invoicePrefix: true, invoiceNextNumber: true },
    });
    return { prefix: updated.invoicePrefix, nextNumber: updated.invoiceNextNumber };
  });
}
