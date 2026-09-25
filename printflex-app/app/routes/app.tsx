import { isRouteErrorResponse, Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { RouteError } from "../components/RouteError";
import type { HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import { PlanBar } from "../components/PlanBar";
import { PLAN_ORDER, PLANS, planPills } from "../lib/plans.server";
import appStyles from "../styles/app.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: appStyles }];
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
      planId: usage.plan.id,
      planName: usage.plan.name,
      pills: planPills(usage.plan.id),
      planOptions: PLAN_ORDER.map((id) => ({ id, name: PLANS[id].name })),
      promptUpgrade: shop.limitBehaviour === "PROMPT_UPGRADE",
    },
  };
};

export default function App() {
  const { apiKey, usage } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  // Home has its own plan bar and meter card, so the strip would repeat them.
  const onHome = pathname.replace(/\/$/, "") === "/app";

  return (
    <AppProvider embedded apiKey={apiKey}>
      {!onHome ? (
        <div className="pf-planbar-wrap">
          <PlanBar
            planId={usage.planId}
            planName={usage.planName}
            planOptions={usage.planOptions}
            pills={usage.pills}
            used={usage.used}
            limit={usage.limit}
            daysRemaining={usage.daysRemaining}
            promptUpgrade={usage.promptUpgrade}
          />
        </div>
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
