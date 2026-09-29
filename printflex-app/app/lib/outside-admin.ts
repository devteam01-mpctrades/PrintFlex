/** True when a request carries nothing from Shopify: no shop, no id_token, no session-token header. */
export function isOutsideAdmin(request: Request): boolean {
  const url = new URL(request.url);
  return !url.searchParams.has("shop") && !url.searchParams.has("id_token") && !request.headers.get("authorization");
}
