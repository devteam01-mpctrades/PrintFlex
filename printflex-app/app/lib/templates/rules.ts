/**
 * Assignment rules and precedence. Pure and client-safe so the editor can
 * show where a template lands before saving; templates.server.ts re-exports
 * everything here for server callers.
 *
 * A rule matches an order when every listed condition holds. An empty rule
 * matches all orders. Precedence when several templates of one type match:
 *   1. a rule with a tag condition beats one without,
 *   2. then a rule with a country condition beats one without,
 *   3. then more conditions beat fewer,
 *   4. then the older template wins.
 * The "All orders" template therefore always comes last.
 */
export interface AssignmentRule {
  countries: string[];
  tags: string[];
}

export const EMPTY_RULE: AssignmentRule = { countries: [], tags: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAssignmentRule(json: string): AssignmentRule {
  try {
    const raw: unknown = JSON.parse(json);
    if (!isRecord(raw)) return EMPTY_RULE;
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
    return { countries: list(raw.countries).map((c) => c.toUpperCase()), tags: list(raw.tags) };
  } catch {
    return EMPTY_RULE;
  }
}

export interface OrderContext {
  countryCode: string | null;
  tags: readonly string[];
}

export function ruleMatches(rule: AssignmentRule, order: OrderContext): boolean {
  if (rule.countries.length && !(order.countryCode && rule.countries.includes(order.countryCode.toUpperCase()))) return false;
  if (rule.tags.length) {
    const have = new Set(order.tags.map((t) => t.toLowerCase()));
    if (!rule.tags.some((t) => have.has(t.toLowerCase()))) return false;
  }
  return true;
}

/** Higher sorts first. */
export function ruleSpecificity(rule: AssignmentRule): number {
  return (rule.tags.length ? 100 : 0) + (rule.countries.length ? 10 : 0) + rule.tags.length + rule.countries.length;
}

export function describeRule(rule: AssignmentRule): string {
  const parts: string[] = [];
  if (rule.tags.length) parts.push(`Tag: ${rule.tags.join(" or ")}`);
  if (rule.countries.length) parts.push(`Ships to ${rule.countries.join(", ")}`);
  return parts.length ? parts.join(" · ") : "All orders";
}

/** Two rules with the same key cover exactly the same orders, whatever the order the conditions were typed in. */
export function ruleKey(rule: AssignmentRule): string {
  const countries = [...new Set(rule.countries.map((c) => c.toUpperCase()))].sort();
  const tags = [...new Set(rule.tags.map((t) => t.toLowerCase()))].sort();
  return JSON.stringify({ countries, tags });
}

export interface RankedTemplate {
  id: string;
  rule: AssignmentRule;
  /** ISO string or Date; older wins ties. */
  createdAt: string | Date;
}

function created(t: RankedTemplate): number {
  return typeof t.createdAt === "string" ? Date.parse(t.createdAt) : t.createdAt.getTime();
}

export function comparePrecedence(a: RankedTemplate, b: RankedTemplate): number {
  const diff = ruleSpecificity(b.rule) - ruleSpecificity(a.rule);
  return diff !== 0 ? diff : created(a) - created(b);
}

/** Templates of a type in precedence order: the first matching one is used. */
export function orderByPrecedence<T extends { assignmentRuleJson: string; createdAt: Date }>(templates: T[]): T[] {
  return [...templates].sort((a, b) =>
    comparePrecedence(
      { id: "a", rule: parseAssignmentRule(a.assignmentRuleJson), createdAt: a.createdAt },
      { id: "b", rule: parseAssignmentRule(b.assignmentRuleJson), createdAt: b.createdAt },
    ),
  );
}

export function pickTemplate<T extends { assignmentRuleJson: string; createdAt: Date }>(templates: T[], order: OrderContext): T | null {
  return orderByPrecedence(templates).find((t) => ruleMatches(parseAssignmentRule(t.assignmentRuleJson), order)) ?? null;
}

export interface RankPreview {
  /** 1-based position among the templates of this type once saved. */
  position: number;
  total: number;
  /** The template checked just before this one, if any. */
  after: string | null;
  /** A sibling whose rule covers exactly the same orders, if any. */
  duplicateOf: string | null;
}

/**
 * Where a draft rule would land among its siblings. `siblings` are the other
 * templates of the same document type; `self` is the template being edited.
 */
export function previewRank(
  self: RankedTemplate,
  siblings: Array<RankedTemplate & { name: string }>,
): RankPreview {
  const all = [...siblings, self].sort(comparePrecedence);
  const position = all.findIndex((t) => t.id === self.id) + 1;
  const before = position > 1 ? all[position - 2] : null;
  const beforeName = before ? siblings.find((s) => s.id === before.id)?.name ?? null : null;
  const key = ruleKey(self.rule);
  const duplicate = siblings.find((s) => ruleKey(s.rule) === key);
  return { position, total: all.length, after: beforeName, duplicateOf: duplicate?.name ?? null };
}

/** Plain-words summary of a rank, e.g. "Checked 2nd of 3, after Invoice — Japan". */
export function describeRank(rank: RankPreview, typeLabel: string): string {
  const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
  if (rank.total === 1) return `The only ${typeLabel.toLowerCase()} template, so it prints for every order.`;
  if (rank.position === rank.total) return `Checked last of ${rank.total}: the fallback when no other ${typeLabel.toLowerCase()} template matches.`;
  return `Checked ${ordinal(rank.position)} of ${rank.total}${rank.after ? `, after ${rank.after}` : ""}.`;
}
