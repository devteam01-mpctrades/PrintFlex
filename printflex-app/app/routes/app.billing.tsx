import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function BillingPage() {
  return (
    <s-page heading="Plans & billing">
      <s-banner tone="info" heading="Plans & billing is under construction">
        <s-paragraph>
          This screen will show your usage against your plan limit, let you
          choose what happens at the limit, and change plans through Shopify&rsquo;s
          own charge screen. Billing arrives in Phase 11.
        </s-paragraph>
      </s-banner>

      <s-section heading="This billing period">
        <s-paragraph>
          What counts as one order. One unit is one order for which at least
          one PrintFlex document was generated this calendar month, in your
          store&rsquo;s timezone. Reprinting the same order this month is free. A
          pick list covering 40 orders counts those 40 once. A failed render
          counts nothing. Orders you never print are never counted.
        </s-paragraph>
      </s-section>

      <s-section heading="When you reach the limit">
        <s-paragraph>
          Stop and wait for the period to reset, or ask to be prompted to
          upgrade. PrintFlex never upgrades your plan by itself and never
          charges for an overage you did not approve.
        </s-paragraph>
      </s-section>

      <s-section heading="Plans">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>Free</s-heading>
            <s-paragraph>$0 forever</s-paragraph>
            <s-unordered-list>
              <s-list-item>50 metered orders a month</s-list-item>
              <s-list-item>All three document types</s-list-item>
              <s-list-item>QR, barcode and scan mode</s-list-item>
              <s-list-item>One template</s-list-item>
            </s-unordered-list>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>Premium</s-heading>
            <s-paragraph>$4.99 a month</s-paragraph>
            <s-unordered-list>
              <s-list-item>500 metered orders a month</s-list-item>
              <s-list-item>Unlimited templates</s-list-item>
              <s-list-item>Automatic invoice email</s-list-item>
              <s-list-item>Saved views and email support</s-list-item>
            </s-unordered-list>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>Unlimited</s-heading>
            <s-paragraph>$9.99 a month</s-paragraph>
            <s-unordered-list>
              <s-list-item>No order cap</s-list-item>
              <s-list-item>Refund and credit documents</s-list-item>
              <s-list-item>Per-market template variants</s-list-item>
              <s-list-item>Priority support</s-list-item>
            </s-unordered-list>
          </s-box>
        </s-grid>
        <s-paragraph>
          All charges are made through Shopify&rsquo;s Billing API and appear on your
          Shopify invoice. Uninstalling cancels the subscription the same day.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
