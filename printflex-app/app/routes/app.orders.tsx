import { useEffect, useRef } from "react";
import prisma from "../db.server";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import { BulkActionBar } from "../components/orders/BulkActionBar";
import { FiltersBar } from "../components/orders/FiltersBar";
import { OrdersTable } from "../components/orders/OrdersTable";
import { SavedViewsBar } from "../components/orders/SavedViewsBar";
import { useSelection } from "../components/orders/useSelection";
import { batchLabel } from "../lib/jobs/batch-label";
import { createDocumentJob, markOrdersPrinted, parseDocumentTypes } from "../lib/jobs/create-job.server";
import { getQueue } from "../lib/jobs/worker.server";
import { createPrintLink } from "../lib/render/fallback.server";
import { capacityMessage, checkCapacity } from "../lib/meter.server";
import {
  filterQueryString,
  hasActiveFilters,
  listOrders,
  loadFacets,
  parseFilters,
  parseSelectionSpec,
  resolveSelection,
} from "../lib/orders/list.server";
import { canSaveView, deleteView, listSavedViews, saveView } from "../lib/orders/saved-views.server";
import { describeSyncRun } from "../lib/orders/sync-status";
import { latestSyncRun, startBackfill } from "../lib/orders/sync.server";
import { getPlan } from "../lib/plans.server";
import { requireShop } from "../lib/request.server";
import { Btn } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const filters = parseFilters(url.searchParams);

  const [list, facets, views, canSave, sync, indexed] = await Promise.all([
    listOrders(shop.id, filters, shop.timezone),
    loadFacets(shop.id),
    listSavedViews(shop.id),
    canSaveView(shop.id, shop.plan),
    latestSyncRun(shop.id),
    prisma.orderIndex.count({ where: { shopId: shop.id } }),
  ]);

  return {
    shopId: shop.id,
    sync,
    /** Rows in OrderIndex regardless of filters: zero means nothing was ever synced. */
    indexed,
    planName: getPlan(shop.plan).name,
    filters,
    queryString: filterQueryString(filters),
    hasFilters: hasActiveFilters(filters),
    list,
    facets,
    views,
    canSave,
  };
};

interface ActionResult {
  ok: boolean;
  message: string;
  /** Set by saveView so the client can navigate to the new view. */
  query?: string;
  /** Set by bulk actions so the client can clear its selection. */
  clearSelection?: boolean;
  /** Set when a batch was queued so the client can link to it. */
  jobId?: string;
  /** Set when the queue was unavailable: a signed browser print link. */
  printUrl?: string;
  /** Set by backfill: progress and the result come from the loader, not this message. */
  syncStarted?: boolean;
}

const DOCUMENT_WORDS: Record<string, string> = {
  INVOICE: "invoices",
  PACKING_SLIP: "packing slips",
  PICK_LIST: "a pick list",
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { shop, admin } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  switch (intent) {
    case "print": {
      const documentTypes = parseDocumentTypes(String(form.get("documentTypes") ?? ""));
      const spec = parseSelectionSpec(String(form.get("selection") ?? "{}"));
      const { orders, truncated } = await resolveSelection(shop.id, spec, shop.timezone);
      if (orders.length === 0) {
        return { ok: false, message: "Nothing to print: the selection resolved to no orders." };
      }
      const capacity = await checkCapacity(shop.id, orders.map((o) => o.shopifyOrderId));
      if (!capacity.allowed) {
        return { ok: false, message: capacityMessage(capacity, shop.timezone) };
      }
      const job = await createDocumentJob({
        shopId: shop.id,
        documentTypes,
        orderIds: orders.map((o) => o.id),
        options: { coverSheet: form.get("coverSheet") === "on" },
      });
      const what = documentTypes.map((t) => DOCUMENT_WORDS[t]).join(", ");
      const label = batchLabel(job);
      try {
        await getQueue().enqueue(job.id);
      } catch (error) {
        // Printing is never blocked: hand the merchant the browser print view instead.
        console.error(`Queue unavailable for ${label}`, error);
        return {
          ok: true,
          clearSelection: true,
          jobId: job.id,
          printUrl: await createPrintLink(shop.id, job.id),
          message: `The render queue is unavailable, so ${label} will print from your browser instead. Nothing is lost and no order is metered twice.`,
        };
      }
      return {
        ok: true,
        clearSelection: true,
        jobId: job.id,
        message:
          `Rendering ${what} for ${orders.length} ${orders.length === 1 ? "order" : "orders"} as ${label}.` +
          (truncated ? " The selection was capped at 1,000 orders." : ""),
      };
    }

    case "markPrinted": {
      const spec = parseSelectionSpec(String(form.get("selection") ?? "{}"));
      const { orders } = await resolveSelection(shop.id, spec, shop.timezone);
      const { marked } = await markOrdersPrinted(shop.id, orders.map((o) => o.id));
      const skipped = orders.length - marked;
      return {
        ok: true,
        clearSelection: true,
        message:
          `Marked ${marked} ${marked === 1 ? "order" : "orders"} as printed.` +
          (skipped > 0 ? ` ${skipped} were already printed or packed and were left as they were.` : ""),
      };
    }

    case "saveView": {
      const result = await saveView(
        shop.id,
        shop.plan,
        String(form.get("name") ?? ""),
        String(form.get("query") ?? ""),
      );
      if (result.ok) return { ok: true, message: `Saved "${result.view.name}".`, query: result.view.query };
      const messages = {
        plan: "Saved views are included on Premium and Unlimited. Upgrade on Plans & billing to save this view.",
        name: "Give the view a name of up to 60 characters.",
        duplicate: "A view with that name already exists. Choose another name.",
      };
      return { ok: false, message: messages[result.reason] };
    }

    case "deleteView": {
      const deleted = await deleteView(shop.id, String(form.get("viewId") ?? ""));
      return deleted
        ? { ok: true, message: "View deleted.", query: "" }
        : { ok: false, message: "That view no longer exists." };
    }

    case "backfill": {
      // Runs in the background; the loader's `sync` field carries progress and the result.
      const { started } = await startBackfill(admin, shop.id, "manual");
      return { ok: true, message: started ? "Sync started." : "A sync is already running.", syncStarted: true };
    }

    default:
      return { ok: false, message: "Unknown action." };
  }
};

