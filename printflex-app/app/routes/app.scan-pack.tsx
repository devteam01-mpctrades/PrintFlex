import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function ScanPackPage() {
  return (
    <s-page heading="Scan & pack">
      <s-banner tone="info" heading="Scan & pack is under construction">
        <s-paragraph>
          This screen will show what was packed today, live batch progress and
          the scan history from every device on the floor. The phone-side scan
          page arrives in Phases 8 to 10.
        </s-paragraph>
      </s-banner>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        <s-section heading="Packed today">
          <s-paragraph>Orders packed across all devices. Not connected yet.</s-paragraph>
        </s-section>
        <s-section heading="Median time per parcel">
          <s-paragraph>From first scan to packed. Not connected yet.</s-paragraph>
        </s-section>
        <s-section heading="Needs review">
          <s-paragraph>
            Short-picked or damaged, flagged by staff, not discovered by a
            customer.
          </s-paragraph>
        </s-section>
      </s-grid>

      <s-section heading="Batch progress">
        <s-paragraph>
          No batch in progress. Scan a batch cover sheet to open its progress
          on any phone on the floor.
        </s-paragraph>
      </s-section>

      <s-section heading="Scan history">
        <s-paragraph>
          No scans yet. Staff sign in with a store PIN and a device name. No
          Shopify accounts, no staff seats used.
        </s-paragraph>
      </s-section>

      <s-section heading="What the packer sees">
        <s-paragraph>
          Staff point a phone at the QR or barcode on the printed sheet, see
          the order with product photos from Shopify, check items off and mark
          it packed or flag what they could not complete.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
