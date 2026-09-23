import type { ActionFunctionArgs, HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import homeStyles from "../styles/home.css?url";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import prisma from "../db.server";
import { listSendLog, sendInvoiceEmail } from "../lib/email/invoice-email.server";
import { batchLabel } from "../lib/jobs/batch-label";
import { createDocumentJob } from "../lib/jobs/create-job.server";
import { getQueue } from "../lib/jobs/worker.server";
import { capacityMessage, checkCapacity, getUsage } from "../lib/meter.server";
import { onboardingState } from "../lib/onboarding.server";
import { packStats } from "../lib/pack/history.server";
import { zonedDayStart } from "../lib/period.server";
import { audit } from "../lib/audit.server";
import { PLANS } from "../lib/plans.server";
import { parseSettings, updateShopSettings } from "../lib/settings.server";
import { puppeteerRenderer } from "../lib/render/pdf.server";
import { requireShop } from "../lib/request.server";
import type { DocumentType, JobState, PlanId } from "../lib/types";

const DOC_LABEL: Record<DocumentType, string> = {
  INVOICE: "Invoice",
  PACKING_SLIP: "Packing slip",
  PICK_LIST: "Pick list",
};

/** Short names used in the Recent batches table, matching the mockup ("Invoice + slip + pick list"). */
const DOC_SHORT: Record<DocumentType, string> = {
  INVOICE: "Invoice",
  PACKING_SLIP: "slip",
  PICK_LIST: "pick list",
};

const STATE_BADGE: Record<JobState, { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "pf-b-neu" },
  RUNNING: { label: "Rendering", className: "pf-b-brand" },
  SUCCEEDED: { label: "Ready", className: "pf-b-ok" },
  FAILED: { label: "Failed", className: "pf-b-crit" },
  CANCELLED: { label: "Cancelled", className: "pf-b-warn" },
  PRINTED_IN_FALLBACK: { label: "Printed in fallback", className: "pf-b-warn" },
};

export const links: LinksFunction = () => [{ rel: "stylesheet", href: homeStyles }];

const PLAN_ORDER: PlanId[] = ["FREE", "PREMIUM", "UNLIMITED"];

function planPills(planId: PlanId): string[] {
  const e = PLANS[planId].entitlements;
  const pills: string[] = [];
  pills.push(e.templates === null ? "Unlimited templates" : e.templates === 1 ? "One template" : `${e.templates} templates`);
  if (e.automaticInvoiceEmail) pills.push("Auto invoice email");
  pills.push(e.savedViews === null ? "Saved views" : `${e.savedViews} saved views`);
  if (e.refundDocuments) pills.push("Refund documents");
  if (e.perMarketTemplates) pills.push("Per-market templates");
  if (e.prioritySupport) pills.push("Priority support");
  return pills;
}

function describeDocuments(types: DocumentType[]): string {
  if (types.length === 1) return `${DOC_LABEL[types[0]]} only`;
  return types.map((t, i) => (i === 0 ? DOC_LABEL[t] : DOC_SHORT[t])).join(" + ");
}

