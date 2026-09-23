import type { PlanId } from "./types";
import { isPlanId } from "./types";

/**
 * Single source of truth for PrintFlex plans.
 *
 * Every feature that depends on the merchant's plan checks entitlements
 * through this module and nowhere else. `null` means unlimited.
 */

export interface PlanEntitlements {
  /** Maximum number of templates, null for unlimited. */
  templates: number | null;
  /** Maximum number of saved order views, null for unlimited. */
  savedViews: number | null;
  automaticInvoiceEmail: boolean;
  csvExport: boolean;
  prioritySupport: boolean;
  refundDocuments: boolean;
  perMarketTemplates: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in USD. */
  monthlyPriceUsd: number;
  /** Annual price in USD: ten months' price. */
  annualPriceUsd: number;
  /** Metered orders per calendar month, null for no cap. */
  monthlyOrderLimit: number | null;
  entitlements: PlanEntitlements;
}

const ANNUAL_MONTHS = 10;

function definePlan(plan: Omit<Plan, "annualPriceUsd">): Plan {
  return {
    ...plan,
    annualPriceUsd: Math.round(plan.monthlyPriceUsd * ANNUAL_MONTHS * 100) / 100,
  };
}

export const PLANS: Record<PlanId, Plan> = {
  FREE: definePlan({
    id: "FREE",
    name: "Free",
    monthlyPriceUsd: 0,
    monthlyOrderLimit: 50,
    entitlements: {
      templates: 1,
      savedViews: 3,
      automaticInvoiceEmail: false,
      csvExport: false,
      prioritySupport: false,
      refundDocuments: false,
      perMarketTemplates: false,
    },
  }),
  PREMIUM: definePlan({
    id: "PREMIUM",
    name: "Premium",
    monthlyPriceUsd: 4.99,
    monthlyOrderLimit: 500,
    entitlements: {
      templates: null,
      savedViews: null,
      automaticInvoiceEmail: true,
      csvExport: true,
      prioritySupport: false,
      refundDocuments: false,
      perMarketTemplates: false,
    },
  }),
  UNLIMITED: definePlan({
    id: "UNLIMITED",
    name: "Unlimited",
    monthlyPriceUsd: 9.99,
    monthlyOrderLimit: null,
    entitlements: {
      templates: null,
      savedViews: null,
      automaticInvoiceEmail: true,
      csvExport: true,
      prioritySupport: true,
      refundDocuments: true,
      perMarketTemplates: true,
    },
  }),
};

export const DEFAULT_PLAN_ID: PlanId = "FREE";

/** Resolve a stored plan string to a Plan, falling back to Free if unknown. */
export function getPlan(planId: string): Plan {
  return isPlanId(planId) ? PLANS[planId] : PLANS[DEFAULT_PLAN_ID];
}

type BooleanEntitlement = {
  [K in keyof PlanEntitlements]: PlanEntitlements[K] extends boolean ? K : never;
}[keyof PlanEntitlements];

type CountedEntitlement = Exclude<keyof PlanEntitlements, BooleanEntitlement>;

/** True when the plan includes a yes/no feature. */
export function hasEntitlement(
  planId: string,
  feature: BooleanEntitlement,
): boolean {
  return getPlan(planId).entitlements[feature];
}

/**
 * True when `currentCount` is below the plan's limit for a counted feature,
 * meaning one more may be created.
 */
export function canCreateAnother(
  planId: string,
  feature: CountedEntitlement,
  currentCount: number,
): boolean {
  const limit = getPlan(planId).entitlements[feature];
  return limit === null || currentCount < limit;
}

/** Short labels for what a plan includes, shown as pills on the plan bar. */
export function planPills(planId: PlanId): string[] {
  const e = PLANS[planId].entitlements;
  const pills: string[] = [];
  pills.push(e.templates === null ? "Unlimited templates" : e.templates === 1 ? "One template" : `${e.templates} templates`);
  if (e.automaticInvoiceEmail) pills.push("Auto invoice email");
  pills.push(e.savedViews === null ? "Saved views" : `${e.savedViews} saved views`);
  if (e.refundDocuments) pills.push("Refund documents");
  if (e.perMarketTemplates) pills.push("Per-market templates");
  if (e.prioritySupport) pills.push("Priority support");
  return pills;
}

export const PLAN_ORDER: PlanId[] = ["FREE", "PREMIUM", "UNLIMITED"];
