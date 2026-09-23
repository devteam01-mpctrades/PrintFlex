/**
 * Sync run shapes and wording shared by the server (which writes SyncRun
 * rows) and the Orders page (which renders them). No server imports here.
 */

/** read_orders only returns orders from the last 60 days. Older ones need read_all_orders. */
export const ORDERS_WINDOW_DAYS = 60;

export type SyncTrigger = "install" | "manual";
export type SyncStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface SyncRunView {
  id: string;
  trigger: SyncTrigger;
  status: SyncStatus;
  seen: number;
  created: number;
  updated: number;
  stale: number;
  shopifyTotal: number | null;
  beyondWindow: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** One sentence describing a finished or running sync, for banners. */
export function describeSyncRun(run: SyncRunView): string {
  const orders = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`;
  if (run.status === "RUNNING") {
    return run.shopifyTotal !== null && run.shopifyTotal > 0
      ? `Syncing from Shopify: ${run.seen} of ${run.shopifyTotal} orders so far.`
      : `Syncing from Shopify: ${orders(run.seen)} so far.`;
  }
  if (run.status === "FAILED") {
    return `The sync stopped after ${orders(run.seen)}. ${run.error ?? "Unknown error."} Try again, and if it keeps failing contact support with this message.`;
  }
  const base = `Synced ${orders(run.seen)}: ${run.created} new, ${run.updated} updated, ${run.stale} already current.`;
  if (run.beyondWindow && run.beyondWindow > 0) {
    return `${base} ${orders(run.beyondWindow)} ${run.beyondWindow === 1 ? "is" : "are"} older than ${ORDERS_WINDOW_DAYS} days and cannot be read with the current Shopify permissions, so ${run.beyondWindow === 1 ? "it was" : "they were"} not synced.`;
  }
  return base;
}
