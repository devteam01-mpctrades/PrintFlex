import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import prisma from "../db.server";
import { listSendLog, sendInvoiceEmail } from "../lib/email/invoice-email.server";
import { createDocumentJob } from "../lib/jobs/create-job.server";
import { getQueue } from "../lib/jobs/worker.server";
import { capacityMessage, checkCapacity } from "../lib/meter.server";
import { onboardingState } from "../lib/onboarding.server";
import { audit } from "../lib/audit.server";
import { parseSettings, updateShopSettings } from "../lib/settings.server";
import { puppeteerRenderer } from "../lib/render/pdf.server";
import { requireShop } from "../lib/request.server";
import type { DocumentType, JobState } from "../lib/types";

const DOC_LABEL: Record<DocumentType, string> = {
  INVOICE: "Invoice",
  PACKING_SLIP: "Packing slip",
  PICK_LIST: "Pick list",
};

const STATE_BADGE: Record<JobState, { label: string; tone: "neutral" | "info" | "success" | "critical" | "warning" }> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Rendering", tone: "info" },
  SUCCEEDED: { label: "Ready", tone: "success" },
  FAILED: { label: "Failed", tone: "critical" },
  CANCELLED: { label: "Cancelled", tone: "warning" },
  PRINTED_IN_FALLBACK: { label: "Printed in fallback", tone: "warning" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const jobs = await prisma.documentJob.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const [sends, onboarding, waiting, packedToday, needsReview] = await Promise.all([
    listSendLog(shop.id, 10),
    onboardingState(shop.id),
    prisma.orderIndex.count({ where: { shopId: shop.id, fulfillmentStatus: "UNFULFILLED", documentStatus: "NEW", cancelledAt: null } }),
    prisma.packEvent.count({ where: { shopId: shop.id, outcome: "PACKED", occurredAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    prisma.orderIndex.count({ where: { shopId: shop.id, documentStatus: "NEEDS_REVIEW" } }),
  ]);
  const settings = parseSettings(shop.settingsJson);
  return {
    timezone: shop.timezone,
    sends,
    onboarding,
    waiting,
    packedToday,
    needsReview,
    store: { domain: shop.domain, timezone: shop.timezone, tags: settings.tagNames },
    documentSet: settings.defaults.documentSet,
    batches: jobs.map((job) => ({
      id: job.id,
      label: `BATCH-${job.id.slice(-6).toUpperCase()}`,
      documents: (JSON.parse(job.documentTypesJson) as DocumentType[]).map((t) => DOC_LABEL[t]).join(" + "),
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
    return { ok: true, message: `Rendering ${orders.length} unfulfilled orders as BATCH-${job.id.slice(-6).toUpperCase()}.`, jobId: job.id };
  }
  if (intent !== "resend") return { ok: false, message: "Unknown action." };
  const status = await sendInvoiceEmail({ shopId: shop.id, orderId: String(form.get("orderId") ?? ""), trigger: "manual", manual: true }, { client: admin, pdf: puppeteerRenderer });
  return status === "SENT"
    ? { ok: true, message: "Invoice sent again." }
    : { ok: false, message: status === "SKIPPED" ? "This order has no customer email, so nothing was sent." : "The invoice could not be sent. The reason is in the log below." };
};

export default function HomePage() {
  const { batches, timezone, sends, onboarding, waiting, packedToday, needsReview, store, documentSet } = useLoaderData<typeof loader>();
  const resend = useFetcher<{ ok: boolean; message: string; jobId?: string }>();
  const steps = [
    { done: onboarding.confirmed, title: "Confirm store details", text: `${store.domain} · ${store.timezone} · tags ${store.tags.printed}, ${store.tags.packed}, ${store.tags.needsReview}.`, action: onboarding.confirmed ? null : { label: "Looks right", onClick: () => resend.submit({ intent: "confirmStore" }, { method: "post" }) }, href: "/app/settings", hrefLabel: "Change in Settings" },
    { done: onboarding.hasLogo, title: "Upload a logo", text: "It prints on every invoice and packing slip.", action: null, href: onboarding.firstTemplateId ? `/app/templates/${onboarding.firstTemplateId}` : "/app/templates", hrefLabel: "Open the template" },
    { done: onboarding.hasPrinted, title: "Print one real order", text: "Pick any order and print an invoice. The QR code on that sheet is the tutorial for step 4.", action: null, href: "/app/orders", hrefLabel: "Open Orders" },
    { done: onboarding.hasScanned, title: "Scan it with a phone", text: "Point the phone camera at the QR code. Set the store PIN in Settings first, then sign in once on the phone.", action: null, href: "/app/settings", hrefLabel: "Set the PIN" },
  ];
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <s-page heading="PrintFlex">
      {resend.data && resend.state === "idle" && !("orderId" in (resend.formData ?? {})) ? (
        <s-banner tone={resend.data.ok ? "success" : "critical"}>
          <s-paragraph>{resend.data.message}</s-paragraph>
          {resend.data.jobId ? <s-button slot="secondary-actions" href={`/app/jobs/${resend.data.jobId}`}>Open batch</s-button> : null}
        </s-banner>
      ) : null}

      {!onboarding.complete ? (
        <s-section heading="Get started">
          <s-stack gap="base">
            {steps.map((step, i) => (
              <s-stack key={step.title} direction="inline" gap="base" alignItems="start">
                <s-badge tone={step.done ? "success" : "neutral"}>{step.done ? "Done" : `Step ${i + 1}`}</s-badge>
                <s-stack gap="small">
                  <s-heading>{step.title}</s-heading>
                  <s-paragraph color="subdued">{step.text}</s-paragraph>
                  {!step.done ? (
                    <s-stack direction="inline" gap="small">
                      {step.action ? <s-button variant="primary" onClick={step.action.onClick}>{step.action.label}</s-button> : null}
                      <s-button variant={step.action ? "tertiary" : "secondary"} href={step.href}>{step.hrefLabel}</s-button>
                    </s-stack>
                  ) : null}
                </s-stack>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        <s-section heading="Waiting to print">
          <s-heading>{waiting}</s-heading>
          <s-paragraph color="subdued">Unfulfilled orders with no document yet</s-paragraph>
        </s-section>
        <s-section heading="Packed today">
          <s-heading>{packedToday}</s-heading>
          <s-paragraph color="subdued">{needsReview} {needsReview === 1 ? "order needs" : "orders need"} review</s-paragraph>
        </s-section>
      </s-grid>

      <s-section heading="Start the morning batch">
        <s-paragraph>
          One combined PDF with {documentSet.map((d) => DOC_LABEL[d].toLowerCase()).join(", ").replace(/, ([^,]*)$/, " and $1")} per order, with a cover sheet.
          Every page carries a QR code and a Code 128 barcode. Change the set in Settings.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button href="/app/templates">Edit template</s-button>
          <s-button href="/app/scan-pack">Scan &amp; pack</s-button>
          <s-button variant="primary" disabled={waiting === 0 || resend.state !== "idle" || undefined} onClick={() => resend.submit({ intent: "morningBatch" }, { method: "post" })}>
            {waiting === 0 ? "Nothing waiting" : `Print ${waiting} unfulfilled`}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Recent batches">
        {batches.length === 0 ? (
          <s-paragraph>
            No batches yet. Print your first orders from the Orders screen and
            they will appear here with their status.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Batch</s-table-header>
              <s-table-header>Documents</s-table-header>
              <s-table-header format="numeric">Orders</s-table-header>
              <s-table-header>Created</s-table-header>
              <s-table-header listSlot="kicker">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {batches.map((batch) => (
                <s-table-row key={batch.id}>
                  <s-table-cell>
                    <s-link href={`/app/jobs/${batch.id}`}>{batch.label}</s-link>
                  </s-table-cell>
                  <s-table-cell>{batch.documents}</s-table-cell>
                  <s-table-cell>
                    <s-text fontVariantNumeric="tabular-nums">{batch.total}</s-text>
                  </s-table-cell>
                  <s-table-cell>{when(batch.createdAt)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATE_BADGE[batch.state].tone}>
                      {batch.state === "RUNNING"
                        ? `Rendering ${Math.round((batch.progress / Math.max(1, batch.total)) * 100)}%`
                        : STATE_BADGE[batch.state].label}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        <s-paragraph color="subdued">
          A batch marked &ldquo;Printed in fallback&rdquo; means the render queue was
          busy, so it printed from the browser instead. Nothing is lost and no
          order is metered twice.
        </s-paragraph>
      </s-section>

      <s-section heading="Invoice emails">
        {resend.data && resend.state === "idle" ? <s-banner tone={resend.data.ok ? "success" : "critical"}><s-paragraph>{resend.data.message}</s-paragraph></s-banner> : null}
        {sends.length === 0 ? (
          <s-paragraph color="subdued">No invoice emails yet. Turn them on per invoice template under Templates.</s-paragraph>
        ) : (
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
                    <s-button variant="tertiary" disabled={resend.state !== "idle" || undefined} onClick={() => resend.submit({ intent: "resend", orderId: send.orderId }, { method: "post" })}>
                      Resend
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return <RouteError />;
}
