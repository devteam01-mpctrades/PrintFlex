import type { ActionFunctionArgs, HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import { useState } from "react";
import billingStyles from "../styles/billing.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: billingStyles }];
import prisma from "../db.server";
import { cancelSubscription, requestPlan, setLimitBehaviour, syncSubscription } from "../lib/billing/billing.server";
import { getUsage } from "../lib/meter.server";
import { periodStart } from "../lib/period.server";
import { PLAN_COPY, PLAN_ORDER, PLANS } from "../lib/plans.server";
import { requireShop } from "../lib/request.server";
import { Btn } from "../components/ui";
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
      periodLabel: `${new Intl.DateTimeFormat("en-GB", { timeZone: shop.timezone, day: "numeric" }).format(start)} – ${fmt.format(new Date(usage.periodEndsAt.getTime() - 1))} · ${shop.timezone}`,
      resetLabel: fmt.format(usage.periodEndsAt),
      ordersThisPeriod,
    },
    justChanged: url.searchParams.get("changed") === "1",
    plans: PLAN_ORDER.map((id) => ({
      id,
      name: PLANS[id].name,
      monthly: PLANS[id].monthlyPriceUsd,
      annual: PLANS[id].annualPriceUsd,
      limit: PLANS[id].monthlyOrderLimit,
      ...PLAN_COPY[id],
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

const PLAN_RANK: Record<PlanId, number> = { FREE: 0, PREMIUM: 1, UNLIMITED: 2 };

export default function BillingPage() {
  const { planId, annual, limitBehaviour, usage, plans, justChanged } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [yearly, setYearly] = useState(annual);
  const busy = fetcher.state !== "idle";
  const ratio = usage.limit ? usage.used / usage.limit : 0;
  const money = (v: number) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
  const setLimit = (behaviour: LimitBehaviour) => {
    if (behaviour !== limitBehaviour) fetcher.submit({ intent: "limit", limitBehaviour: behaviour }, { method: "post" });
  };

  return (
    <s-page heading="Plans & billing" inlineSize="large">
      {justChanged ? <s-banner tone="success"><s-paragraph>Your plan was updated through Shopify.</s-paragraph></s-banner> : null}
      {fetcher.data && !busy ? <s-banner tone={fetcher.data.ok ? "success" : "critical"}><s-paragraph>{fetcher.data.message}</s-paragraph></s-banner> : null}

      <div className="pf-billing">
        <div className="pf-panel">
          <div className="pf-panel__h">
            <h2>This billing period</h2>
            <div className="right"><span className="pf-badge pf-b-brand">{usage.periodLabel}</span></div>
          </div>
          <div className="pf-panel__b">
            <div className="pf-usage">
              <span className={`n${ratio >= 1 ? " crit" : ""}`}>{usage.used}</span>
              <span className="t">
                {usage.limit === null
                  ? "metered orders used · no cap on this plan"
                  : `of ${usage.limit} metered orders used · ${usage.daysRemaining} ${usage.daysRemaining === 1 ? "day" : "days"} remaining`}
              </span>
            </div>
            {usage.limit !== null ? (
              <div className={`pf-meterbar${ratio >= 1 ? " crit" : ""}`} role="progressbar" aria-label="Metered orders used" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.used}>
                <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
              </div>
            ) : null}
            <div className="pf-note">
              <b>What counts as one order.</b> One unit is one order for which at least one PrintFlex document was generated this calendar month, in your
              store&rsquo;s timezone. Reprinting the same order this month is free. A pick list covering 40 orders counts those 40 once. A failed render
              counts nothing. <b>Orders you never print are never counted</b> &mdash; your store received {usage.ordersThisPeriod.toLocaleString("en-US")} orders
              this month and {usage.used} of them used the app.
            </div>
          </div>
        </div>

        <div className="pf-plans-head">
          <h2>Plans</h2>
          <div className="pf-seg" role="group" aria-label="Billing interval">
            <button type="button" className={yearly ? "" : "on"} aria-pressed={!yearly} onClick={() => setYearly(false)}>Monthly</button>
            <button type="button" className={yearly ? "on" : ""} aria-pressed={yearly} onClick={() => setYearly(true)}>Annual &mdash; 2 months free</button>
          </div>
        </div>

        <div className="pf-plans">
          {plans.map((p) => {
            const current = p.id === planId;
            const sameInterval = current && (p.id === "FREE" || annual === yearly);
            const higher = PLAN_RANK[p.id] > PLAN_RANK[planId];
            const price = p.id === "FREE" ? "$0" : money(yearly ? p.annual : p.monthly);
            const per = p.id === "FREE" ? "forever" : yearly ? "/year" : "/month";
            const choose = () => fetcher.submit({ intent: "choose", plan: p.id, annual: yearly ? "1" : "0" }, { method: "post" });
            const label = sameInterval ? "Your plan" : current ? (yearly ? "Switch to annual" : "Switch to monthly") : higher ? `Upgrade to ${p.name}` : p.id === "FREE" ? "Downgrade to Free" : `Downgrade to ${p.name}`;
            const note = sameInterval
              ? p.id === "FREE" ? "No payment collected. Free stays $0." : `Billed ${annual ? "yearly" : "monthly"} through Shopify. Cancel any time.`
              : p.id === "FREE" && !current ? "Cancelling is prorated through Shopify. Nothing else to do." : p.note;
            return (
              <div key={p.id} className={`pf-plancard${p.popular ? " pop" : ""}${current ? " cur" : ""}`}>
                {p.popular ? <span className="pf-plancard__flag">Most popular</span> : null}
                <div className="pf-plancard__top">
                  <h3>{p.name}</h3>
                  {current ? <span className="pf-badge pf-b-brand">Current{p.id !== "FREE" ? (annual ? " · annual" : " · monthly") : ""}</span> : null}
                </div>
                <div className="pr">{price}<small>{per}</small></div>
                <span className="pf-chip">{p.chip}</span>
                <p className="tag">{p.tagline}</p>
                <ul>
                  {p.features.map((f) => <li key={f}>{f}</li>)}
                </ul>
                <Btn variant={sameInterval ? "secondary" : p.popular || higher ? "primary" : "secondary"} className="pf-plancard__cta" disabled={sameInterval || busy} loading={busy && !sameInterval} onClick={choose}>
                  {label}
                </Btn>
                <p className="note">{note}</p>
              </div>
            );
          })}
        </div>

        <div className="pf-panel pf-shopify">
          <div>
            <h2>Billed through Shopify.</h2>
            <p>Every paid plan is charged exclusively through Shopify&rsquo;s own Billing API and approved on Shopify&rsquo;s native charge screen. No card or payment detail ever reaches PrintFlex, and uninstalling cancels the subscription the same day.</p>
          </div>
          <ul>
            <li>Cancel any time</li>
            <li>Change plan instantly</li>
            <li>Annual saves two months</li>
          </ul>
        </div>

        <div className="pf-panel">
          <div className="pf-panel__h"><h2>When you reach the limit</h2></div>
          <div className="pf-panel__b">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- the label text is the nested title and description spans */}
            <label htmlFor="limit-hard-cap" className={`pf-radio${limitBehaviour === "HARD_CAP" ? " on" : ""}`}>
              <input id="limit-hard-cap" type="radio" name="limitBehaviour" value="HARD_CAP" checked={limitBehaviour === "HARD_CAP"} disabled={busy} onChange={() => setLimit("HARD_CAP")} />
              <span className="dot" aria-hidden="true" />
              <span>
                <span className="rt">Stop and wait for the period to reset</span>
                <span className="rd">Document generation pauses at {usage.limit ?? "the cap"}. Nothing is charged and no plan changes. You can upgrade any time from this page.</span>
              </span>
            </label>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- the label text is the nested title and description spans */}
            <label htmlFor="limit-prompt" className={`pf-radio${limitBehaviour === "PROMPT_UPGRADE" ? " on" : ""}`}>
              <input id="limit-prompt" type="radio" name="limitBehaviour" value="PROMPT_UPGRADE" checked={limitBehaviour === "PROMPT_UPGRADE"} disabled={busy} onChange={() => setLimit("PROMPT_UPGRADE")} />
              <span className="dot" aria-hidden="true" />
              <span>
                <span className="rt">Ask me to upgrade</span>
                <span className="rd">We show a prompt at 90% and again at the limit. Upgrading always goes through Shopify&rsquo;s own charge screen.</span>
              </span>
            </label>
            <p className="pf-small">PrintFlex never upgrades your plan by itself and never charges for an overage you did not approve.</p>
          </div>
        </div>

      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
