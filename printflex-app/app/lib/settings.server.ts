/**
 * Per-shop settings stored as JSON on Shop.settingsJson. Everything has a
 * default so a shop with "{}" behaves correctly.
 */

export interface TagNames {
  printed: string;
  packed: string;
  needsReview: string;
}

export interface PackSettings {
  /** Every line must be checked before Mark as packed is enabled. */
  requireAllChecked: boolean;
  showPhotos: boolean;
  /** Scan each product barcode instead of tapping. */
  strictMode: boolean;
  askWeight: boolean;
  allowShortPick: boolean;
}

export interface DefaultsSettings {
  paperSize: "A4" | "LETTER";
  /** The document set the morning batch and "Default set" print. */
  documentSet: Array<"INVOICE" | "PACKING_SLIP" | "PICK_LIST">;
}

export interface ShopSettings {
  tagNames: TagNames;
  /** How long a printed QR code keeps opening its order, in days. */
  scanTokenDays: number;
  pack: PackSettings;
  /** Master switch for automatic invoice emails; off after uninstall. */
  emailsEnabled: boolean;
  defaults: DefaultsSettings;
  /** Onboarding step 1, when the merchant confirmed store details. */
  onboardingConfirmedAt: string | null;
  /** Show the setup guide on Home even after the first document was generated. */
  showSetupGuide: boolean;
}

export const DEFAULT_DEFAULTS: DefaultsSettings = { paperSize: "A4", documentSet: ["INVOICE", "PACKING_SLIP", "PICK_LIST"] };

export const DEFAULT_PACK_SETTINGS: PackSettings = {
  requireAllChecked: true,
  showPhotos: true,
  strictMode: false,
  askWeight: false,
  allowShortPick: true,
};

export const DEFAULT_SCAN_TOKEN_DAYS = 90;

export const DEFAULT_TAG_NAMES: TagNames = {
  printed: "printflex-printed",
  packed: "printflex-packed",
  needsReview: "printflex-needs-review",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function parseSettings(json: string | null | undefined): ShopSettings {
  let raw: unknown = {};
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    raw = {};
  }
  const root = isRecord(raw) ? raw : {};
  const tags = isRecord(root.tagNames) ? root.tagNames : {};

  const days = Number(root.scanTokenDays);
  const pack = isRecord(root.pack) ? root.pack : {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const defaults = isRecord(root.defaults) ? root.defaults : {};
  const set = Array.isArray(defaults.documentSet)
    ? defaults.documentSet.filter((d): d is "INVOICE" | "PACKING_SLIP" | "PICK_LIST" => d === "INVOICE" || d === "PACKING_SLIP" || d === "PICK_LIST")
    : [];
  return {
    emailsEnabled: bool(root.emailsEnabled, true),
    defaults: {
      paperSize: defaults.paperSize === "LETTER" ? "LETTER" : "A4",
      documentSet: set.length ? [...new Set(set)] : DEFAULT_DEFAULTS.documentSet,
    },
    onboardingConfirmedAt: typeof root.onboardingConfirmedAt === "string" ? root.onboardingConfirmedAt : null,
    showSetupGuide: root.showSetupGuide === true,
    pack: {
      requireAllChecked: bool(pack.requireAllChecked, DEFAULT_PACK_SETTINGS.requireAllChecked),
      showPhotos: bool(pack.showPhotos, DEFAULT_PACK_SETTINGS.showPhotos),
      strictMode: bool(pack.strictMode, DEFAULT_PACK_SETTINGS.strictMode),
      askWeight: bool(pack.askWeight, DEFAULT_PACK_SETTINGS.askWeight),
      allowShortPick: bool(pack.allowShortPick, DEFAULT_PACK_SETTINGS.allowShortPick),
    },
    tagNames: {
      printed: readString(tags, "printed", DEFAULT_TAG_NAMES.printed),
      packed: readString(tags, "packed", DEFAULT_TAG_NAMES.packed),
      needsReview: readString(tags, "needsReview", DEFAULT_TAG_NAMES.needsReview),
    },
    scanTokenDays: Number.isInteger(days) && days >= 1 && days <= 3650 ? days : DEFAULT_SCAN_TOKEN_DAYS,
  };
}

export function serializeSettings(settings: ShopSettings): string {
  return JSON.stringify(settings);
}

/** Read, change and write back one shop's settings. */
export async function updateShopSettings(
  prismaClient: { shop: { findUniqueOrThrow: (args: { where: { id: string }; select: { settingsJson: true } }) => Promise<{ settingsJson: string }>; update: (args: { where: { id: string }; data: { settingsJson: string } }) => Promise<unknown> } },
  shopId: string,
  change: (current: ShopSettings) => ShopSettings,
): Promise<ShopSettings> {
  const shop = await prismaClient.shop.findUniqueOrThrow({ where: { id: shopId }, select: { settingsJson: true } });
  const next = change(parseSettings(shop.settingsJson));
  await prismaClient.shop.update({ where: { id: shopId }, data: { settingsJson: serializeSettings(next) } });
  return next;
}