export default function OrdersPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const { list, filters, queryString } = data;

  const selection = useSelection({
    shopId: data.shopId,
    queryString,
    rows: list.rows,
    total: list.total,
    alreadyPrintedTotal: list.alreadyPrintedTotal,
  });

  // A bulk action that succeeded leaves nothing selected.
  const handled = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.clearSelection && handled.current !== fetcher.data) {
      handled.current = fetcher.data;
      selection.clear();
    }
  }, [fetcher.state, fetcher.data, selection]);

  // A scanned barcode resolves to exactly one order: select it.
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    if (list.jumpToId && jumped.current !== list.jumpToId) {
      jumped.current = list.jumpToId;
      const index = list.rows.findIndex((r) => r.id === list.jumpToId);
      if (index >= 0) selection.toggle(index, true, false);
    }
  }, [list.jumpToId, list.rows, selection]);

  const jumpedRow = list.jumpToId ? list.rows.find((r) => r.id === list.jumpToId) : undefined;

  // While a sync runs, re-read the loader every 1.5 s so progress and new rows appear.
  const revalidator = useRevalidator();
  const syncRunning = data.sync?.status === "RUNNING";
  useEffect(() => {
    if (!syncRunning) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 1500);
    return () => clearInterval(timer);
  }, [syncRunning, revalidator]);
  const syncing = syncRunning || (fetcher.state !== "idle" && fetcher.formData?.get("intent") === "backfill");
  // Show the finished sync's result until the merchant does something else.
  const showSyncResult = data.sync && data.sync.status !== "RUNNING" && fetcher.data?.syncStarted === true;

  const activeView = data.views.find((v) => v.query === queryString);
  const noOrdersSynced = data.indexed === 0;
  const canPrint = fetcher.state === "idle";

  // Three distinct empty states: nothing synced, filters exclude everything, or a view that is legitimately empty.
  let emptyState: { heading: string; text: string; action?: "sync" | "clear" } | null = null;
  if (list.rows.length === 0) {
    if (noOrdersSynced) {
      emptyState = {
        heading: "No orders synced yet",
        text: syncRunning
          ? "PrintFlex is reading your orders from Shopify now. They appear here as they arrive."
          : "PrintFlex keeps its own index of your orders so printing and scanning stay fast. Run a sync to bring them in; after that, new orders arrive on their own.",
        action: syncRunning ? undefined : "sync",
      };
    } else if (activeView) {
      const byView: Record<string, [string, string]> = {
        "builtin:all": ["No orders yet", "Orders appear here as your store receives them."],
        "builtin:unfulfilled": ["Nothing left to fulfil", "Every order has been fulfilled. New orders show up here as they come in."],
        "builtin:never-printed": ["Everything has been printed", "Every order has at least one document. New orders appear here until they are printed."],
        "builtin:needs-review": ["Nothing needs review", "No order was flagged during packing. That is the state you want."],
      };
      const [heading, text] = byView[activeView.id] ?? [`Nothing in "${activeView.name}" right now`, "Orders that match this view's filters will appear here."];
      emptyState = { heading, text };
    } else {
      emptyState = { heading: "No orders match these filters", text: "Try widening the date range or removing a filter.", action: "clear" };
    }
  }

  return (
    <s-page heading="Orders">
      <Btn
        slot="secondary-actions"
        disabled={syncing || undefined}
        loading={syncing || undefined}
        onClick={() => fetcher.submit({ intent: "backfill" }, { method: "post" })}
      >
        {syncing ? "Syncing…" : "Sync from Shopify"}
      </Btn>

      {syncRunning && data.sync ? (
        <s-banner tone="info" heading="Syncing orders from Shopify">
          <s-paragraph>{describeSyncRun(data.sync)} Orders appear below as they arrive.</s-paragraph>
          {data.sync.shopifyTotal ? <s-progress value={Math.min(data.sync.seen, data.sync.shopifyTotal)} max={data.sync.shopifyTotal} accessibilityLabel="Orders synced"></s-progress> : <s-progress accessibilityLabel="Orders synced"></s-progress>}
        </s-banner>
      ) : null}
      {showSyncResult && data.sync ? (
        <s-banner tone={data.sync.status === "SUCCEEDED" ? (data.sync.beyondWindow ? "warning" : "success") : "critical"} heading={data.sync.status === "SUCCEEDED" ? "Sync finished" : "Sync failed"}>
          <s-paragraph>{describeSyncRun(data.sync)}</s-paragraph>
        </s-banner>
      ) : null}

      {fetcher.data && fetcher.state === "idle" && !fetcher.data.syncStarted ? (
        <s-banner tone={fetcher.data.ok ? "success" : "critical"}>
          <s-paragraph>{fetcher.data.message}</s-paragraph>
          {fetcher.data.printUrl ? (
            <Btn slot="secondary-actions" href={fetcher.data.printUrl} target="_blank">
              Print from browser
            </Btn>
          ) : null}
          {fetcher.data.jobId ? (
            <Btn slot="secondary-actions" href={`/app/jobs/${fetcher.data.jobId}`}>
              Open batch
            </Btn>
          ) : null}
        </s-banner>
      ) : null}

      {jumpedRow ? (
        <s-banner tone="info">
          <s-paragraph>
            Jumped to {jumpedRow.orderName} for {jumpedRow.customerName ?? "a guest"}. It is selected below.
          </s-paragraph>
        </s-banner>
      ) : null}

      {selection.summary.printedCount > 0 ? (
        <s-banner
          tone="warning"
          heading={`${selection.summary.printedCount} of these ${selection.summary.printedCount === 1 ? "was" : "were"} printed already`}
        >
          <s-paragraph>Printing again is fine, but it is how parcels get shipped twice.</s-paragraph>
          <Btn slot="secondary-actions" onClick={selection.excludePrinted}>
            Exclude already printed
          </Btn>
        </s-banner>
      ) : null}

      <s-section padding="none" accessibilityLabel="Orders">
        <SavedViewsBar
          views={data.views}
          activeQuery={queryString}
          hasFilters={data.hasFilters}
          canSave={data.canSave}
          planName={data.planName}
        />
        <s-divider></s-divider>
        {noOrdersSynced ? null : (
          <>
            <s-box padding="base">
              <FiltersBar filters={filters} facets={data.facets} hasFilters={data.hasFilters} queryString={queryString} />
            </s-box>
            <s-divider></s-divider>
          </>
        )}

        <BulkActionBar
          summary={selection.summary}
          spec={selection.spec}
          total={list.total}
          pageRowCount={list.rows.length}
          allOnPageSelected={selection.allOnPageSelected}
          fetcher={fetcher}
          onSelectAllMatching={selection.selectAllMatching}
          onClear={selection.clear}
        />

        {emptyState ? (
          <s-box padding="large">
            <s-empty-state heading={emptyState.heading}>
              <s-paragraph slot="subheading">{emptyState.text}</s-paragraph>
              {emptyState.action === "sync" ? (
                <Btn slot="primary-action" variant="primary" disabled={!canPrint || undefined} onClick={() => fetcher.submit({ intent: "backfill" }, { method: "post" })}>
                  Sync from Shopify
                </Btn>
              ) : null}
              {emptyState.action === "clear" ? (
                <Btn slot="primary-action" href="/app/orders">
                  Clear filters
                </Btn>
              ) : null}
            </s-empty-state>
          </s-box>
        ) : (
          <OrdersTable
            rows={list.rows}
            page={list.page}
            pageCount={list.pageCount}
            total={list.total}
            queryString={queryString}
            isSelected={selection.isSelected}
            allOnPageSelected={selection.allOnPageSelected}
            pageSelectedCount={selection.pageSelectedCount}
            onToggle={selection.toggle}
            onSelectPage={selection.selectPage}
            highlightId={list.jumpToId}
          />
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return <RouteError />;
}
