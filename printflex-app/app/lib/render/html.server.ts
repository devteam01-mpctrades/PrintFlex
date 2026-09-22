/** Shared HTML helpers for document templates. */

export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escape and turn newlines into <br>, for free-text blocks such as footers. */
export function escapeMultiline(value: string | null | undefined): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

export function formatMoney(amount: string, currencyCode: string, locale = "en-US"): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currencyCode}`;
  }
}

export function formatDate(iso: string, timezone: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** Only allow a CSS hex colour through; anything else falls back. */
export function safeColor(value: string, fallback: string): string {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : fallback;
}

/** Only allow a plain font family name through. */
export function safeFont(value: string, fallback: string): string {
  return /^[a-z0-9 -]{1,40}$/i.test(value) ? value : fallback;
}
