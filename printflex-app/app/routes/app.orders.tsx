import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { backfillOrders, findOrderIdByName, syncOrderById } from "../lib/orders/sync.server";
import { requireShop } from "../lib/request.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);

  const [count, recent] = await Promise.all([
    prisma.orderIndex.count({ where: { shopId: shop.id } }),
    prisma.orderIndex.findMany({
      where: { shopId: shop.id },
      orderBy: { shopifyUpdatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderName: true,
        customerName: true,
        countryCode: true,
        itemCount: true,
        totalAmount: true,
        currency: true,
        fulfillmentStatus: true,
        documentStatus: true,
        shopifyUpdatedAt: true,
      },
    }),
  ]);

  return {
    count,
    recent: recent.map((o) => ({ ...o, totalAmount: o.totalAmount.toString() })),
  };
};

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { shop, admin } = await requireShop(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "backfill") {
    const summary = await backfillOrders(admin, shop.id);
    return {
      ok: true,
      message: `Synced ${summary.seen} orders across ${summary.pages} pages: ${summary.created} new, ${summary.updated} updated, ${summary.stale} already current.`,
    };
  }

  if (intent === "resync") {
    const orderName = String(form.get("orderName") ?? "").trim();
    if (!orderName) {
      return { ok: false, message: "Enter an order number such as #1001, then try again." };
    }
    const orderId = await findOrderIdByName(admin, orderName);
    if (!orderId) {
      return {
        ok: false,
        message: `No order named ${orderName} was found in Shopify. Check the number and try again.`,
      };
    }
    const outcome = await syncOrderById(admin, shop.id, orderId);
    const wording: Record<typeof outcome, string> = {
      created: `${orderName} was added.`,
      updated: `${orderName} was refreshed.`,
      stale: `${orderName} was already up to date.`,
      missing: `${orderName} no longer exists in Shopify.`,
    };
    return { ok: true, message: wording[outcome] };
  }

  return { ok: false, message: "Unknown action." };
};

export default function OrdersPage() {
  const { count, recent } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="Orders">
      <s-banner tone="info" heading="Orders is under construction">
        <s-paragraph>
          Order sync is live: new and changed orders arrive by webhook within
          seconds. The full table with filters, saved views, selection and bulk
          printing arrives in Phase 4.
        </s-paragraph>
      </s-banner>

      {fetcher.data ? (
        <s-banner tone={fetcher.data.ok ? "success" : "critical"}>
          <s-paragraph>{fetcher.data.message}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Sync">
        <s-paragraph>
          {count === 0
            ? "No orders synced yet. Run a sync to pull the last 60 days of orders from Shopify."
            : `${count} orders synced. Sync runs automatically on install and on every order webhook.`}
        </s-paragraph>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="backfill" />
          <s-button type="submit" variant="primary" disabled={busy || undefined}>
            {busy ? "Syncing…" : "Sync all orders now"}
          </s-button>
        </fetcher.Form>
        <s-divider />
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="resync" />
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-text-field
              name="orderName"
              label="Re-sync one order"
              placeholder="#1001"
            ></s-text-field>
            <s-button type="submit" disabled={busy || undefined}>
              Re-sync
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Most recently updated">
        {recent.length === 0 ? (
          <s-paragraph>Nothing here yet. Synced orders will appear in this list.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Items</s-table-header>
              <s-table-header>Total</s-table-header>
              <s-table-header>Fulfilment</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recent.map((order) => (
                <s-table-row key={order.id}>
                  <s-table-cell>{order.orderName}</s-table-cell>
                  <s-table-cell>
                    {order.customerName ?? "—"}
                    {order.countryCode ? ` · ${order.countryCode}` : ""}
                  </s-table-cell>
                  <s-table-cell>{order.itemCount}</s-table-cell>
                  <s-table-cell>
                    {order.totalAmount} {order.currency}
                  </s-table-cell>
                  <s-table-cell>{order.fulfillmentStatus}</s-table-cell>
                  <s-table-cell>
                    <s-badge>{order.documentStatus}</s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
