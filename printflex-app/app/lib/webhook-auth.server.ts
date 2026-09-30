import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifiedWebhook = { shop: string; topic: string; payload: unknown };

/**
 * Verify a Shopify webhook's HMAC without touching the shop's session.
 *
 * `authenticate.webhook` loads the offline session and, with expiring offline tokens, refreshes it
 * first. For a shop that has uninstalled or closed, that refresh is refused and the library answers a
 * bare 500, so app/uninstalled and the compliance topics failed and were retried for two days. Those
 * handlers never call the Admin API, so they verify the signature here instead. Status codes match
 * the library: 405 not POST, 400 missing headers, 401 bad signature. Topic is in the library's
 * form (`customers/redact` becomes `CUSTOMERS_REDACT`).
 */
export async function verifyWebhook(request: Request, secret: string = process.env.SHOPIFY_API_SECRET ?? ""): Promise<VerifiedWebhook> {
  if (request.method !== "POST") throw new Response(undefined, { status: 405, statusText: "Method not allowed" });

  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic");
  const shop = request.headers.get("x-shopify-shop-domain");
  const rawBody = await request.text();
  if (!hmac || !topic || !shop || !rawBody) throw new Response(undefined, { status: 400, statusText: "Bad Request" });

  if (!secret || !signatureMatches(rawBody, hmac, secret)) throw new Response(undefined, { status: 401, statusText: "Unauthorized" });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Response(undefined, { status: 400, statusText: "Bad Request" });
  }
  return { shop, topic: topic.toUpperCase().replace(/[/.]/g, "_"), payload };
}

function signatureMatches(rawBody: string, hmac: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(hmac, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
