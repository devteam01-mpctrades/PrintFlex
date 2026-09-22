/**
 * Allowed values for the String "enum" columns in prisma/schema.prisma.
 * SQLite has no native enums, so these are enforced here and in code, not
 * by the database.
 */

export const PLAN_IDS = ["FREE", "PREMIUM", "UNLIMITED"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const LIMIT_BEHAVIOURS = ["HARD_CAP", "PROMPT_UPGRADE"] as const;
export type LimitBehaviour = (typeof LIMIT_BEHAVIOURS)[number];

export const DOCUMENT_TYPES = ["INVOICE", "PACKING_SLIP", "PICK_LIST"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const JOB_STATES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PRINTED_IN_FALLBACK",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const ORDER_DOCUMENT_STATUSES = [
  "NEW",
  "PRINTED",
  "PACKED",
  "NEEDS_REVIEW",
] as const;
export type OrderDocumentStatus = (typeof ORDER_DOCUMENT_STATUSES)[number];

export const PACK_OUTCOMES = [
  "OPENED",
  "PACKED",
  "SHORT_PICK",
  "DAMAGED",
  "SUBSTITUTED",
  "WRONG_ITEM",
] as const;
export type PackOutcome = (typeof PACK_OUTCOMES)[number];

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}
