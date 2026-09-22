import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
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
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const jobs = await prisma.documentJob.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return {
    timezone: shop.timezone,
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

export default function HomePage() {
  const { batches, timezone } = useLoaderData<typeof loader>();
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
