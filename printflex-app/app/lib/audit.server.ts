import prisma from "../db.server";

/**
 * The audit log: who changed what. Actor is "merchant", "shopify" or a
 * scan device name. Details are small JSON, never a whole record.
 */
export async function audit(
  shopId: string,
  actor: string,
  action: string,
  subject: string | null = null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await prisma.auditEntry.create({ data: { shopId, actor, action, subject, detailsJson: JSON.stringify(details) } });
}

export const AUDIT_LABELS: Record<string, string> = {
  "template.created": "Template created",
  "template.saved": "Template saved",
  "template.restored": "Template version restored",
  "template.deleted": "Template deleted",
  "pin.set": "Store PIN set",
  "pin.rotated": "Store PIN rotated",
  "device.revoked": "Device revoked",
  "scan.tokens_revoked": "Scan codes revoked",
  "scan.secret_rotated": "All scan codes invalidated",
  "plan.changed": "Plan changed",
  "limit.changed": "Limit behaviour changed",
  "settings.changed": "Settings changed",
  "warehouse.bins_imported": "Bin locations imported",
  "warehouse.bins_cleared": "Bin locations cleared",
  "warehouse.bundles_imported": "Bundle map imported",
  "warehouse.bundles_cleared": "Bundle map cleared",
  "invoice.numbering": "Invoice numbering changed",
  "app.uninstalled": "App uninstalled",
  "gdpr.data_request": "Customer data request",
  "gdpr.customer_redact": "Customer data redacted",
};

export async function listAudit(shopId: string, limit = 50) {
  const rows = await prisma.auditEntry.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    actor: r.actor,
    action: r.action,
    label: AUDIT_LABELS[r.action] ?? r.action,
    subject: r.subject,
    details: r.detailsJson,
  }));
}
