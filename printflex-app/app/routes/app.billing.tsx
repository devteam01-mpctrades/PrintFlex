import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useNativeEvent } from "../components/orders/useNativeEvent";
import { useRef } from "react";
import prisma from "../db.server";
import { cancelSubscription, requestPlan, setLimitBehaviour, syncSubscription } from "../lib/billing/billing.server";
import { getUsage } from "../lib/meter.server";
import { periodStart } from "../lib/period.server";
import { PLANS } from "../lib/plans.server";
import { requireShop } from "../lib/request.server";
import type { LimitBehaviour, PlanId } from "../lib/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, billing } = await requireShop(request);
  const state = await syncSubscription(billing, shop.id);
  const usage = await getUsage(shop.id);
  const start = periodStart(usage.period, shop.timezone);
  const ordersThisPeriod = await prisma.orderIndex.count({ where: { shopId: shop.id, shopifyCreatedAt: { gte: start, lt: usage.periodEndsAt } } });
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: shop.timezone, day: "numeric", month: "long" });
  const url = new URL(request.url);
  return {
    planId: state.planId,
    annual: state.annual,
    subscriptionId: state.subscription?.id ?? null,
    limitBehaviour: (shop.limitBehaviour as LimitBehaviour) ?? "HARD_CAP",
    usage: {
      used: usage.used,
      limit: usage.limit,
      daysRemaining: usage.daysRemaining,
      periodLabel: `${fmt.format(start)} – ${fmt.format(new Date(usage.periodEndsAt.getTime() - 1))} · ${shop.timezone}`,
      resetLabel: fmt.format(usage.periodEndsAt),
      ordersThisPeriod,
    },
    justChanged: url.searchParams.get("changed") === "1",
    plans: (["FREE", "PREMIUM", "UNLIMITED"] as PlanId[]).map((id) => ({
      id,
      name: PLANS[id].name,
      monthly: PLANS[id].monthlyPriceUsd,
      annual: PLANS[id].annualPriceUsd,
      limit: PLANS[id].monthlyOrderLimit,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, billing } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");
  const returnUrl = `${appUrl}/app/billing?changed=1`;

  if (intent === "choose") {
    const plan = String(form.get("plan") ?? "");
    const annual = form.get("annual") === "1";
    if (plan === "PREMIUM" || plan === "UNLIMITED") {
      // Shopify's charge screen. This never returns; it redirects the merchant to approve.
      return requestPlan(billing, plan, annual, returnUrl);
    }
    if (plan === "FREE") {
      const state = await syncSubscription(billing, shop.id);
      if (state.subscription) await cancelSubscription(billing, shop.id, state.subscription.id);
      return { ok: true, message: "You are on the Free plan. The subscription was cancelled through Shopify and prorated." };
    }
    return { ok: false, message: "Choose a plan." };
  }
  if (intent === "limit") {
    const behaviour = String(form.get("limitBehaviour") ?? "");
    if (behaviour !== "HARD_CAP" && behaviour !== "PROMPT_UPGRADE") return { ok: false, message: "Choose what happens at the limit." };
    await setLimitBehaviour(shop.id, behaviour);
    return { ok: true, message: behaviour === "HARD_CAP" ? "At the limit, document generation pauses until the period resets." : "At 90% and at the limit you will be asked whether to upgrade. Nothing changes unless you approve it on Shopify." };
  }
  return { ok: false, message: "Unknown action." };
};

export default function BillingPage() {
  const { planId, annual, limitBehaviour, usage, plans, justChanged } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const limitRef = useRef<HTMLFormElement>(null);
  useNativeEvent(limitRef, "change", () => {
    if (!limitRef.current) return;
    const form = new FormData(limitRef.current);
    form.set("intent", "limit");
    fetcher.submit(form, { method: "post" });
  });
  const busy = fetcher.state !== "idle";
  const ratio = usage.limit ? usage.used / usage.limit : 0;
  const money = (v: number) => `$${v.toFixed(2)}`;

  return (
    <s-page heading="Plans & billing">
      {justChanged ? <s-banner tone="success"><s-paragraph>Your plan was updated through Shopify.</s-paragraph></s-banner> : null}
      {fetcher.data && !busy ? <s-banner tone={fetcher.data.ok ? "success" : "critical"}><s-paragraph>{fetcher.data.message}</s-paragraph></s-banner> : null}

      <s-section heading="This billing period">
        <s-paragraph color="subdued">{usage.periodLabel}</s-paragraph>
        <s-stack direction="inline" gap="small" alignItems="baseline">
          <s-heading>{usage.used}</s-heading>
          <s-text>{usage.limit === null ? "metered orders used · no cap" : `of ${usage.limit} metered orders used · ${usage.daysRemaining} ${usage.daysRemaining === 1 ? "day" : "days"} remaining`}</s-text>
        </s-stack>
        {usage.limit !== null ? <s-progress value={usage.used} max={usage.limit} tone={ratio >= 1 ? "critical" : ratio >= 0.9 ? "warning" : "auto"}></s-progress> : null}
        <s-paragraph>
          <s-text type="strong">What counts as one order.</s-text> One unit is one order for which at least one PrintFlex document was generated this
          calendar month, in your store&rsquo;s timezone. Reprinting the same order this month is free. A pick list covering 40 orders counts those
          40 once. A failed render counts nothing. Orders you never print are never counted &mdash; your store received {usage.ordersThisPeriod} orders this
          month and {usage.used} of them used the app.
        </s-paragraph>
      </s-section>

      <s-section heading="When you reach the limit">
        <form ref={limitRef} onSubmit={(e) => e.preventDefault()}>
          <s-choice-list name="limitBehaviour" label="Limit behaviour" labelAccessibilityVisibility="exclusive" values={[limitBehaviour]}>
            <s-choice value="HARD_CAP">
              Stop and wait for the period to reset
              <s-text slot="details">Document generation pauses at {usage.limit ?? "the cap"}. Nothing is charged and no plan changes. You can upgrade any time from this page.</s-text>
            </s-choice>
            <s-choice value="PROMPT_UPGRADE">
              Ask me to upgrade
              <s-text slot="details">We show a prompt at 90% and again at the limit. Upgrading always goes through Shopify&rsquo;s own charge screen.</s-text>
            </s-choice>
          </s-choice-list>
        </form>
        <s-paragraph color="subdued">PrintFlex never upgrades your plan by itself and never charges for an overage you did not approve.</s-paragraph>
      </s-section>

      <s-section heading="Plans">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {plans.map((p) => {
            const current = p.id === planId;
            const features: Record<PlanId, string[]> = {
              FREE: ["50 metered orders a month", "All three document types", "QR, barcode and scan mode", "One template"],
              PREMIUM: ["500 metered orders a month", "Unlimited templates", "Automatic invoice email", "Saved views and email support"],
              UNLIMITED: ["No order cap", "Refund and credit documents", "Per-market template variants", "Priority support"],
            };
            return (
              <s-box key={p.id} padding="base" borderWidth="base" borderRadius="base" background={current ? "subdued" : "base"}>
                <s-stack gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-heading>{p.name}</s-heading>
                    {current ? <s-badge tone="success">Current{annual ? " · annual" : ""}</s-badge> : null}
                  </s-stack>
                  <s-paragraph>{p.monthly === 0 ? "$0 forever" : `${money(p.monthly)} a month, or ${money(p.annual)} a year (ten months’ price)`}</s-paragraph>
                  <s-unordered-list>
                    {features[p.id].map((f) => <s-list-item key={f}>{f}</s-list-item>)}
                  </s-unordered-list>
                  {p.id === "FREE" ? (
                    <s-button disabled={current || busy || undefined} onClick={() => fetcher.submit({ intent: "choose", plan: "FREE" }, { method: "post" })}>
                      {current ? "Your plan" : "Downgrade to Free"}
                    </s-button>
                  ) : (
                    <s-stack direction="inline" gap="small">
                      <s-button variant={current && !annual ? "secondary" : "primary"} disabled={(current && !annual) || busy || undefined} onClick={() => fetcher.submit({ intent: "choose", plan: p.id, annual: "0" }, { method: "post" })}>
                        {current && !annual ? "Your plan" : "Monthly"}
                      </s-button>
                      <s-button variant="secondary" disabled={(current && annual) || busy || undefined} onClick={() => fetcher.submit({ intent: "choose", plan: p.id, annual: "1" }, { method: "post" })}>
                        {current && annual ? "Your plan" : "Annual"}
                      </s-button>
                    </s-stack>
                  )}
                </s-stack>
              </s-box>
            );
          })}
        </s-grid>
        <s-paragraph color="subdued">
          All charges are made through Shopify&rsquo;s Billing API and appear on your Shopify invoice. No card or payment detail ever reaches PrintFlex.
          Uninstalling cancels the subscription the same day.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
