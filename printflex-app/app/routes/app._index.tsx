import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { listSendLog, sendInvoiceEmail } from "../lib/email/invoice-email.server";
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
  const sends = await listSendLog(shop.id, 10);
  return {
    timezone: shop.timezone,
    sends,
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
  if (form.get("intent") !== "resend") return { ok: false, message: "Unknown action." };
  const status = await sendInvoiceEmail({ shopId: shop.id, orderId: String(form.get("orderId") ?? ""), trigger: "manual", manual: true }, { client: admin, pdf: puppeteerRenderer });
  return status === "SENT"
    ? { ok: true, message: "Invoice sent again." }
    : { ok: false, message: status === "SKIPPED" ? "This order has no customer email, so nothing was sent." : "The invoice could not be sent. The reason is in the log below." };
};

export default function HomePage() {
  const { batches, timezone, sends } = useLoaderData<typeof loader>();
  const resend = useFetcher<{ ok: boolean; message: string }>();
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <s-page heading="PrintFlex">
      <s-banner tone="info" heading="Home is under construction">
        <s-paragraph>
          This screen will show your plan, orders metered this month, what is
          waiting to print and what was packed today, with a one-click morning
          batch and your recent batches. Plan and meter data arrive in later
          phases.
        </s-paragraph>
      </s-banner>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        <s-section heading="Your plan">
          <s-paragraph>
            Your current plan and what it includes. Not connected yet.
          </s-paragraph>
        </s-section>
        <s-section heading="Orders metered this month">
          <s-paragraph>
            Counted once per order, only when a document is generated.
          </s-paragraph>
        </s-section>
        <s-section heading="Waiting to print">
          <s-paragraph>
            Unfulfilled orders with no document yet. Not connected yet.
          </s-paragraph>
        </s-section>
        <s-section heading="Packed today">
          <s-paragraph>
            Orders marked packed from scan mode today. Not connected yet.
          </s-paragraph>
        </s-section>
      </s-grid>

      <s-section heading="Start the morning batch">
        <s-paragraph>
          One combined PDF with an invoice and packing slip per order, plus a
          single pick list merged by bin location. Every page carries a QR code
          and a Code 128 barcode.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button href="/app/templates">Edit template</s-button>
          <s-button href="/app/scan-pack">Open scan mode</s-button>
          <s-button variant="primary" disabled>
            Print unfulfilled
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
