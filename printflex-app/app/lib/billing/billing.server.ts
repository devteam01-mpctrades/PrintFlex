import prisma from "../../db.server";
import { audit } from "../audit.server";
import type { authenticate } from "../../shopify.server";
import type { LimitBehaviour, PlanId } from "../types";
import { FORCE_TEST_BILLING } from "./test-mode.server";
import { ALL_BILLING_PLANS, BILLING_PLAN_NAMES, isAnnual, planIdForBillingName, type BillingPlanName } from "./plans-config.server";

/**
 * Subscriptions live in Shopify. This module only reads what Shopify says
 * is active and mirrors the plan onto the Shop row, and asks Shopify to
 * start or stop a subscription. No price, card or invoice is ever handled
 * here.
 */

export interface ActiveSubscription {
  id: string;
  name: string;
  test?: boolean;
}

/** The library's billing context, as returned by authenticate.admin. Tests pass a fake cast to this type. */
export type BillingApi = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

/** Baseline: test charges outside production. Per-shop decisions (development stores) come from billingTestMode. */
export const IS_TEST_BILLING = FORCE_TEST_BILLING;

export interface SubscriptionState {
  planId: PlanId;
  annual: boolean;
  subscription: ActiveSubscription | null;
}

/** Pure: which plan a set of active subscriptions amounts to. Unlimited beats Premium if both exist. */
export function stateFromSubscriptions(subscriptions: readonly ActiveSubscription[]): SubscriptionState {
  let best: SubscriptionState = { planId: "FREE", annual: false, subscription: null };
  for (const sub of subscriptions) {
    const planId = planIdForBillingName(sub.name);
    if (!planId) continue;
    if (best.planId === "FREE" || (planId === "UNLIMITED" && best.planId === "PREMIUM")) {
      best = { planId, annual: isAnnual(sub.name), subscription: sub };
    }
  }
  return best;
}

/** Ask Shopify what is active and mirror it onto the shop. */
export async function syncSubscription(billing: BillingApi, shopId: string, isTest: boolean = IS_TEST_BILLING): Promise<SubscriptionState> {
  const { appSubscriptions } = await billing.check({ plans: [...ALL_BILLING_PLANS], isTest });
  const state = stateFromSubscriptions(appSubscriptions);
  const before = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { plan: true } });
  if (before.plan !== state.planId) {
    await prisma.shop.update({ where: { id: shopId }, data: { plan: state.planId } });
    await audit(shopId, "shopify", "plan.changed", null, { from: before.plan, to: state.planId, annual: state.annual });
  }
  return state;
}

/** Send the merchant to Shopify's charge screen. Never resolves: it redirects. */
export async function requestPlan(
  billing: BillingApi,
  planId: Exclude<PlanId, "FREE">,
  annual: boolean,
  returnUrl: string,
  isTest: boolean = IS_TEST_BILLING,
): Promise<never> {
  const name: BillingPlanName = annual ? BILLING_PLAN_NAMES[planId].annual : BILLING_PLAN_NAMES[planId].monthly;
  return billing.request({ plan: name, isTest, returnUrl });
}

/** Cancel through Shopify, then mirror Free. */
export async function cancelSubscription(billing: BillingApi, shopId: string, subscriptionId: string, isTest: boolean = IS_TEST_BILLING): Promise<void> {
  await billing.cancel({ subscriptionId, isTest, prorate: true });
  await prisma.shop.update({ where: { id: shopId }, data: { plan: "FREE" } });
}

export async function setLimitBehaviour(shopId: string, behaviour: LimitBehaviour): Promise<void> {
  await prisma.shop.update({ where: { id: shopId }, data: { limitBehaviour: behaviour } });
  await audit(shopId, "merchant", "limit.changed", null, { behaviour });
}
