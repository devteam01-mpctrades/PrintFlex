import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import { downloadFile } from "../components/download";
import prisma from "../db.server";
import { getQueue } from "../lib/jobs/worker.server";
import { createPrintLink, shouldOfferFallback } from "../lib/render/fallback.server";
import { batchLabel } from "../lib/render/render-batch.server";
import { requireShop } from "../lib/request.server";
import type { DocumentType, JobState } from "../lib/types";

const DOC_LABEL: Record<DocumentType, string> = {
  INVOICE: "Invoice",
  PACKING_SLIP: "Packing slip",
  PICK_LIST: "Pick list",
};

const STATE: Record<JobState, { label: string; tone: "neutral" | "info" | "success" | "critical" | "warning" }> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Rendering", tone: "info" },
  SUCCEEDED: { label: "Ready", tone: "success" },
  FAILED: { label: "Failed", tone: "critical" },
  CANCELLED: { label: "Cancelled", tone: "warning" },
  PRINTED_IN_FALLBACK: { label: "Printed in fallback", tone: "warning" },
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const job = await prisma.documentJob.findFirst({
    where: { id: params.id, shopId: shop.id },
    include: {
      documents: { orderBy: { renderedAt: "asc" }, include: { order: { select: { orderName: true, customerName: true } } } },
    },
  });
  if (!job) throw new Response("This batch does not exist.", { status: 404 });
  const now = new Date();
  return {
    job: {
      id: job.id,
      label: batchLabel(job.id),
      state: job.state as JobState,
      progress: job.progress,
      total: job.total,
      error: job.error,
      documentTypes: JSON.parse(job.documentTypesJson) as DocumentType[],
      hasOutput: Boolean(job.outputPath),
      hasPickList: Boolean(job.pickListPath),
      outputBytes: job.outputBytes,
      offerFallback: shouldOfferFallback(job, now),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    },
    documents: job.documents.map((d) => ({
      id: d.id,
      type: d.documentType as DocumentType,
      orderName: d.order.orderName,
      customerName: d.order.customerName,
      invoiceNumber: d.invoiceNumber,
    })),
  };
};

type ActionResult = { ok: boolean; message: string; printUrl?: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { shop } = await requireShop(request);
  const job = await prisma.documentJob.findFirst({ where: { id: params.id, shopId: shop.id } });
  if (!job) throw new Response("This batch does not exist.", { status: 404 });
  const intent = String((await request.formData()).get("intent") ?? "");

  if (intent === "cancel") {
    const cancelled = await getQueue().cancel(job.id);
    return { ok: cancelled, message: cancelled ? "Cancelling…" : "This batch has already finished." };
  }
  if (intent === "fallback") {
    const printUrl = await createPrintLink(shop.id, job.id);
    return { ok: true, message: "Opening the print view in a new tab.", printUrl };
  }
  return { ok: false, message: "Unknown action." };
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export default function JobPage() {
  const { job, documents } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<ActionResult>();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const active = job.state === "QUEUED" || job.state === "RUNNING";
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 1500);
    return () => clearInterval(timer);
  }, [active, revalidator]);

  // The fallback action hands back a signed link; open it in a new tab.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.printUrl) {
      window.open(fetcher.data.printUrl, "_blank", "noopener");
      fetcher.data.printUrl = undefined;
    }
  }, [fetcher.state, fetcher.data]);

  const state = STATE[job.state];
  const download = async (url: string, name: string) => {
    setDownloadError(await downloadFile(url, name));
  };
  const seconds =
    job.startedAt && job.finishedAt ? Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 100) / 10 : null;

  return (
    <s-page heading={job.label}>
      <s-button slot="breadcrumb-actions" href="/app/orders" variant="tertiary">Orders</s-button>
      {active ? (
        <s-button slot="secondary-actions" tone="critical" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "cancel" }, { method: "post" })}>
          Cancel batch
        </s-button>
      ) : null}
      {job.hasOutput ? (
        <s-button slot="primary-action" variant="primary" onClick={() => void download(`/app/jobs/${job.id}/output`, `${job.label}.pdf`)}>
          Download combined PDF
        </s-button>
      ) : null}

      {downloadError ? (
        <s-banner tone="critical"><s-paragraph>{downloadError}</s-paragraph></s-banner>
      ) : null}

      {job.offerFallback ? (
        <s-banner tone="warning" heading={active ? "Rendering is taking longer than expected" : "This batch did not finish"}>
          <s-paragraph>
            Your orders can still ship. Print from the browser now: same documents, same codes, same templates. The
            layout may differ slightly from the PDF, and no order is metered twice.
          </s-paragraph>
          <s-button slot="secondary-actions" variant="primary" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "fallback" }, { method: "post" })}>
            Print from browser
          </s-button>
        </s-banner>
      ) : null}

      <s-section heading="Progress">
        <s-stack gap="small">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone={state.tone}>{state.label}</s-badge>
            <s-text>
              {job.documentTypes.map((t) => DOC_LABEL[t]).join(" + ")} for {job.total} {job.total === 1 ? "order" : "orders"}
              {seconds !== null ? ` · ${seconds}s` : ""}
              {job.outputBytes ? ` · ${formatBytes(job.outputBytes)}` : ""}
            </s-text>
          </s-stack>
          <s-progress value={job.progress} max={Math.max(1, job.total)} tone={state.tone === "critical" ? "critical" : "auto"}></s-progress>
          <s-paragraph color="subdued">
            {active ? `${job.progress} of ${job.total} orders fetched` : `${job.progress} of ${job.total} orders processed`}
          </s-paragraph>
          {job.error ? (
            <s-banner tone={job.state === "FAILED" ? "critical" : "warning"}><s-paragraph>{job.error}</s-paragraph></s-banner>
          ) : null}
        </s-stack>
      </s-section>

      {job.hasOutput || job.hasPickList ? (
        <s-section heading="Batch files">
          <s-stack direction="inline" gap="small">
            {job.hasOutput ? (
              <s-button variant="secondary" onClick={() => void download(`/app/jobs/${job.id}/output`, `${job.label}.pdf`)}>
                Combined PDF
              </s-button>
            ) : null}
            {job.hasPickList ? (
              <s-button variant="secondary" onClick={() => void download(`/app/jobs/${job.id}/output?part=picklist`, `${job.label} pick list.pdf`)}>
                Pick list only
              </s-button>
            ) : null}
          </s-stack>
          <s-paragraph color="subdued">
            One file, each order on a fresh sheet, in the order you selected them. Every sheet carries a QR code and a barcode.
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Per-order documents">
        {documents.length === 0 ? (
          <s-paragraph>{active ? "Documents appear here when the batch finishes." : "No documents were produced."}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Document</s-table-header>
              <s-table-header>Invoice no.</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {documents.map((doc) => (
                <s-table-row key={doc.id}>
                  <s-table-cell>
                    <s-text type="strong" fontVariantNumeric="tabular-nums">{doc.orderName}</s-text>
                    {doc.customerName ? <s-text color="subdued"> · {doc.customerName}</s-text> : null}
                  </s-table-cell>
                  <s-table-cell>{DOC_LABEL[doc.type]}</s-table-cell>
                  <s-table-cell><s-text fontVariantNumeric="tabular-nums">{doc.invoiceNumber ?? "—"}</s-text></s-table-cell>
                  <s-table-cell>
                    <s-button variant="tertiary" onClick={() => void download(`/app/documents/${doc.id}`, `${DOC_LABEL[doc.type]} ${doc.orderName}.pdf`)}>
                      Download PDF
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

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
