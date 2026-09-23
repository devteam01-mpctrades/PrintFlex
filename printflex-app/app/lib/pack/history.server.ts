import prisma from "../../db.server";
import { hasEntitlement } from "../plans.server";
import type { PackOutcome } from "../types";

/**
 * Scan history: every pack event for the last 90 days, and the numbers the
 * Scan & pack tiles show. CSV export is a paid-plan entitlement, checked
 * through plans.server.ts.
 */

export const HISTORY_DAYS = 90;

export interface HistoryRow {
  id: string;
  occurredAt: Date;
  orderId: string;
  orderName: string;
  /** Numeric part of the Shopify order GID, for links into the Shopify admin. */
  shopifyOrderNumber: string;
  deviceName: string;
  staffLabel: string | null;
  outcome: PackOutcome;
  note: string | null;
  itemCount: number | null;
  parcelWeightGrams: number | null;
}

export const OUTCOME_LABEL: Record<PackOutcome, string> = {
  OPENED: "Opened",
  PACKED: "Packed",
  SHORT_PICK: "Short pick",
  DAMAGED: "Damaged",
  SUBSTITUTED: "Substituted",
  WRONG_ITEM: "Wrong item scanned",
};

export async function listHistory(shopId: string, options: { limit?: number; includeOpened?: boolean; now?: Date } = {}): Promise<HistoryRow[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const rows = await prisma.packEvent.findMany({
    where: { shopId, occurredAt: { gte: since }, ...(options.includeOpened ? {} : { outcome: { not: "OPENED" } }) },
    orderBy: { occurredAt: "desc" },
    take: options.limit ?? 500,
    include: { order: { select: { orderName: true, shopifyOrderId: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt,
    orderId: r.orderId,
    orderName: r.order.orderName,
    shopifyOrderNumber: r.order.shopifyOrderId.split("/").pop() ?? "",
    deviceName: r.deviceName,
    staffLabel: r.staffLabel,
    outcome: r.outcome as PackOutcome,
    note: r.note,
    itemCount: r.itemCount,
    parcelWeightGrams: r.parcelWeightGrams,
  }));
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function historyToCsv(rows: HistoryRow[], timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const header = ["time", "order", "device", "staff", "outcome", "items", "weight_grams", "note"];
  const lines = rows.map((r) =>
    [fmt.format(r.occurredAt).replace(",", ""), r.orderName, r.deviceName, r.staffLabel, OUTCOME_LABEL[r.outcome], r.itemCount, r.parcelWeightGrams, r.note].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

export function canExportHistory(planId: string): boolean {
  return hasEntitlement(planId, "csvExport");
}

export interface PackStats {
  packedToday: number;
  devicesToday: number;
  needsReview: number;
  /** Median seconds from first OPENED to PACKED for today's packed orders, null if unknown. */
  medianPackSeconds: number | null;
}

export async function packStats(shopId: string, dayStart: Date, now: Date = new Date()): Promise<PackStats> {
  const [packedEvents, needsReview, devices] = await Promise.all([
    prisma.packEvent.findMany({ where: { shopId, outcome: "PACKED", occurredAt: { gte: dayStart, lte: now } }, select: { orderId: true, occurredAt: true } }),
    prisma.orderIndex.count({ where: { shopId, documentStatus: "NEEDS_REVIEW" } }),
    prisma.packEvent.findMany({ where: { shopId, occurredAt: { gte: dayStart, lte: now } }, distinct: ["deviceName"], select: { deviceName: true } }),
  ]);
  let median: number | null = null;
  if (packedEvents.length > 0) {
    const opened = await prisma.packEvent.findMany({
      where: { shopId, outcome: "OPENED", orderId: { in: packedEvents.map((e) => e.orderId) } },
      orderBy: { occurredAt: "asc" },
      select: { orderId: true, occurredAt: true },
    });
    const firstOpen = new Map<string, Date>();
    for (const o of opened) if (!firstOpen.has(o.orderId)) firstOpen.set(o.orderId, o.occurredAt);
    const durations = packedEvents
      .map((e) => (firstOpen.has(e.orderId) ? (e.occurredAt.getTime() - (firstOpen.get(e.orderId) as Date).getTime()) / 1000 : null))
      .filter((d): d is number => d !== null && d >= 0)
      .sort((a, b) => a - b);
    if (durations.length) {
      const mid = Math.floor(durations.length / 2);
      median = durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
    }
  }
  return { packedToday: packedEvents.length, devicesToday: devices.length, needsReview, medianPackSeconds: median };
}
