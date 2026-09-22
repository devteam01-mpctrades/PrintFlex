import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { evaluateInvoiceEmail } from "../lib/email/invoice-email.server";
import { syncOrderById } from "../lib/orders/sync.server";
import { puppeteerRenderer } from "../lib/render/pdf.server";
import { ensureShop } from "../lib/shops.server";
import prisma from "../db.server";

/**
 * orders/create, orders/updated, orders/fulfilled, orders/cancelled.
 *
 * authenticate.webhook verifies the HMAC. The payload is used only for the
 * order id: the order is re-fetched over Admin GraphQL so the row always
 * reflects Shopify's current state, and applyOrderSnapshot's updatedAt guard
 * drops anything older than what is already stored.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, topic, payload } = await authenticate.webhook(request);

  const orderGid = orderGidFromPayload(payload);
  if (!orderGid) {
    console.warn(`Ignoring ${topic} for ${shop}: payload carries no order id`);
    return new Response();
  }

  if (!admin) {
    // The app is uninstalled or has no offline session; nothing to sync into.
    console.warn(`Ignoring ${topic} for ${shop}: no admin session`);
    return new Response();
  }

  const shopRow = await ensureShop(shop);
  const outcome = await syncOrderById(admin, shopRow.id, orderGid);
  console.log(`${topic} for ${shop}: ${orderGid} ${outcome}`);

  if (outcome === "created" || outcome === "updated") {
    // Automatic invoice email, if a template asks for it on this trigger. Never blocks the webhook.
    const order = await prisma.orderIndex.findUnique({ where: { shopId_shopifyOrderId: { shopId: shopRow.id, shopifyOrderId: orderGid } }, select: { id: true } });
    if (order) {
      void evaluateInvoiceEmail(shopRow.id, order.id, topic, { client: admin, pdf: puppeteerRenderer })
        .then((status) => status && console.log(`Invoice email for ${orderGid}: ${status}`))
        .catch((error: unknown) => console.error(`Invoice email for ${orderGid} failed`, error));
    }
  }

  return new Response();
};

function orderGidFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.admin_graphql_api_id === "string") return record.admin_graphql_api_id;
  if (typeof record.id === "number" || typeof record.id === "string") {
    return `gid://shopify/Order/${record.id}`;
  }
  return null;
}
