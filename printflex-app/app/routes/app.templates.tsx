import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function TemplatesPage() {
  return (
    <s-page heading="Templates">
      <s-banner tone="info" heading="Templates is under construction">
        <s-paragraph>
          This screen will hold your invoice, packing slip and pick list
          templates, their assignment rules, brand settings, field toggles and
          a live preview rendered against a real order. Template studio
          arrives in Phase 7.
        </s-paragraph>
      </s-banner>

      <s-section heading="Templates">
        <s-paragraph>
          No templates yet. Each template has a document type, an assignment
          rule such as all orders, a destination country or an order tag, and a
          version history you can preview and restore.
        </s-paragraph>
      </s-section>

      <s-section heading="Preview">
        <s-paragraph>
          The preview renders against a real order you pick, so you test the
          layout on your longest product names before printing hundreds of
          copies.
        </s-paragraph>
      </s-section>

      <s-section heading="Settings">
        <s-paragraph>
          Logo, accent colour, fonts, paper size and density.
        </s-paragraph>
        <s-divider />
        <s-heading>Assign to</s-heading>
        <s-paragraph>
          Document type, and optionally destination country, market or order
          tag.
        </s-paragraph>
        <s-divider />
        <s-heading>Show on this document</s-heading>
        <s-paragraph>
          Unit prices, tax breakdown, SKU, QR code, barcode, bin location,
          customer phone, HS code and more.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
