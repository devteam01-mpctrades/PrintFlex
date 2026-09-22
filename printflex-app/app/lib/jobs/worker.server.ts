import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { puppeteerRenderer } from "../render/pdf.server";
import { renderDocumentForOrder, type RenderDeps } from "../render/render-order.server";
import type { DocumentType } from "../types";
import { InProcessQueue, transition, type JobQueue } from "./queue.server";

/**
 * Runs one DocumentJob: renders every requested document for every order,
 * updating progress as it goes. Per-order failures are recorded and the job
 * continues; the job fails only if nothing at all could be produced.
 */

/** Seconds per order before a job is considered late (the Phase 6 fallback trigger). */
const SECONDS_PER_ORDER = 6;

export interface JobReport {
  succeeded: number;
  failed: Array<{ orderName: string; reason: string }>;
  cached: number;
}

function parseJson<T>(json: string, guard: (v: unknown) => v is T): T {
  const parsed: unknown = JSON.parse(json);
  if (!guard(parsed)) throw new Error("Malformed job payload");
  return parsed;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export async function runJob(
  jobId: string,
  signal: AbortSignal,
  depsFor: (shopDomain: string) => Promise<RenderDeps> = defaultDeps,
): Promise<JobReport> {
  const job = await prisma.documentJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { shop: { select: { id: true, domain: true } } },
  });
  if (job.state !== "QUEUED") {
    return { succeeded: 0, failed: [], cached: 0 };
  }

  const orderIds = parseJson(job.orderIdsJson, isStringArray);
  const documentTypes = parseJson(job.documentTypesJson, isStringArray) as DocumentType[];
  const deadlineAt = new Date(Date.now() + Math.max(30, orderIds.length * SECONDS_PER_ORDER) * 1000);
  await transition(jobId, "RUNNING", { progress: 0, total: orderIds.length, deadlineAt, error: null });

  const deps = await depsFor(job.shop.domain);
  const report: JobReport = { succeeded: 0, failed: [], cached: 0 };

  for (const [index, orderId] of orderIds.entries()) {
    if (signal.aborted) {
      await transition(jobId, "CANCELLED", { error: "Cancelled by the merchant." });
      return report;
    }
    const orderName =
      (await prisma.orderIndex.findUnique({ where: { id: orderId }, select: { orderName: true } }))?.orderName ??
      orderId;
    try {
      for (const documentType of documentTypes) {
        const outcome = await renderDocumentForOrder(job.shopId, orderId, documentType, deps, jobId);
        if (outcome.cached) report.cached += 1;
      }
      report.succeeded += 1;
    } catch (error) {
      report.failed.push({ orderName, reason: error instanceof Error ? error.message : String(error) });
    }
    await prisma.documentJob.update({ where: { id: jobId }, data: { progress: index + 1 } });
  }

  const summary = report.failed.length
    ? `${report.failed.length} of ${orderIds.length} orders could not be rendered. ` +
      report.failed.slice(0, 5).map((f) => `${f.orderName}: ${f.reason}`).join(" ")
    : null;
  await transition(jobId, report.succeeded > 0 ? "SUCCEEDED" : "FAILED", { error: summary });
  return report;
}

async function defaultDeps(shopDomain: string): Promise<RenderDeps> {
  const { admin } = await unauthenticated.admin(shopDomain);
  return { client: admin, pdf: puppeteerRenderer };
}

declare global {
  // eslint-disable-next-line no-var
  var printflexQueue: JobQueue | undefined;
}

/** The process-wide queue. Survives Vite module reloads in development. */
export function getQueue(): JobQueue {
  if (!globalThis.printflexQueue) {
    globalThis.printflexQueue = new InProcessQueue((jobId, signal) => runJob(jobId, signal).then(() => undefined));
  }
  return globalThis.printflexQueue;
}
