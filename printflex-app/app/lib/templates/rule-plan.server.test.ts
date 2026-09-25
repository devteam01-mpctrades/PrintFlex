import { describe, expect, it } from "vitest";
import { ruleAllowedOnPlan, rulePlanMessage } from "./rule-plan.server";

describe("per-market template rules", () => {
  it("allows country rules only on plans with per-market templates", () => {
    const country = { countries: ["JP"], tags: [] };
    const tag = { countries: [], tags: ["b2b"] };
    const all = { countries: [], tags: [] };
    expect(ruleAllowedOnPlan("FREE", country)).toBe(false);
    expect(ruleAllowedOnPlan("PREMIUM", country)).toBe(false);
    expect(ruleAllowedOnPlan("UNLIMITED", country)).toBe(true);
    for (const plan of ["FREE", "PREMIUM", "UNLIMITED"]) {
      expect(ruleAllowedOnPlan(plan, tag)).toBe(true);
      expect(ruleAllowedOnPlan(plan, all)).toBe(true);
    }
    expect(ruleAllowedOnPlan("not-a-plan", country)).toBe(false);
    expect(rulePlanMessage("PREMIUM")).toContain("Unlimited");
  });
});
