import prisma from "../../db.server";
import type { GraphqlClient } from "../graphql.server";
import { hasEntitlement } from "../plans.server";
import { orderContext, templatePicker } from "../render/order-fragments.server";
import type { PdfRenderer } from "../render/pdf.server";
import { renderDocumentForOrder } from "../render/render-order.server";
import { readDocument } from "../render/storage.server";
import { parseSettings } from "../settings.server";
import type { EmailTrigger } from "../templates/templates.server";
import { transportFor, type EmailTransport } from "./transport.server";

/**
 * Automatic invoice email. Per INVOICE template: enabled + a trigger. The
 * webhook that syncs an order calls evaluate(); a manual resend calls
 * send() directly. One SENT per order and trigger, ever.
 */

export type SendStatus = "QUEUED" | "SENT" | "FAILED" | "SKIPPED";

export interface EmailDeps {
  client: GraphqlClient;
  pdf: PdfRenderer;
  transport?: EmailTransport;
  now?: Date;
}

/** Which trigger a webhook topic and order state correspond to. */
export function triggerFor(topic: string, financialStatus: string | null): EmailTrigger | null {
  const t = topic.toUpperCase().replaceAll("/", "_");
  if (t === "ORDERS_CREATE") return "creation";
  if (t === "ORDERS_FULFILLED") return "fulfillment";
  if (t === "ORDERS_UPDATED" && financialStatus === "PAID") return "payment";
  return null;
}

/** Called after an order sync. Sends if a matching template wants it. */
export async function evaluateInvoiceEmail(shopId: string, orderId: string, topic: string, deps: EmailDeps): Promise<SendStatus | null> {
  const [shop, order] = await Promise.all([
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { plan: true, settingsJson: true, uninstalledAt: true } }),
    prisma.orderIndex.findFirst({ where: { id: orderId, shopId }, select: { id: true, financialStatus: true, countryCode: true, tagsJson: true, customerEmail: true } }),
  ]);
  if (!order || shop.uninstalledAt) return null;
  if (!parseSettings(shop.settingsJson).emailsEnabled) return null;
  if (!hasEntitlement(shop.plan, "automaticInvoiceEmail")) return null;

  const trigger = triggerFor(topic, order.financialStatus);
  if (!trigger) return null;
  // Payment fires on every orders/updated while paid; the once-per-trigger rule below keeps it to one email.
  const resolved = await templatePicker(shopId)("INVOICE", orderContext(order));
  if (!resolved.settings.email.enabled || resolved.settings.email.trigger !== trigger) return null;

  return sendInvoiceEmail({ shopId, orderId, trigger, templateId: resolved.template.id, manual: false }, deps);
}

export interface SendInput {
  shopId: string;
  orderId: string;
  trigger: EmailTrigger | "manual";
  templateId?: string;
  manual: boolean;
}

export async function sendInvoiceEmail(input: SendInput, deps: EmailDeps): Promise<SendStatus> {
  const now = deps.now ?? new Date();
  const order = await prisma.orderIndex.findFirstOrThrow({ where: { id: input.orderId, shopId: input.shopId } });
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: input.shopId }, select: { domain: true } });

  if (!input.manual) {
    const already = await prisma.sendLog.findFirst({ where: { orderId: order.id, trigger: input.trigger, status: "SENT" } });
    if (already) return "SKIPPED";
  }
  const to = order.customerEmail;
  if (!to) {
    await prisma.sendLog.create({ data: { shopId: input.shopId, orderId: order.id, templateId: input.templateId, trigger: input.trigger, toEmail: "", status: "SKIPPED", error: "The order has no customer email." } });
    return "SKIPPED";
  }

  const log = await prisma.sendLog.create({
    data: { shopId: input.shopId, orderId: order.id, templateId: input.templateId, trigger: input.trigger, toEmail: to, status: "QUEUED" },
  });
  try {
    const { document } = await renderDocumentForOrder(input.shopId, order.id, "INVOICE", { client: deps.client, pdf: deps.pdf, now: () => now });
    const pdf = document.filePath ? await readDocument(document.filePath) : null;
    if (!pdf) throw new Error("The invoice PDF could not be read after rendering.");
    const transport = deps.transport ?? transportFor(input.shopId);
    const storeName = shop.domain.replace(".myshopify.com", "");
    const { messageId } = await transport.send({
      to,
      from: `${storeName} <no-reply@${shop.domain}>`,
      subject: `Invoice ${document.invoiceNumber ?? ""} for order ${order.orderName}`.replace(/\s+/g, " "),
      text: `Thank you for your order ${order.orderName}. Your invoice${document.invoiceNumber ? ` ${document.invoiceNumber}` : ""} is attached as a PDF.`,
      attachment: { filename: `invoice-${order.orderName.replace(/[^A-Za-z0-9-]+/g, "")}.pdf`, content: pdf, contentType: "application/pdf" },
    });
    await prisma.sendLog.update({ where: { id: log.id }, data: { status: "SENT", provider: transport.name, messageId, documentId: document.id, sentAt: now } });
    return "SENT";
  } catch (error) {
    await prisma.sendLog.update({ where: { id: log.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } });
    return "FAILED";
  }
}

export async function listSendLog(shopId: string, limit = 25) {
  const rows = await prisma.sendLog.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: limit, include: { order: { select: { orderName: true } } } });
  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    orderName: r.order.orderName,
    to: r.toEmail,
    trigger: r.trigger,
    status: r.status as SendStatus,
    error: r.error,
    provider: r.provider,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
  }));
}
