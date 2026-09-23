import { describe, expect, it } from "vitest";
import { describeSyncRun, ORDERS_WINDOW_DAYS, type SyncRunView } from "./sync-status";

function run(overrides: Partial<SyncRunView> = {}): SyncRunView {
  return {
    id: "run_1",
    trigger: "manual",
    status: "SUCCEEDED",
    seen: 200,
    created: 200,
    updated: 0,
    stale: 0,
    shopifyTotal: 200,
    beyondWindow: 0,
    error: null,
    startedAt: "2026-09-23T03:00:00.000Z",
    finishedAt: "2026-09-23T03:00:20.000Z",
    ...overrides,
  };
}

describe("describeSyncRun", () => {
  it("names how many orders were synced", () => {
    expect(describeSyncRun(run())).toBe("Synced 200 orders: 200 new, 0 updated, 0 already current.");
  });

  it("says explicitly when orders fall outside the read_orders window instead of hiding the gap", () => {
    const text = describeSyncRun(run({ shopifyTotal: 250, beyondWindow: 50 }));
    expect(text).toContain("50 orders are older than " + ORDERS_WINDOW_DAYS + " days");
    expect(text).toContain("were not synced");
  });

  it("reports progress against the store total while running", () => {
    expect(describeSyncRun(run({ status: "RUNNING", seen: 40, finishedAt: null }))).toBe("Syncing from Shopify: 40 of 200 orders so far.");
  });

  it("carries the error message when a run fails", () => {
    const text = describeSyncRun(run({ status: "FAILED", seen: 20, error: "Access denied for customer field." }));
    expect(text).toContain("stopped after 20 orders");
    expect(text).toContain("Access denied for customer field.");
  });
});
