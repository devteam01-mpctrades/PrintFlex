/** True when a request carries nothing from Shopify: no shop, no id_token, no session-token header. */
export function isOutsideAdmin(request: Request): boolean {
  const url = new URL(request.url);
  return !url.searchParams.has("shop") && !url.searchParams.has("id_token") && !request.headers.get("authorization");
}

/**
 * True when the `host` parameter is base64 that decodes to something that is not a hostname. The
 * Shopify library decodes it with `new URL()` and throws, which surfaced as a 500 when App Store
 * review sent a garbled `host`. The admin always sends a valid one, so this is only ever a bad link.
 */
export function hasMalformedHost(request: Request): boolean {
  const host = new URL(request.url).searchParams.get("host");
  if (!host || !/^[0-9a-zA-Z+/]+={0,2}$/.test(host)) return false; // absent or not base64: the library rejects it cleanly
  try {
    new URL(`https://${atob(host)}`);
    return false;
  } catch {
    return true;
  }
}
