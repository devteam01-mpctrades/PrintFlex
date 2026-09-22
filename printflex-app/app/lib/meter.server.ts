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

export interface CapacityCheck {
  allowed: boolean;
  /** Orders in the request not yet metered this period. */
  newUnits: number;
  used: number;
  limit: number | null;
  remaining: number | null;
  /** Fraction of the limit used after this request, 0..∞. */
  afterRatio: number;
  behaviour: string;
  periodEndsAt: Date;
}

/**
 * Would generating documents for these orders exceed the plan? Reprints
 * within the period cost nothing, so only orders without a MeterEntry this
 * period count. Both limit behaviours stop at the cap: the difference is
 * only what the merchant is told. Nothing here ever changes the plan.
 */
export async function checkCapacity(shopId: string, shopifyOrderIds: readonly string[], now: Date = new Date()): Promise<CapacityCheck> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { limitBehaviour: true } });
  const usage = await getUsage(shopId, now);
  const distinct = [...new Set(shopifyOrderIds)];
  const already = distinct.length
    ? await prisma.meterEntry.findMany({ where: { shopId, period: usage.period, orderId: { in: distinct } }, select: { orderId: true } })
    : [];
  const newUnits = distinct.length - already.length;
  const limit = usage.limit;
  const afterRatio = limit === null ? 0 : (usage.used + newUnits) / limit;
  return {
    allowed: limit === null || usage.used + newUnits <= limit,
    newUnits,
    used: usage.used,
    limit,
    remaining: usage.remaining,
    afterRatio,
    behaviour: shop.limitBehaviour,
    periodEndsAt: usage.periodEndsAt,
  };
}

/** The sentence shown when generation is refused, per limit behaviour. */
export function capacityMessage(check: CapacityCheck, timezone: string): string {
  const reset = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "long" }).format(check.periodEndsAt);
  const base = `This would use ${check.newUnits} new metered ${check.newUnits === 1 ? "order" : "orders"}, and ${check.remaining ?? 0} of ${check.limit} remain this period.`;
  return check.behaviour === "PROMPT_UPGRADE"
    ? `${base} Upgrade on Plans & billing to keep printing, or wait for the period to reset on ${reset}. PrintFlex never upgrades your plan by itself.`
    : `${base} Document generation is paused until the period resets on ${reset}. Nothing is charged and your plan is unchanged. You can upgrade any time on Plans & billing.`;
}
