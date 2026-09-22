import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { currentPeriod, daysRemaining, periodEnd, type PeriodKey } from "./period.server";
import { getPlan } from "./plans.server";

/**
 * The meter.
 *
 * One unit is one distinct Shopify order for which at least one document was
 * successfully generated during the calendar month, in the shop's timezone.
 * The unique constraint MeterEntry(shopId, period, orderId) does the real
 * work: this module only inserts and lets duplicates fail. See CLAUDE.md.
 */

export interface RecordResult {
  period: PeriodKey;
  /** Orders counted for the first time this period by this call. */
  recorded: number;
  /** Orders in the call that were already counted this period. */
  alreadyCounted: number;
}

export interface Usage {
  plan: ReturnType<typeof getPlan>;
  period: PeriodKey;
  timezone: string;
  used: number;
  /** null for plans with no cap. */
  limit: number | null;
  /** null for plans with no cap. */
  remaining: number | null;
  periodEndsAt: Date;
  daysRemaining: number;
  atLimit: boolean;
}

async function loadShop(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, plan: true, timezone: true },
  });
  if (!shop) throw new Error(`Shop ${shopId} not found`);
  return shop;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * Count each order once for the current period. Call this only after a
 * document was successfully generated. Safe to call repeatedly with the
 * same orders: repeats are absorbed by the unique constraint.
 */
export async function recordGeneration(
  shopId: string,
  orderIds: readonly string[],
  now: Date = new Date(),
): Promise<RecordResult> {
  const shop = await loadShop(shopId);
  const period = currentPeriod(shop.timezone, now);
  const distinct = [...new Set(orderIds)];

  let recorded = 0;
  let alreadyCounted = 0;

  for (const orderId of distinct) {
    try {
      await prisma.meterEntry.create({
        data: { shopId, period, orderId, createdAt: now },
      });
      recorded += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      alreadyCounted += 1;
    }
  }

  return { period, recorded, alreadyCounted };
}

/**
 * Meter a finished DocumentJob. Only a job in state SUCCEEDED records units;
 * anything else, including FAILED, records nothing.
 */
export async function recordJobGeneration(
  jobId: string,
  now: Date = new Date(),
): Promise<RecordResult | null> {
  const job = await prisma.documentJob.findUnique({
    where: { id: jobId },
    select: { shopId: true, state: true, orderIdsJson: true },
  });
  if (!job) throw new Error(`DocumentJob ${jobId} not found`);
  if (job.state !== "SUCCEEDED") return null;

  const orderIds = parseOrderIds(job.orderIdsJson);
  return recordGeneration(job.shopId, orderIds, now);
}

function parseOrderIds(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
    throw new Error("DocumentJob.orderIdsJson must be a JSON array of strings");
  }
  return parsed;
}

/** Usage for the current period against the shop's plan. */
export async function getUsage(shopId: string, now: Date = new Date()): Promise<Usage> {
  const shop = await loadShop(shopId);
  const plan = getPlan(shop.plan);
  const period = currentPeriod(shop.timezone, now);

  const used = await prisma.meterEntry.count({ where: { shopId, period } });
  const limit = plan.monthlyOrderLimit;
  const remaining = limit === null ? null : Math.max(0, limit - used);

  return {
    plan,
    period,
    timezone: shop.timezone,
    used,
    limit,
    remaining,
    periodEndsAt: periodEnd(period, shop.timezone),
    daysRemaining: daysRemaining(period, shop.timezone, now),
    atLimit: limit !== null && used >= limit,
  };
}
