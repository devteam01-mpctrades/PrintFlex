import prisma from "../../db.server";
import type { DocumentType } from "../types";
import { parseAssignmentRule, ruleKey, type AssignmentRule } from "./rules";

export interface RuleConflict {
  templateId: string;
  templateName: string;
}

/**
 * Two templates of one document type must not carry the same rule: the
 * older one would silently win and the newer one would never print. Returns
 * the template that already covers the rule, or null.
 */
export async function findRuleConflict(
  shopId: string,
  documentType: DocumentType,
  rule: AssignmentRule,
  excludeTemplateId?: string,
): Promise<RuleConflict | null> {
  const key = ruleKey(rule);
  const siblings = await prisma.template.findMany({
    where: { shopId, documentType, active: true, ...(excludeTemplateId ? { id: { not: excludeTemplateId } } : {}) },
    select: { id: true, name: true, assignmentRuleJson: true },
  });
  const hit = siblings.find((t) => ruleKey(parseAssignmentRule(t.assignmentRuleJson)) === key);
  return hit ? { templateId: hit.id, templateName: hit.name } : null;
}

/** The explanation shown when a save or restore is refused. Callers add the "Not saved" lead-in. */
export function conflictMessage(conflict: RuleConflict, rule: AssignmentRule, typeLabel: string): string {
  const scope = rule.countries.length || rule.tags.length ? "the same orders" : "all orders";
  return `"${conflict.templateName}" already covers ${scope} for ${typeLabel.toLowerCase()}s. Change this template's rule, or edit that one instead.`;
}
