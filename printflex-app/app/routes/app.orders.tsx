import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function OrdersPage() {
  return (
    <s-page heading="Orders">
      <s-banner tone="info" heading="Orders is under construction">
        <s-paragraph>
          This screen will list every order with its customer, item count,
          total, which documents exist and its status. You will filter by
          fulfilment, tag, date, country, shipping method and document status,
          save views, select orders across pages, and print invoices, packing
          slips and pick lists in bulk. Order sync arrives in Phase 3 and the
          table in Phase 4.
        </s-paragraph>
      </s-banner>

      <s-section heading="Saved views">
        <s-paragraph>
          Bookmarkable filter combinations. Free plan includes three built-in
          views; paid plans add unlimited saved views.
        </s-paragraph>
      </s-section>

      <s-section heading="Filters">
        <s-paragraph>
          Fulfilment status, tag, date range, country, shipping method and
          document status. Filters combine and live in the URL.
        </s-paragraph>
      </s-section>

      <s-section heading="Orders">
        <s-paragraph>
          No orders synced yet. Once orders are synced they will appear here
          with New, Printed, Packed or Needs review status. Selecting orders
          that were already printed shows a warning with an option to exclude
          them. It warns, it never blocks.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
