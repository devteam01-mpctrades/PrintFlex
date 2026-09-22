/**
 * Per-shop settings stored as JSON on Shop.settingsJson. Everything has a
 * default so a shop with "{}" behaves correctly.
 */

export interface TagNames {
  printed: string;
  packed: string;
  needsReview: string;
}

export interface ShopSettings {
  tagNames: TagNames;
}

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

  return {
    tagNames: {
      printed: readString(tags, "printed", DEFAULT_TAG_NAMES.printed),
      packed: readString(tags, "packed", DEFAULT_TAG_NAMES.packed),
      needsReview: readString(tags, "needsReview", DEFAULT_TAG_NAMES.needsReview),
    },
  };
}

export function serializeSettings(settings: ShopSettings): string {
  return JSON.stringify(settings);
}
