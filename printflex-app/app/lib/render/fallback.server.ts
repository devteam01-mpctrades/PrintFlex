import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { capacityMessage, checkCapacity } from "../meter.server";
import { getScanSecret } from "../scan/tokens.server";
import { wrapDocument } from "./batch-html.server";
import { buildBatch, finalizeBatch } from "./render-batch.server";

/**
 * Printing is never blocked. When the queue is down or a job is past its
 * deadline, the merchant gets a browser-rendered print view of the same
 * fragments the PDF would contain. It runs in the request, needs no worker
 * and no Chrome, and meters the orders exactly once like any other print.
 *
 * The link is signed with the shop's scan secret and lives 30 minutes, so
 * it can open in a new tab outside the embedded admin.
 */

const LINK_TTL_MS = 30 * 60_000;

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export async function createPrintLink(shopId: string, jobId: string, now: Date = new Date()): Promise<string> {
  const secret = await getScanSecret(shopId);
  const payload = b64url(JSON.stringify({ s: shopId, j: jobId, e: now.getTime() + LINK_TTL_MS }));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest().subarray(0, 16));
  const base = (process.env.SHOPIFY_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/print/${payload}.${sig}`;
}

export type PrintLinkResult = { ok: true; shopId: string; jobId: string } | { ok: false; reason: "invalid" | "expired" };

export async function verifyPrintLink(token: string, now: Date = new Date()): Promise<PrintLinkResult> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return { ok: false, reason: "invalid" };
  let parsed: { s?: unknown; j?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof parsed;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof parsed.s !== "string" || typeof parsed.j !== "string" || typeof parsed.e !== "number") {
    return { ok: false, reason: "invalid" };
  }
  const shop = await prisma.shop.findUnique({ where: { id: parsed.s }, select: { scanSecret: true } });
  if (!shop?.scanSecret) return { ok: false, reason: "invalid" };
  const expected = b64url(createHmac("sha256", shop.scanSecret).update(payload).digest().subarray(0, 16));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  if (parsed.e <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, shopId: parsed.s, jobId: parsed.j };
}

/**
 * Whether the batch page should offer the fallback: the job is late, failed,
 * or was cancelled while orders still need printing.
 */
export function shouldOfferFallback(job: { state: string; deadlineAt: Date | null }, now: Date = new Date()): boolean {
  if (job.state === "FAILED" || job.state === "CANCELLED") return true;
  if ((job.state === "QUEUED" || job.state === "RUNNING") && job.deadlineAt && job.deadlineAt.getTime() < now.getTime()) {
    return true;
  }
  return false;
}

export interface FallbackDeps {
  client: GraphqlClient;
  now?: () => Date;
}

/**
 * The print view for a job. Same fragments, same templates, same meter.
 * Marks the job PRINTED_IN_FALLBACK unless the PDF already succeeded.
 */
export async function renderFallbackForJob(jobId: string, deps: FallbackDeps): Promise<string> {
  const built = await buildBatch(jobId, {
    client: deps.client,
    now: deps.now,
    pdf: { render: async () => { throw new Error("The fallback never renders a PDF"); } },
  });
  if (built.rendered.length === 0) {
    throw new Error("None of the orders in this batch exist in Shopify any more, so there is nothing to print.");
  }
  const capacity = await checkCapacity(built.shop.id, built.rendered.map((r) => r.order.shopifyOrderId), built.now);
  if (!capacity.allowed) throw new Error(capacityMessage(capacity, built.shop.timezone));
  await finalizeBatch(built, deps.client);
  const job = await prisma.documentJob.findUniqueOrThrow({ where: { id: jobId }, select: { state: true } });
  if (job.state !== "SUCCEEDED") {
    await prisma.documentJob.update({
      where: { id: jobId },
      data: {
        state: "PRINTED_IN_FALLBACK",
        finishedAt: built.now,
        progress: built.rendered.length,
        error: "Printed from the browser because the render queue did not finish in time. Nothing was lost and no order was metered twice.",
      },
    });
  }
  return wrapDocument(built.fragments, { title: built.label, paperSize: built.paperSize, printOnLoad: true });
}
