import { getPlan, hasEntitlement } from "../plans.server";
import type { AssignmentRule } from "./rules";

/**
 * Ships-to-country rules are the "per-market template variants" feature,
 * so a rule with countries needs that entitlement. Tag rules are open to
 * every plan that can have more than one template.
 */
export function ruleAllowedOnPlan(planId: string, rule: AssignmentRule): boolean {
  return rule.countries.length === 0 || hasEntitlement(planId, "perMarketTemplates");
}

export function rulePlanMessage(planId: string): string {
  return `Per-market template variants (ships-to-country rules) are part of the Unlimited plan. Your ${getPlan(planId).name} plan can assign templates by tag. See Plans & billing.`;
}
