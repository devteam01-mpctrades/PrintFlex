import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "./webhook-auth.server";

const SECRET = "test-secret";
const body = JSON.stringify({ shop_domain: "s.myshopify.com" });
const sign = (raw: string, secret = SECRET) => createHmac("sha256", secret).update(raw, "utf8").digest("base64");

function webhook(overrides: { hmac?: string | null; topic?: string | null; method?: string; body?: string } = {}) {
  const headers = new Headers({ "x-shopify-shop-domain": "s.myshopify.com" });
  const hmac = overrides.hmac === undefined ? sign(overrides.body ?? body) : overrides.hmac;
  const topic = overrides.topic === undefined ? "customers/redact" : overrides.topic;
  if (hmac !== null) headers.set("x-shopify-hmac-sha256", hmac);
  if (topic !== null) headers.set("x-shopify-topic", topic);
  const method = overrides.method ?? "POST";
  return new Request("https://app.example/webhooks/compliance", { method, headers, body: method === "POST" ? (overrides.body ?? body) : undefined });
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
}

describe("verifyWebhook", () => {
  it("accepts a correctly signed webhook without needing a session, in the library's topic form", async () => {
    await expect(verifyWebhook(webhook(), SECRET)).resolves.toEqual({ shop: "s.myshopify.com", topic: "CUSTOMERS_REDACT", payload: { shop_domain: "s.myshopify.com" } });
    await expect(verifyWebhook(webhook({ topic: "app/uninstalled" }), SECRET)).resolves.toMatchObject({ topic: "APP_UNINSTALLED" });
  });

  it("answers 401 for a wrong or forged signature, which Shopify's review checks", async () => {
    expect(await statusOf(verifyWebhook(webhook({ hmac: sign(body, "other-secret") }), SECRET))).toBe(401);
    expect(await statusOf(verifyWebhook(webhook({ hmac: "not-a-signature" }), SECRET))).toBe(401);
    expect(await statusOf(verifyWebhook(webhook(), ""))).toBe(401);
  });

  it("answers 400 for missing headers and 405 for anything but POST", async () => {
    expect(await statusOf(verifyWebhook(webhook({ hmac: null }), SECRET))).toBe(400);
    expect(await statusOf(verifyWebhook(webhook({ topic: null }), SECRET))).toBe(400);
    expect(await statusOf(verifyWebhook(webhook({ method: "GET" }), SECRET))).toBe(405);
  });
});
