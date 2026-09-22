import prisma from "../../db.server";
import { canCreateAnother } from "../plans.server";

/**
 * Saved views are filter combinations stored as query strings. Every shop
 * gets the built-ins; creating custom views is a plan entitlement checked
 * through plans.server.ts.
 */

export interface SavedViewItem {
  id: string;
  name: string;
  query: string;
  builtIn: boolean;
}

export const BUILT_IN_VIEWS: SavedViewItem[] = [
  { id: "builtin:all", name: "All orders", query: "", builtIn: true },
  { id: "builtin:unfulfilled", name: "Unfulfilled", query: "fulfillment=UNFULFILLED", builtIn: true },
  { id: "builtin:never-printed", name: "Never printed", query: "docStatus=NEW", builtIn: true },
  { id: "builtin:needs-review", name: "Needs review", query: "docStatus=NEEDS_REVIEW", builtIn: true },
];

export async function listSavedViews(shopId: string): Promise<SavedViewItem[]> {
  const custom = await prisma.savedView.findMany({
    where: { shopId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return [
    ...BUILT_IN_VIEWS,
    ...custom.map((v) => ({ id: v.id, name: v.name, query: v.query, builtIn: false })),
  ];
}

export async function canSaveView(shopId: string, planId: string): Promise<boolean> {
  const customCount = await prisma.savedView.count({ where: { shopId } });
  return canCreateAnother(planId, "savedViews", BUILT_IN_VIEWS.length + customCount);
}

export type SaveViewResult =
  | { ok: true; view: SavedViewItem }
  | { ok: false; reason: "plan" | "name" | "duplicate" };

export async function saveView(
  shopId: string,
  planId: string,
  name: string,
  query: string,
): Promise<SaveViewResult> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) return { ok: false, reason: "name" };
  if (!(await canSaveView(shopId, planId))) return { ok: false, reason: "plan" };
  if (BUILT_IN_VIEWS.some((v) => v.name.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, reason: "duplicate" };
  }
  const existing = await prisma.savedView.findMany({
    where: { shopId },
    select: { name: true },
  });
  if (existing.some((v) => v.name.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, reason: "duplicate" };
  }

  const position = existing.length;
  const view = await prisma.savedView.create({
    data: { shopId, name: trimmed, query, position },
  });
  return { ok: true, view: { id: view.id, name: view.name, query: view.query, builtIn: false } };
}

export async function deleteView(shopId: string, viewId: string): Promise<boolean> {
  const result = await prisma.savedView.deleteMany({ where: { shopId, id: viewId } });
  return result.count > 0;
}
