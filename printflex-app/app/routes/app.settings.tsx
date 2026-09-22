import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function SettingsPage() {
  return (
    <s-page heading="Settings">
      <s-banner tone="info" heading="Settings is under construction">
        <s-paragraph>
          This screen will hold your bin location map, bundle map, pack
          behaviour, store PIN and devices, and the tag names PrintFlex writes
          to Shopify. Settings arrive in Phase 12.
        </s-paragraph>
      </s-banner>

      <s-section heading="Warehouse">
        <s-paragraph>
          Bin location map as a CSV of SKU to bin with an optional walking
          sequence, so pick lists sort into walking order. Bundle map for
          products that expand into components when packing.
        </s-paragraph>
      </s-section>

      <s-section heading="Pack behaviour">
        <s-paragraph>
          Require every item to be checked, show product photos, strict mode
          that scans each product barcode, ask for parcel weight, and allow
          short-pick and damage reports.
        </s-paragraph>
      </s-section>

      <s-section heading="Staff access">
        <s-paragraph>
          Store PIN with rotation and a register of devices with last-seen time
          and revoke.
        </s-paragraph>
      </s-section>

      <s-section heading="Tags written to Shopify">
        <s-paragraph>
          Printed, Packed and Needs review tag names, each renameable.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
