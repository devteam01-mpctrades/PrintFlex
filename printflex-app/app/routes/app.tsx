import { isRouteErrorResponse, Outlet, useLoaderData, useRouteError } from "react-router";
import { RouteError } from "../components/RouteError";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { getUsage } from "../lib/meter.server";
import { requireShop } from "../lib/request.server";
import { startRetentionScheduler } from "../lib/retention.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  startRetentionScheduler();
  const usage = await getUsage(shop.id);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    usage: {
      used: usage.used,
      limit: usage.limit,
      daysRemaining: usage.daysRemaining,
      planName: usage.plan.name,
      promptUpgrade: shop.limitBehaviour === "PROMPT_UPGRADE",
    },
  };
};

export default function App() {
  const { apiKey, usage } = useLoaderData<typeof loader>();
  const ratio = usage.limit ? usage.used / usage.limit : 0;
  const tone = ratio >= 1 ? "critical" : ratio >= 0.9 ? "warning" : "info";

  return (
    <AppProvider embedded apiKey={apiKey}>
      {usage.limit !== null ? (
        <s-box padding="small" background="subdued">
          <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
            <s-text fontVariantNumeric="tabular-nums">
              {usage.planName}: {usage.used} of {usage.limit} metered orders · {usage.daysRemaining} {usage.daysRemaining === 1 ? "day" : "days"} left
            </s-text>
            {ratio >= 0.9 ? (
              <s-badge tone={tone}>
                {ratio >= 1
                  ? usage.promptUpgrade ? "At the limit · upgrade to keep printing" : "At the limit · paused until the period resets"
                  : usage.promptUpgrade ? "90% used · consider upgrading" : "90% used"}
              </s-badge>
            ) : null}
            <s-link href="/app/billing">Plans &amp; billing</s-link>
          </s-stack>
        </s-box>
      ) : null}
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/orders">Orders</s-link>
        <s-link href="/app/templates">Templates</s-link>
        <s-link href="/app/scan-pack">Scan &amp; pack</s-link>
        <s-link href="/app/billing">Plans &amp; billing</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403) {
    return <RouteError />;
  }
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
