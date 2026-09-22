import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { BulkActionBar } from "../components/orders/BulkActionBar";
import { FiltersBar } from "../components/orders/FiltersBar";
import { OrdersTable } from "../components/orders/OrdersTable";
import { SavedViewsBar } from "../components/orders/SavedViewsBar";
import { useSelection } from "../components/orders/useSelection";
import { createDocumentJob, markOrdersPrinted, parseDocumentTypes } from "../lib/jobs/create-job.server";
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
import { backfillOrders } from "../lib/orders/sync.server";
import { getPlan } from "../lib/plans.server";
import { requireShop } from "../lib/request.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const filters = parseFilters(url.searchParams);

  const [list, facets, views, canSave] = await Promise.all([
    listOrders(shop.id, filters, shop.timezone),
    loadFacets(shop.id),
    listSavedViews(shop.id),
    canSaveView(shop.id, shop.plan),
  ]);

  return {
    shopId: shop.id,
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
      const job = await createDocumentJob({
        shopId: shop.id,
        documentTypes,
        orderIds: orders.map((o) => o.id),
      });
      const what = documentTypes.map((t) => DOCUMENT_WORDS[t]).join(", ");
      return {
        ok: true,
        clearSelection: true,
        message:
          `Queued ${what} for ${orders.length} orders as job ${job.id.slice(-6).toUpperCase()}. ` +
          (truncated ? "The selection was capped at 1,000 orders. " : "") +
          "Rendering is not built yet; the job will start producing PDFs in Phase 5.",
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
      const summary = await backfillOrders(admin, shop.id);
      return {
        ok: true,
        message: `Synced ${summary.seen} orders: ${summary.created} new, ${summary.updated} updated, ${summary.stale} already current.`,
      };
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
  const syncing = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "backfill";

  return (
    <s-page heading="Orders">
      <s-button
        slot="secondary-actions"
        disabled={syncing || undefined}
        onClick={() => fetcher.submit({ intent: "backfill" }, { method: "post" })}
      >
        {syncing ? "Syncing…" : "Sync from Shopify"}
      </s-button>

      {fetcher.data && fetcher.state === "idle" ? (
        <s-banner tone={fetcher.data.ok ? "success" : "critical"}>
          <s-paragraph>{fetcher.data.message}</s-paragraph>
        </s-banner>
      ) : null}

      {jumpedRow ? (
        <s-banner tone="info">
          <s-paragraph>
            Jumped to {jumpedRow.orderName} for {jumpedRow.customerName ?? "a guest"}. It is selected
            below.
          </s-paragraph>
        </s-banner>
      ) : null}

      <SavedViewsBar
        views={data.views}
        activeQuery={queryString}
        hasFilters={data.hasFilters}
        canSave={data.canSave}
        planName={data.planName}
      />

      <s-section heading="Filters">
        <FiltersBar filters={filters} facets={data.facets} hasFilters={data.hasFilters} />
      </s-section>

      <BulkActionBar
        summary={selection.summary}
        spec={selection.spec}
        total={list.total}
        pageRowCount={list.rows.length}
        allOnPageSelected={selection.allOnPageSelected}
        fetcher={fetcher}
        onSelectAllMatching={selection.selectAllMatching}
        onClear={selection.clear}
        onExcludePrinted={selection.excludePrinted}
      />

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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