function ageLabel(from: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - from.getTime()) / 3_600_000);
  if (hours < 1) return "under an hour ago";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const showAll = url.searchParams.get("batches") === "all";
  const now = new Date();
  const today = zonedDayStart(new Intl.DateTimeFormat("en-CA", { timeZone: shop.timezone }).format(now), shop.timezone);
  const waitingWhere = { shopId: shop.id, fulfillmentStatus: "UNFULFILLED", documentStatus: "NEW", cancelledAt: null } as const;

  const [jobs, sends, onboarding, usage, indexed, waiting, oldestWaiting, stats] = await Promise.all([
    prisma.documentJob.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: showAll ? 50 : 5 }),
    listSendLog(shop.id, 10),
    onboardingState(shop.id),
    getUsage(shop.id, now),
    prisma.orderIndex.count({ where: { shopId: shop.id } }),
    prisma.orderIndex.count({ where: waitingWhere }),
    prisma.orderIndex.findFirst({ where: waitingWhere, orderBy: { shopifyCreatedAt: "asc" }, select: { shopifyCreatedAt: true } }),
    packStats(shop.id, today, now),
  ]);
  const settings = parseSettings(shop.settingsJson);
  return {
    timezone: shop.timezone,
    sends,
    onboarding,
    /** First run until the first document was ever generated. Derived from Document rows, never a toggle. */
    firstRun: !onboarding.hasPrinted,
    /** The merchant asked, in Settings, to keep the guide on Home after first run. */
    showSetupGuide: settings.showSetupGuide,
    /** Rows in OrderIndex: zero means nothing was ever synced. */
    indexed,
    showAll,
    plan: {
      id: usage.plan.id,
      name: usage.plan.name,
      pills: planPills(usage.plan.id),
      used: usage.used,
      limit: usage.limit,
      daysRemaining: usage.daysRemaining,
      atLimit: usage.atLimit,
    },
    waiting,
    oldestWaiting: oldestWaiting ? ageLabel(oldestWaiting.shopifyCreatedAt, now) : null,
    packedToday: stats.packedToday,
    needsReview: stats.needsReview,
    devicesActive: stats.devicesToday,
    store: { domain: shop.domain, timezone: shop.timezone, tags: settings.tagNames },
    documentSet: settings.defaults.documentSet,
    batches: jobs.map((job) => ({
      id: job.id,
      label: batchLabel(job),
      documents: describeDocuments(JSON.parse(job.documentTypesJson) as DocumentType[]),
      total: job.total,
      progress: job.progress,
      state: job.state as JobState,
      createdAt: job.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin } = await requireShop(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "confirmStore") {
    await updateShopSettings(prisma, shop.id, (current) => ({ ...current, onboardingConfirmedAt: new Date().toISOString() }));
    await audit(shop.id, "merchant", "settings.changed", "onboarding");
    return { ok: true, message: "Store details confirmed." };
  }
  if (intent === "hideGuide") {
    await updateShopSettings(prisma, shop.id, (current) => ({ ...current, showSetupGuide: false }));
    return { ok: true, message: "Setup guide hidden. Bring it back any time from Settings." };
  }
  if (intent === "morningBatch") {
    const settings = parseSettings(shop.settingsJson);
    const orders = await prisma.orderIndex.findMany({
      where: { shopId: shop.id, fulfillmentStatus: "UNFULFILLED", documentStatus: "NEW", cancelledAt: null },
      orderBy: { shopifyCreatedAt: "asc" },
      take: 1000,
      select: { id: true, shopifyOrderId: true },
    });
    if (orders.length === 0) return { ok: false, message: "Nothing is waiting to print: every unfulfilled order already has documents." };
    const capacity = await checkCapacity(shop.id, orders.map((o) => o.shopifyOrderId));
    if (!capacity.allowed) return { ok: false, message: capacityMessage(capacity, shop.timezone) };
    const job = await createDocumentJob({ shopId: shop.id, documentTypes: settings.defaults.documentSet, orderIds: orders.map((o) => o.id), options: { coverSheet: true } });
    await getQueue().enqueue(job.id);
    return { ok: true, message: `Rendering ${orders.length} unfulfilled orders as ${batchLabel(job)}.`, jobId: job.id };
  }
  if (intent !== "resend") return { ok: false, message: "Unknown action." };
  const status = await sendInvoiceEmail({ shopId: shop.id, orderId: String(form.get("orderId") ?? ""), trigger: "manual", manual: true }, { client: admin, pdf: puppeteerRenderer });
  return status === "SENT"
    ? { ok: true, message: "Invoice sent again." }
    : { ok: false, message: status === "SKIPPED" ? "This order has no customer email, so nothing was sent." : "The invoice could not be sent. The reason is in the log below." };
};

export default function HomePage() {
  const data = useLoaderData<typeof loader>();
  const { batches, timezone, sends, onboarding, plan, indexed, waiting, oldestWaiting, packedToday, needsReview, devicesActive, store, documentSet, showAll, firstRun, showSetupGuide } = data;
  const fetcher = useFetcher<{ ok: boolean; message: string; jobId?: string }>();
  const busy = fetcher.state !== "idle";
  const lastIntent = fetcher.formData?.get("intent");
  const notice = fetcher.data && !busy ? fetcher.data : null;

  const steps = [
    {
      done: onboarding.confirmed,
      title: "Confirm store details",
      text: `${store.domain} · ${store.timezone} · tags ${store.tags.printed}, ${store.tags.packed}, ${store.tags.needsReview}.`,
      primary: { label: "Looks right", onClick: () => fetcher.submit({ intent: "confirmStore" }, { method: "post" }) },
      href: "/app/settings",
      hrefLabel: "Change in Settings",
    },
    { done: onboarding.hasLogo, title: "Upload a logo", text: "It prints on every invoice and packing slip.", primary: null, href: onboarding.firstTemplateId ? `/app/templates?template=${onboarding.firstTemplateId}` : "/app/templates", hrefLabel: "Open the template" },
    { done: onboarding.hasPrinted, title: "Print one real order", text: "Pick any order and print an invoice. The QR code on that sheet is the tutorial for step 4.", primary: null, href: "/app/orders", hrefLabel: "Open Orders" },
    { done: onboarding.hasScanned, title: "Scan it with a phone", text: "Point the phone camera at the QR code. Set the store PIN in Settings first, then sign in once on the phone.", primary: null, href: "/app/scan-pack", hrefLabel: "Open Scan & pack" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const currentIndex = steps.findIndex((s) => !s.done);

  const when = (iso: string) => {
    const date = new Date(iso);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
    const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const today = dayKey(new Date());
    const yesterday = dayKey(new Date(Date.now() - 86_400_000));
    const key = dayKey(date);
    if (key === today) return `Today, ${time}`;
    if (key === yesterday) return `Yesterday, ${time}`;
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short" }).format(date)}, ${time}`;
  };

  const ratio = plan.limit ? plan.used / plan.limit : 0;
  const hasPickList = documentSet.includes("PICK_LIST");
  const perOrder = documentSet.filter((d) => d !== "PICK_LIST").map((d) => (d === "INVOICE" ? "an invoice" : "packing slip"));
  const perOrderText = perOrder.length === 2 ? "an invoice and packing slip" : perOrder.length === 1 ? (perOrder[0] === "packing slip" ? "a packing slip" : perOrder[0]) : null;
  const batchDescription = [
    perOrderText ? `One combined PDF with ${perOrderText} per order` : "One combined PDF",
    hasPickList ? (perOrderText ? ", plus a single pick list merged by bin location." : " with a single pick list merged by bin location.") : ".",
    " Every page carries a QR code and a Code\u00a0128 barcode.",
  ].join("");

  // Three honest states for the waiting tile: nothing synced, synced and nothing waiting, or work waiting.
  const waitingDetail =
    indexed === 0 ? (
      <>No orders synced yet · <Link className="pf-link" to="/app/orders">sync from Shopify</Link></>
    ) : waiting === 0 ? (
      "Every unfulfilled order already has documents"
    ) : (
      <>Unfulfilled · oldest placed {oldestWaiting}</>
    );

  const meterTile = (
    <div className={`pf-stat hero${ratio >= 1 ? " crit" : ratio >= 0.9 ? " warn" : ""}`}>
      <div className="k">Orders metered this month</div>
      <div className="v">
        {plan.used} {plan.limit !== null ? <small>of {plan.limit}</small> : <small>no cap</small>}
      </div>
      {plan.limit !== null ? (
        <div className="pf-meterbar" role="progressbar" aria-label="Metered orders used this period" aria-valuemin={0} aria-valuemax={plan.limit} aria-valuenow={plan.used}>
          <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      ) : null}
      <div className="d">
        Counted once per order, only when a document is generated. {plan.daysRemaining} {plan.daysRemaining === 1 ? "day" : "days"} left in this period.
      </div>
    </div>
  );

  // Shopify's setup-guide pattern: progress, finished steps collapsed with a check, only the current step open.
  const setupGuide = (
    <div className="pf-panel">
      <div className="pf-panel__h">
        <h2>Set up PrintFlex</h2>
        <div className="right">
          <span className="pf-badge pf-b-neu">{doneCount} of {steps.length} complete</span>
          {!firstRun ? (
            <s-button variant="tertiary" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "hideGuide" }, { method: "post" })}>Hide</s-button>
          ) : null}
        </div>
      </div>
      <div className="pf-guide__bar"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      <ol className="pf-guide">
        {steps.map((step, i) => {
          const current = i === currentIndex;
          return (
            <li key={step.title} className={step.done ? "done" : current ? "current" : "todo"}>
              <span className="pf-guide__mark" aria-hidden="true">{step.done ? "✓" : i + 1}</span>
              <div className="pf-guide__body">
                <div className="pf-guide__title">{step.title}</div>
                {current ? (
                  <>
                    <p>{step.text}</p>
                    <div className="pf-guide__actions">
                      {/* On first run the guide owns the page's one primary button; alongside the morning batch it steps down. */}
                      {step.primary ? <s-button variant={firstRun ? "primary" : "secondary"} disabled={busy || undefined} onClick={step.primary.onClick}>{step.primary.label}</s-button> : null}
                      <s-button variant={step.primary ? "tertiary" : firstRun ? "primary" : "secondary"} href={step.href}>{step.hrefLabel}</s-button>
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <s-page heading="PrintFlex">
      {notice && lastIntent !== "resend" ? (
        <s-banner tone={notice.ok ? "success" : "critical"} heading={notice.ok ? undefined : "Nothing printed"}>
          <s-paragraph>{notice.message}</s-paragraph>
          {notice.jobId ? <s-button slot="secondary-actions" href={`/app/jobs/${notice.jobId}`}>Open batch</s-button> : null}
        </s-banner>
      ) : null}

      <div className="pf-home">
        {firstRun ? (
          <>
            {/* First run: the guide is the page. One primary button, the current step's. */}
            {setupGuide}
            <div className="pf-stats pf-stats--single">{meterTile}</div>
            <p className="pf-planline">
              You are on the <strong>{plan.name}</strong> plan · {plan.pills.join(" · ")} · <Link className="pf-link" to="/app/billing">Plans &amp; billing</Link>
            </p>
          </>
        ) : (
          <>
            <div className="pf-planbar">
              <div>
                <div className="lbl">Your plan</div>
                <div className="val">{plan.name}</div>
              </div>
              <div className="pf-seg" role="list" aria-label="Plans">
                {PLAN_ORDER.map((id) => (
                  <span key={id} role="listitem" className={id === plan.id ? "on" : undefined} aria-current={id === plan.id ? "true" : undefined}>
                    {PLANS[id].name}
                  </span>
                ))}
              </div>
              <div className="pf-pills">
                {plan.pills.map((pill) => (
                  <span key={pill} className="pf-pill">{pill}</span>
                ))}
              </div>
              <span className="push"><s-button href="/app/billing">Change plan</s-button></span>
            </div>

            {showSetupGuide ? setupGuide : null}

            <div className="pf-stats">
              {meterTile}
              <div className="pf-stat">
                <div className="k">Waiting to print</div>
                <div className="v">{waiting}</div>
                <div className="d">{waitingDetail}</div>
              </div>
              <div className={`pf-stat${needsReview > 0 ? " attention" : ""}`}>
                <div className="k">Packed today</div>
                <div className="v">{packedToday}</div>
                <div className="d">
                  {needsReview > 0 ? <Link className="pf-link" to="/app/orders?docStatus=NEEDS_REVIEW">{needsReview} {needsReview === 1 ? "order needs" : "orders need"} review</Link> : "0 orders need review"}
                  {" · "}{devicesActive} {devicesActive === 1 ? "device" : "devices"} active
                </div>
              </div>
            </div>

            <div className="pf-panel">
              <div className="pf-panel__h">
                <h2>Start the morning batch</h2>
                <div className="right">
                  <s-button href="/app/templates">Edit template</s-button>
                  <s-button href="/app/scan-pack">Open scan mode</s-button>
                  <s-button
                    variant="primary"
                    disabled={waiting === 0 || plan.atLimit || busy || undefined}
                    loading={busy && lastIntent === "morningBatch" ? true : undefined}
                    onClick={() => fetcher.submit({ intent: "morningBatch" }, { method: "post" })}
                  >
                    {indexed === 0 ? "No orders synced" : waiting === 0 ? "Nothing waiting" : plan.atLimit ? "At the plan limit" : `Print ${waiting} unfulfilled`}
                  </s-button>
                </div>
              </div>
              <div className="pf-panel__b tight">
                <p>{batchDescription}</p>
              </div>
              {plan.atLimit ? (
                <div className="pf-panel__note">
                  <strong>Paused at the limit.</strong> You have used every metered order on the {plan.name} plan this period. Printing resumes when the period resets, or sooner if you{" "}
                  <Link className="pf-link" to="/app/billing">change plan</Link>.
                </div>
              ) : null}
            </div>

            <div className="pf-panel">
              <div className="pf-panel__h">
                <h2>{showAll ? "All batches" : "Recent batches"}</h2>
                {batches.length > 0 ? (
                  <div className="right">
                    <s-button variant="tertiary" href={showAll ? "/app" : "/app?batches=all"}>{showAll ? "Show recent" : "View all"}</s-button>
                  </div>
                ) : null}
              </div>
              {batches.length === 0 ? (
                <div className="pf-panel__empty">
                  <p>No batches yet. Print your first orders from the Orders screen and they will appear here with their status.</p>
                  <s-button href="/app/orders">Open Orders</s-button>
                </div>
              ) : (
                <>
                  <div className="pf-tscroll">
                    <table className="pf-t">
                      <thead>
                        <tr>
                          <th>Batch</th>
                          <th>Documents</th>
                          <th className="num">Orders</th>
                          <th>Created</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batches.map((batch) => (
                          <tr key={batch.id}>
                            <td className="pf-mono">
                              <Link className="pf-link" to={`/app/jobs/${batch.id}`}>{batch.label}</Link>
                            </td>
                            <td>{batch.documents}</td>
                            <td className="num">{batch.total}</td>
                            <td>{when(batch.createdAt)}</td>
                            <td>
                              <span className={`pf-badge ${STATE_BADGE[batch.state].className}`}>
                                {batch.state === "RUNNING"
                                  ? `Rendering ${Math.round((batch.progress / Math.max(1, batch.total)) * 100)}%`
                                  : STATE_BADGE[batch.state].label}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pf-panel__note">
                    <strong>Printed in fallback</strong> means the render queue was busy, so the batch printed from the browser instead. Nothing was lost and no order was metered twice.
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {sends.length > 0 ? (
        <s-section heading="Invoice emails">
          {notice && lastIntent === "resend" ? <s-banner tone={notice.ok ? "success" : "critical"}><s-paragraph>{notice.message}</s-paragraph></s-banner> : null}
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>To</s-table-header>
              <s-table-header>Trigger</s-table-header>
              <s-table-header>When</s-table-header>
              <s-table-header listSlot="kicker">Status</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {sends.map((send) => (
                <s-table-row key={send.id}>
                  <s-table-cell><s-text fontVariantNumeric="tabular-nums">{send.orderName}</s-text></s-table-cell>
                  <s-table-cell>{send.to || "—"}</s-table-cell>
                  <s-table-cell>{send.trigger}</s-table-cell>
                  <s-table-cell>{when(send.sentAt ?? send.createdAt)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={send.status === "SENT" ? "success" : send.status === "FAILED" ? "critical" : "neutral"}>{send.status.toLowerCase()}</s-badge>
                    {send.error ? <s-text color="subdued"> {send.error}</s-text> : null}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button variant="tertiary" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "resend", orderId: send.orderId }, { method: "post" })}>
                      Resend
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return <RouteError />;
}
