import { BillingInterval } from "@shopify/shopify-app-react-router/server";
import { PLANS } from "../plans.server";
import type { PlanId } from "../types";

/**
 * The Shopify Billing API plans. Names are what merchants see on Shopify's
 * charge screen and what billing.check returns, so the mapping back to a
 * PlanId is by name. Prices come from plans.server.ts: monthly as listed,
 * annual at ten months.
 */

export type BillingPlanName = "PrintFlex Premium" | "PrintFlex Premium (annual)" | "PrintFlex Unlimited" | "PrintFlex Unlimited (annual)";

export const BILLING_PLAN_NAMES: Record<Exclude<PlanId, "FREE">, { monthly: BillingPlanName; annual: BillingPlanName }> = {
  PREMIUM: { monthly: "PrintFlex Premium", annual: "PrintFlex Premium (annual)" },
  UNLIMITED: { monthly: "PrintFlex Unlimited", annual: "PrintFlex Unlimited (annual)" },
};

interface RecurringPlan {
  lineItems: Array<{ amount: number; currencyCode: string; interval: BillingInterval.Every30Days | BillingInterval.Annual }>;
}

export const BILLING_CONFIG: Record<BillingPlanName, RecurringPlan> = {
  "PrintFlex Premium": {
    lineItems: [{ amount: PLANS.PREMIUM.monthlyPriceUsd, currencyCode: "USD", interval: BillingInterval.Every30Days }],
  },
  "PrintFlex Premium (annual)": {
    lineItems: [{ amount: PLANS.PREMIUM.annualPriceUsd, currencyCode: "USD", interval: BillingInterval.Annual }],
  },
  "PrintFlex Unlimited": {
    lineItems: [{ amount: PLANS.UNLIMITED.monthlyPriceUsd, currencyCode: "USD", interval: BillingInterval.Every30Days }],
  },
  "PrintFlex Unlimited (annual)": {
    lineItems: [{ amount: PLANS.UNLIMITED.annualPriceUsd, currencyCode: "USD", interval: BillingInterval.Annual }],
  },
};

export const ALL_BILLING_PLANS = Object.keys(BILLING_CONFIG) as BillingPlanName[];

export function planIdForBillingName(name: string): Exclude<PlanId, "FREE"> | null {
  for (const [planId, names] of Object.entries(BILLING_PLAN_NAMES) as Array<[Exclude<PlanId, "FREE">, { monthly: string; annual: string }]>) {
    if (names.monthly === name || names.annual === name) return planId;
  }
  return null;
}

export function isAnnual(name: string): boolean {
  return name.endsWith("(annual)");
}
