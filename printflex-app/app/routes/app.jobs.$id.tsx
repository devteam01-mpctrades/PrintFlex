import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import jobsStyles from "../styles/jobs.css?url";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import { downloadFile } from "../components/download";
import prisma from "../db.server";
import { getQueue } from "../lib/jobs/worker.server";
import { latestPerOrderAndType, printTypeFromBatch, reprintDocument } from "../lib/jobs/reprint.server";
import { createPrintLink, shouldOfferFallback } from "../lib/render/fallback.server";
import { puppeteerRenderer } from "../lib/render/pdf.server";
import { templatesForType } from "../lib/templates/templates.server";
import { batchLabel } from "../lib/render/render-batch.server";
import { requireShop } from "../lib/request.server";
import type { DocumentType, JobState } from "../lib/types";
import { Btn } from "../components/ui";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: jobsStyles }];

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
      documents: {
        orderBy: { renderedAt: "asc" },
        include: { order: { select: { orderName: true, customerName: true } }, template: { select: { name: true } } },
      },
    },
  });
  if (!job) throw new Response("This batch does not exist.", { status: 404 });
  const now = new Date();
  const [invoiceTemplates, slipTemplates] = await Promise.all([templatesForType(shop.id, "INVOICE"), templatesForType(shop.id, "PACKING_SLIP")]);
  const pick = (t: { id: string; name: string }) => ({ id: t.id, name: t.name });
  return {
    job: {
      id: job.id,
      label: batchLabel(job),
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
      finishedLabel: job.finishedAt
        ? new Intl.DateTimeFormat("en-GB", { timeZone: shop.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(job.finishedAt)
        : null,
    },
    // A re-print adds a document to the batch; list only the newest per order and type.
    documents: latestPerOrderAndType(
      job.documents.map((d) => ({
        id: d.id,
        orderId: d.orderId,
        type: d.documentType as DocumentType,
        orderName: d.order.orderName,
        customerName: d.order.customerName,
        invoiceNumber: d.invoiceNumber,
        templateId: d.templateId,
        templateName: d.template.name,
        renderedAt: d.renderedAt.toISOString(),
      })),
    ),
    templates: { INVOICE: invoiceTemplates.map(pick), PACKING_SLIP: slipTemplates.map(pick) } as Partial<Record<DocumentType, Array<{ id: string; name: string }>>>,
  };
};

type ActionResult = { ok: boolean; message: string; printUrl?: string; jobId?: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { shop, admin } = await requireShop(request);
  const job = await prisma.documentJob.findFirst({ where: { id: params.id, shopId: shop.id } });
  if (!job) throw new Response("This batch does not exist.", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "cancel") {
    const cancelled = await getQueue().cancel(job.id);
    return { ok: cancelled, message: cancelled ? "Cancelling…" : "This batch has already finished." };
  }
  if (intent === "printType") {
    const type = String(form.get("documentType") ?? "") as DocumentType;
    const created = await printTypeFromBatch(shop.id, job.id, type);
    if (!created.ok) return { ok: false, message: created.message };
    try {
      await getQueue().enqueue(created.jobId);
    } catch (error) {
      // Printing is never blocked: hand the merchant the browser print view instead.
      console.error(`Queue unavailable for ${created.label}`, error);
      return {
        ok: true,
        jobId: created.jobId,
        printUrl: await createPrintLink(shop.id, created.jobId),
        message: `The render queue is unavailable, so ${created.label} will print from your browser instead.`,
      };
    }
    return { ok: true, jobId: created.jobId, message: `Rendering ${created.count} ${created.count === 1 ? "order" : "orders"} as ${created.label}.` };
  }
  if (intent === "reprint") {
    const result = await reprintDocument(shop.id, String(form.get("documentId") ?? ""), String(form.get("templateId") ?? ""), { client: admin, pdf: puppeteerRenderer });
    return result.ok
      ? { ok: true, message: `${result.orderName} re-printed with ${result.templateName}. Download it below; the combined PDF still has the earlier version.` }
      : { ok: false, message: result.message };
  }
  if (intent === "fallback") {
    const printUrl = await createPrintLink(shop.id, job.id);
    return { ok: true, message: "Opening the print view in a new tab.", printUrl };
  }
  return { ok: false, message: "Unknown action." };
};

/** Small decorative icons for the stat tiles and file groups. */
const ICON = {
  orders: <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9" />,
  time: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></>,
  download: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />,
  print: <><path d="M7 8V3h10v5" /><rect x="3" y="8" width="18" height="9" rx="2" /><path d="M7 14h10v7H7z" /></>,
};
function Icon({ name }: { name: keyof typeof ICON }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[name]}
    </svg>
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export default function JobPage() {
  const { job, documents, templates } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const fetcher = useFetcher<ActionResult>();
  // Mixed batches (invoice + packing slip) can be filtered and split by type.
  const singleTypes = job.documentTypes.filter((t): t is Exclude<DocumentType, "PICK_LIST"> => t !== "PICK_LIST");
  const mixed = singleTypes.length > 1;
  const [filter, setFilter] = useState<"ALL" | DocumentType>("ALL");
  const filtered = useMemo(() => (filter === "ALL" ? documents : documents.filter((d) => d.type === filter)), [documents, filter]);
  // A 90-order batch has 180 rows; rendering them all as Polaris table rows kept the page unclickable for ~30s.
  const PAGE = 25;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [filter]);
  const shown = filtered.slice(0, limit);
  const countOf = (t: DocumentType) => documents.filter((d) => d.type === t).length;
  // Re-print one document with another template.
  const [reprint, setReprint] = useState<(typeof documents)[number] | null>(null);
  const reprintModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const templateChoiceRef = useRef<HTMLElementTagNameMap["s-choice-list"]>(null);
  const openReprint = (doc: (typeof documents)[number]) => {
    setReprint(doc);
    reprintModalRef.current?.showOverlay();
  };
  const submitReprint = () => {
    const templateId = templateChoiceRef.current?.values?.[0];
    if (!reprint || !templateId) return;
    fetcher.submit({ intent: "reprint", documentId: reprint.id, templateId }, { method: "post" });
    reprintModalRef.current?.hideOverlay();
  };
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

  // "Print invoices only" makes a new batch: go and watch it render.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.jobId && !fetcher.data.printUrl) {
      const next = fetcher.data.jobId;
      fetcher.data.jobId = undefined;
      navigate(`/app/jobs/${next}`);
    }
  }, [fetcher.state, fetcher.data, navigate]);

  const state = STATE[job.state];
  const download = async (url: string, name: string) => {
    setDownloadError(await downloadFile(url, name));
  };
  const seconds =
    job.startedAt && job.finishedAt ? Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 100) / 10 : null;

  return (
    <s-page heading={job.label} inlineSize="large">
      {/* The admin title bar reads PrintFlex > Home > BATCH-0007; the button below is the visible way back. */}
      <s-link slot="breadcrumb-actions" href="/app">Home</s-link>
      <div className="pf-job-back">
        <Btn variant="tertiary" href="/app">← Back to Home</Btn>
      </div>
      {active ? (
        <Btn slot="secondary-actions" tone="critical" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "cancel" }, { method: "post" })}>
          Cancel batch
        </Btn>
      ) : null}
      {job.hasOutput ? (
        <Btn slot="primary-action" variant="primary" onClick={() => void download(`/app/jobs/${job.id}/output`, `${job.label}.pdf`)}>
          Download combined PDF
        </Btn>
      ) : null}

      {fetcher.data && fetcher.state === "idle" && fetcher.data.message ? (
        <s-banner tone={fetcher.data.ok ? "success" : "critical"}><s-paragraph>{fetcher.data.message}</s-paragraph></s-banner>
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
          <Btn slot="secondary-actions" variant="primary" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "fallback" }, { method: "post" })}>
            Print from browser
          </Btn>
        </s-banner>
      ) : null}

      {/* The files first, then progress, side by side; they stack on narrow screens (app/styles/jobs.css). */}
      <div className="pf-job-top">
        {job.hasOutput || job.hasPickList ? (
          <s-section heading="Batch files">
            <s-stack gap="base">
              <div className="pf-job-group download">
                <div className="pf-job-group__title"><b><Icon name="download" /></b>Download</div>
                <s-stack direction="inline" gap="small">
                  {job.hasOutput ? (
                    <Btn variant="primary" icon="download" onClick={() => void download(`/app/jobs/${job.id}/output`, `${job.label}.pdf`)}>
                      Combined PDF
                    </Btn>
                  ) : null}
                  {job.hasPickList ? (
                    <Btn variant="secondary" icon="download" onClick={() => void download(`/app/jobs/${job.id}/output?part=picklist`, `${job.label} pick list.pdf`)}>
                      Pick list only
                    </Btn>
                  ) : null}
                </s-stack>
                <p>Each order on a fresh sheet, with its QR code and barcode.</p>
              </div>
              {mixed && !active ? (
                <>
                  <div className="pf-job-group again">
                    <div className="pf-job-group__title"><b><Icon name="print" /></b>Print one type again</div>
                    <s-stack direction="inline" gap="small">
                      {singleTypes.map((t) => (
                        <Btn key={t} variant="secondary" icon="print" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "printType", documentType: t }, { method: "post" })}>
                          {DOC_LABEL[t]}s only
                        </Btn>
                      ))}
                    </s-stack>
                    <p>A separate PDF of just that type. Not metered again this month.</p>
                  </div>
                </>
              ) : null}
            </s-stack>
          </s-section>
        ) : null}

        <s-section heading="Progress">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={state.tone}>{state.label}</s-badge>
              <s-text>{job.documentTypes.map((t) => DOC_LABEL[t]).join(" + ")}</s-text>
            </s-stack>
            <div
              className={`pf-job-bar${job.state === "SUCCEEDED" ? " done" : job.state === "FAILED" ? " failed" : ""}`}
              role="progressbar"
              aria-label="Batch progress"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, job.total)}
              aria-valuenow={job.progress}
            >
              <i style={{ width: `${Math.min(100, (job.progress / Math.max(1, job.total)) * 100)}%` }} />
            </div>
            <div className="pf-job-stats">
              <div className="orders">
                <b><Icon name="orders" /></b>
                <span>Orders</span>
                <strong>{active ? `${job.progress} / ${job.total}` : job.total}</strong>
              </div>
              <div className="time">
                <b><Icon name="time" /></b>
                <span>Time</span>
                <strong>{seconds !== null ? `${seconds}s` : active ? "…" : "—"}</strong>
              </div>
              <div className="size">
                <b><Icon name="file" /></b>
                <span>File size</span>
                <strong>{job.outputBytes ? formatBytes(job.outputBytes) : "—"}</strong>
              </div>
            </div>
            <div className={`pf-job-summary${job.state === "SUCCEEDED" ? " ok" : ""}`}>
              {active
                ? `${job.progress} of ${job.total} orders fetched so far`
                : `${job.state === "SUCCEEDED" ? "✓ " : ""}${job.progress} of ${job.total} orders processed${job.finishedLabel ? ` · Finished ${job.finishedLabel}` : ""}`}
            </div>
            {job.error ? (
              <s-banner tone={job.state === "FAILED" ? "critical" : "warning"}><s-paragraph>{job.error}</s-paragraph></s-banner>
            ) : null}
          </s-stack>
        </s-section>
      </div>

      <s-section heading="Per-order documents">
        <s-stack gap="base">
          {mixed && documents.length > 0 ? (
            <s-stack direction="inline" gap="small">
              <Btn variant={filter === "ALL" ? "primary" : "secondary"} onClick={() => setFilter("ALL")}>All ({documents.length})</Btn>
              {singleTypes.map((t) => (
                <Btn key={t} variant={filter === t ? "primary" : "secondary"} onClick={() => setFilter(t)}>
                  {DOC_LABEL[t]}s ({countOf(t)})
                </Btn>
              ))}
            </s-stack>
          ) : null}
          {documents.length === 0 ? (
            <s-paragraph>{active ? "Documents appear here when the batch finishes." : "No documents were produced."}</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header>Document</s-table-header>
                <s-table-header>Template</s-table-header>
                <s-table-header>Invoice no.</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {shown.map((doc) => (
                  <s-table-row key={doc.id}>
                    <s-table-cell>
                      <s-stack gap="none">
                        <s-text type="strong" fontVariantNumeric="tabular-nums">{doc.orderName}</s-text>
                        <s-text color="subdued">{doc.customerName ?? "Guest"}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={doc.type === "INVOICE" ? "info" : "neutral"}>{DOC_LABEL[doc.type]}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-text color="subdued">{doc.templateName}</s-text>
                        {doc.type === "PICK_LIST" ? null : (
                          <Btn variant="tertiary" aria-label={`Change the template for ${DOC_LABEL[doc.type]} ${doc.orderName}`} onClick={() => openReprint(doc)}>
                            Change
                          </Btn>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell><s-text fontVariantNumeric="tabular-nums">{doc.invoiceNumber ?? "—"}</s-text></s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" justifyContent="end">
                        <Btn variant="tertiary" onClick={() => void download(`/app/documents/${doc.id}`, `${DOC_LABEL[doc.type]} ${doc.orderName}.pdf`)}>
                          Download PDF
                        </Btn>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          {filtered.length > shown.length ? (
            <s-stack direction="inline" gap="small" alignItems="center" justifyContent="center">
              <Btn variant="secondary" onClick={() => setLimit((n) => n + PAGE * 2)}>Show {Math.min(PAGE * 2, filtered.length - shown.length)} more</Btn>
              <s-text color="subdued">Showing {shown.length} of {filtered.length}</s-text>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-modal id="reprint-modal" heading={reprint ? `Re-print ${DOC_LABEL[reprint.type].toLowerCase()} · ${reprint.orderName}` : "Re-print"} ref={reprintModalRef}>
        <s-stack gap="base">
        {reprint ? (
          (templates[reprint.type] ?? []).length > 1 ? (
            <s-stack gap="small">
              <s-paragraph color="subdued">
                Pick the template to print this order with. The invoice number stays the same and the order is not metered again this month.
              </s-paragraph>
              <s-choice-list key={reprint.id} ref={templateChoiceRef} label="Template" labelAccessibilityVisibility="exclusive" values={[reprint.templateId]}>
                {(templates[reprint.type] ?? []).map((t) => (
                  <s-choice key={t.id} value={t.id}>
                    {t.name}
                    {t.id === reprint.templateId ? <s-text slot="details">Used for this batch</s-text> : null}
                  </s-choice>
                ))}
              </s-choice-list>
            </s-stack>
          ) : (
            <s-paragraph>
              You have one {DOC_LABEL[reprint.type].toLowerCase()} template, so there is nothing else to print it with yet. Create another in Templates (for
              example a gift invoice or a version per market), then come back to re-print this order with it.
            </s-paragraph>
          )
        ) : null}
        <s-stack direction="inline" gap="small" justifyContent="end">
          <Btn onClick={() => reprintModalRef.current?.hideOverlay()}>Cancel</Btn>
          {reprint && (templates[reprint.type] ?? []).length > 1 ? (
            <Btn variant="primary" icon="print" disabled={busy || undefined} onClick={submitReprint}>Re-print</Btn>
          ) : (
            <Btn variant="primary" href="/app/templates">Go to Templates</Btn>
          )}
        </s-stack>
        </s-stack>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
