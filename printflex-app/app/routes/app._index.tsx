import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function HomePage() {
  return (
    <s-page heading="PrintFlex">
      <s-banner tone="info" heading="Home is under construction">
        <s-paragraph>
          This screen will show your plan, orders metered this month, what is
          waiting to print and what was packed today, with a one-click morning
          batch and your recent batches. Plan and meter data arrive in later
          phases.
        </s-paragraph>
      </s-banner>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        <s-section heading="Your plan">
          <s-paragraph>
            Your current plan and what it includes. Not connected yet.
          </s-paragraph>
        </s-section>
        <s-section heading="Orders metered this month">
          <s-paragraph>
            Counted once per order, only when a document is generated.
          </s-paragraph>
        </s-section>
        <s-section heading="Waiting to print">
          <s-paragraph>
            Unfulfilled orders with no document yet. Not connected yet.
          </s-paragraph>
        </s-section>
        <s-section heading="Packed today">
          <s-paragraph>
            Orders marked packed from scan mode today. Not connected yet.
          </s-paragraph>
        </s-section>
      </s-grid>

      <s-section heading="Start the morning batch">
        <s-paragraph>
          One combined PDF with an invoice and packing slip per order, plus a
          single pick list merged by bin location. Every page carries a QR code
          and a Code 128 barcode.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button href="/app/templates">Edit template</s-button>
          <s-button href="/app/scan-pack">Open scan mode</s-button>
          <s-button variant="primary" disabled>
            Print unfulfilled
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Recent batches">
        <s-paragraph>
          No batches yet. Print your first orders from the Orders screen and
          they will appear here with their status. A batch marked &ldquo;Printed in
          fallback&rdquo; means the render queue was busy, so it printed from the
          browser instead. Nothing is lost and no order is metered twice.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
