import prisma from "../db.server";
import { parseSettings } from "./settings.server";

/**
 * The four-step first run. Steps 2 to 4 are read from what the shop has
 * actually done, so the checklist can never lie.
 */
export interface OnboardingState {
  confirmed: boolean;
  hasLogo: boolean;
  hasPrinted: boolean;
  hasScanned: boolean;
  complete: boolean;
  firstTemplateId: string | null;
}

export async function onboardingState(shopId: string): Promise<OnboardingState> {
  const [shop, templates, documents, scans] = await Promise.all([
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { settingsJson: true } }),
    prisma.template.findMany({ where: { shopId, active: true }, select: { id: true, settingsJson: true, documentType: true }, orderBy: { createdAt: "asc" } }),
    prisma.document.count({ where: { shopId } }),
    prisma.packEvent.count({ where: { shopId } }),
  ]);
  const confirmed = parseSettings(shop.settingsJson).onboardingConfirmedAt !== null;
  const hasLogo = templates.some((t) => {
    try {
      const parsed: unknown = JSON.parse(t.settingsJson);
      return typeof parsed === "object" && parsed !== null && typeof (parsed as { logoUrl?: unknown }).logoUrl === "string";
    } catch {
      return false;
    }
  });
  const hasPrinted = documents > 0;
  const hasScanned = scans > 0;
  const invoice = templates.find((t) => t.documentType === "INVOICE") ?? templates[0];
  return { confirmed, hasLogo, hasPrinted, hasScanned, complete: confirmed && hasLogo && hasPrinted && hasScanned, firstTemplateId: invoice?.id ?? null };
}
