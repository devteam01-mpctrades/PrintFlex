import prisma from "../db.server";
import { updateShopSettings } from "./settings.server";

/**
 * app/uninstalled. Shopify cancels the subscription itself when an app is
 * removed, so here we mirror Free, stop everything that could still run,
 * and start the retention clock. Data is deleted by the retention job
 * after RETENTION_AFTER_UNINSTALL_DAYS, or immediately by shop/redact.
 */

export const RETENTION_AFTER_UNINSTALL_DAYS = 30;

export async function handleUninstall(shopDomain: string, now: Date = new Date()): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain }, select: { id: true } });
  if (!shop) return;
  await prisma.shop.update({ where: { id: shop.id }, data: { plan: "FREE", uninstalledAt: now } });
  await prisma.documentJob.updateMany({
    where: { shopId: shop.id, state: { in: ["QUEUED", "RUNNING"] } },
    data: { state: "CANCELLED", finishedAt: now, error: "The app was uninstalled." },
  });
  await prisma.sendLog.updateMany({ where: { shopId: shop.id, status: "QUEUED" }, data: { status: "SKIPPED", error: "The app was uninstalled." } });
  await updateShopSettings(prisma, shop.id, (current) => ({ ...current, emailsEnabled: false }));
  await prisma.scanDevice.updateMany({ where: { shopId: shop.id, revokedAt: null }, data: { revokedAt: now } });
  await prisma.auditEntry.create({ data: { shopId: shop.id, actor: "shopify", action: "app.uninstalled", detailsJson: "{}" } });
}

/** Reinstall within the retention window: clear the clock, keep the data. */
export async function handleReinstall(shopId: string): Promise<void> {
  await prisma.shop.update({ where: { id: shopId }, data: { uninstalledAt: null } });
  await updateShopSettings(prisma, shopId, (current) => ({ ...current, emailsEnabled: true }));
}
