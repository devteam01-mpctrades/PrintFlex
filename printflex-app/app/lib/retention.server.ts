import prisma from "../db.server";
import { handleShopRedact } from "./compliance.server";
import { RETENTION_AFTER_UNINSTALL_DAYS } from "./lifecycle.server";
import { HISTORY_DAYS } from "./pack/history.server";
import { removeDocument } from "./render/storage.server";

/**
 * Retention. PDFs live 30 days on disk and are regenerated on demand from
 * the Document row (ensureDocumentFile). Scan history lives 90 days.
 * Uninstalled shops are redacted after 30 days.
 */

export const PDF_RETENTION_DAYS = 30;

export interface RetentionReport {
  pdfFiles: number;
  jobFiles: number;
  packEvents: number;
  shopsRedacted: number;
}

export async function runRetention(now: Date = new Date()): Promise<RetentionReport> {
  const pdfCutoff = new Date(now.getTime() - PDF_RETENTION_DAYS * 86_400_000);
  const historyCutoff = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const uninstallCutoff = new Date(now.getTime() - RETENTION_AFTER_UNINSTALL_DAYS * 86_400_000);
  const report: RetentionReport = { pdfFiles: 0, jobFiles: 0, packEvents: 0, shopsRedacted: 0 };

  const documents = await prisma.document.findMany({ where: { filePath: { not: null }, renderedAt: { lt: pdfCutoff } }, select: { id: true, filePath: true } });
  for (const doc of documents) {
    await removeDocument(doc.filePath as string);
    await prisma.document.update({ where: { id: doc.id }, data: { filePath: null } });
    report.pdfFiles += 1;
  }

  const jobs = await prisma.documentJob.findMany({
    where: { OR: [{ outputPath: { not: null } }, { pickListPath: { not: null } }], createdAt: { lt: pdfCutoff } },
    select: { id: true, outputPath: true, pickListPath: true },
  });
  for (const job of jobs) {
    if (job.outputPath) await removeDocument(job.outputPath);
    if (job.pickListPath) await removeDocument(job.pickListPath);
    await prisma.documentJob.update({ where: { id: job.id }, data: { outputPath: null, pickListPath: null } });
    report.jobFiles += 1;
  }

  report.packEvents = (await prisma.packEvent.deleteMany({ where: { occurredAt: { lt: historyCutoff } } })).count;

  const gone = await prisma.shop.findMany({ where: { uninstalledAt: { lt: uninstallCutoff } }, select: { domain: true } });
  for (const shop of gone) {
    if (await handleShopRedact(shop.domain)) report.shopsRedacted += 1;
  }
  return report;
}

declare global {
  // eslint-disable-next-line no-var
  var printflexRetentionTimer: ReturnType<typeof setInterval> | undefined;
}

/** Run retention hourly in this process. Idempotent across module reloads. */
export function startRetentionScheduler(): void {
  if (globalThis.printflexRetentionTimer) return;
  globalThis.printflexRetentionTimer = setInterval(() => {
    runRetention().then((r) => console.log("Retention:", r)).catch((e: unknown) => console.error("Retention failed", e));
  }, 60 * 60_000);
}
