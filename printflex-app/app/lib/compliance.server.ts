import fs from "node:fs/promises";
import path from "node:path";
import prisma from "../db.server";
import { removeDocument, storageRoot } from "./render/storage.server";

/**
 * GDPR webhooks as real work: files on disk go, then rows. Every handler
 * is safe to run twice, because Shopify retries webhooks.
 */

export interface DataRequestPayload {
  shop_domain: string;
  customer?: { id?: number; email?: string };
  orders_requested?: number[];
  data_request?: { id?: number };
}

export interface RedactPayload {
  shop_domain: string;
  customer?: { id?: number; email?: string };
  orders_to_redact?: number[];
}

function orderGids(ids: number[] | undefined): string[] {
  return (ids ?? []).map((id) => `gid://shopify/Order/${id}`);
}

/**
 * customers/data_request: write everything PrintFlex holds about the
 * customer's orders to a JSON file the merchant can download from the
 * admin and forward. Nothing is emailed from here.
 */
export async function handleDataRequest(payload: DataRequestPayload): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { domain: payload.shop_domain }, select: { id: true } });
  if (!shop) return null;
  const gids = orderGids(payload.orders_requested);
  const orders = await prisma.orderIndex.findMany({
    where: {
      shopId: shop.id,
      OR: [
        ...(gids.length ? [{ shopifyOrderId: { in: gids } }] : []),
        ...(payload.customer?.email ? [{ customerEmail: payload.customer.email }] : []),
      ],
    },
    include: { lineItems: true, documents: { select: { documentType: true, invoiceNumber: true, renderedAt: true } }, packEvents: true, sendLogs: true },
  });
  const requestId = String(payload.data_request?.id ?? Date.now());
  const file = path.join(storageRoot(), "compliance", shop.id, `data-request-${requestId}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ requestedAt: new Date().toISOString(), customer: payload.customer ?? null, orders }, null, 2),
  );
  await prisma.auditEntry.create({
    data: { shopId: shop.id, actor: "shopify", action: "gdpr.data_request", subject: requestId, detailsJson: JSON.stringify({ file, orders: orders.length }) },
  });
  return file;
}

/** customers/redact: PDFs off disk, then the orders and everything hanging off them. */
export async function handleCustomerRedact(payload: RedactPayload): Promise<{ orders: number; files: number }> {
  const shop = await prisma.shop.findUnique({ where: { domain: payload.shop_domain }, select: { id: true } });
  if (!shop) return { orders: 0, files: 0 };
  const gids = orderGids(payload.orders_to_redact);
  const orders = await prisma.orderIndex.findMany({
    where: {
      shopId: shop.id,
      OR: [
        ...(gids.length ? [{ shopifyOrderId: { in: gids } }] : []),
        ...(payload.customer?.email ? [{ customerEmail: payload.customer.email }] : []),
      ],
    },
    select: { id: true, documents: { select: { filePath: true } } },
  });
  let files = 0;
  for (const order of orders) {
    for (const doc of order.documents) {
      if (doc.filePath) {
        await removeDocument(doc.filePath);
        files += 1;
      }
    }
  }
  // Cascades remove line items, documents, scan tokens, pack events and send logs.
  await prisma.orderIndex.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  await prisma.auditEntry.create({
    data: { shopId: shop.id, actor: "shopify", action: "gdpr.customer_redact", detailsJson: JSON.stringify({ orders: orders.length, files }) },
  });
  return { orders: orders.length, files };
}

/** shop/redact: the shop's whole storage directory, then the Shop row (everything cascades). */
export async function handleShopRedact(shopDomain: string): Promise<boolean> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain }, select: { id: true } });
  if (!shop) return false;
  for (const dir of ["documents", "jobs", "compliance", "outbox"]) {
    await fs.rm(path.join(storageRoot(), dir, shop.id), { recursive: true, force: true });
  }
  await prisma.shop.delete({ where: { id: shop.id } });
  return true;
}
