import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { puppeteerRenderer } from "../render/pdf.server";
import { renderBatch, type BatchDeps } from "../render/render-batch.server";
import { InProcessQueue, transition, type JobQueue } from "./queue.server";

/**
 * Runs one DocumentJob as a batch render. Missing orders are reported in the
 * job's error text; the job fails only when nothing could be produced.
 */

/** Seconds allowed per order before a job counts as late and the fallback is offered. */
const SECONDS_PER_ORDER = 2;
const MIN_DEADLINE_SECONDS = 45;

export type DepsFactory = (shopDomain: string, onProgress: BatchDeps["onProgress"]) => Promise<BatchDeps>;

export async function runJob(jobId: string, signal: AbortSignal, depsFor: DepsFactory = defaultDeps): Promise<void> {
  const job = await prisma.documentJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { shop: { select: { domain: true } } },
  });
  if (job.state !== "QUEUED") return;

  const total = (JSON.parse(job.orderIdsJson) as string[]).length;
  const deadlineAt = new Date(Date.now() + Math.max(MIN_DEADLINE_SECONDS, total * SECONDS_PER_ORDER) * 1000);
  await transition(jobId, "RUNNING", { progress: 0, total, deadlineAt, error: null });

  const onProgress = (done: number) => {
    void prisma.documentJob.updateMany({ where: { id: jobId, state: "RUNNING" }, data: { progress: done } });
  };

  try {
    const deps = await depsFor(job.shop.domain, onProgress);
    if (signal.aborted) {
      await transition(jobId, "CANCELLED", { error: "Cancelled by the merchant." });
      return;
    }
    const report = await renderBatch(jobId, deps);
    const current = await prisma.documentJob.findUniqueOrThrow({ where: { id: jobId }, select: { state: true } });
    if (current.state === "PRINTED_IN_FALLBACK") {
      // The merchant printed from the browser while this was rendering; keep that state, the PDF is a bonus.
      return;
    }
    const missing = report.missing.length
      ? `${report.missing.length} ${report.missing.length === 1 ? "order" : "orders"} no longer exist in Shopify and were skipped: ${report.missing.slice(0, 5).join(", ")}.`
      : null;
    await transition(jobId, report.rendered > 0 ? "SUCCEEDED" : "FAILED", {
      progress: total,
      error: report.rendered > 0 ? missing : (missing ?? "Nothing could be rendered."),
    });
    console.log(`Job ${jobId}: ${report.rendered} orders, ${report.bytes} bytes, ${report.ms} ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Job ${jobId} failed`, error);
    await transition(jobId, "FAILED", { error: `${message} You can still print this batch from the browser.` });
  }
}

async function defaultDeps(shopDomain: string, onProgress: BatchDeps["onProgress"]): Promise<BatchDeps> {
  const { admin } = await unauthenticated.admin(shopDomain);
  return { client: admin, pdf: puppeteerRenderer, onProgress };
}

declare global {
  // eslint-disable-next-line no-var
  var printflexQueue: JobQueue | undefined;
}

/** The process-wide queue. Survives Vite module reloads in development. */
export function getQueue(): JobQueue {
  if (!globalThis.printflexQueue) {
    globalThis.printflexQueue = new InProcessQueue((jobId, signal) => runJob(jobId, signal));
  }
  return globalThis.printflexQueue;
}
