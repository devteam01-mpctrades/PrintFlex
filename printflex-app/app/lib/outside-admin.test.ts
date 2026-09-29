import { describe, expect, it } from "vitest";
import { hasMalformedHost, isOutsideAdmin } from "./outside-admin";

describe("isOutsideAdmin", () => {
  it("is true only for a request with nothing from Shopify", () => {
    expect(isOutsideAdmin(new Request("https://app.example/app/orders"))).toBe(true);
    // The admin iframe's first load carries shop and id_token; client data requests carry the session token header.
    expect(isOutsideAdmin(new Request("https://app.example/app?shop=s.myshopify.com&host=abc&embedded=1&id_token=t"))).toBe(false);
    expect(isOutsideAdmin(new Request("https://app.example/app/orders.data", { headers: { Authorization: "Bearer t" } }))).toBe(false);
    expect(isOutsideAdmin(new Request("https://app.example/app?shop=s.myshopify.com"))).toBe(false);
  });
});

describe("hasMalformedHost", () => {
  const withHost = (host: string) => new Request(`https://app.example/app?shop=s.myshopify.com&host=${encodeURIComponent(host)}`);
  it("accepts the host the admin sends, and leaves absent or non-base64 hosts to the library", () => {
    expect(hasMalformedHost(withHost(btoa("admin.shopify.com/store/s")))).toBe(false);
    expect(hasMalformedHost(new Request("https://app.example/app?shop=s.myshopify.com"))).toBe(false);
    expect(hasMalformedHost(withHost("not base64!"))).toBe(false);
  });
  it("flags base64 that does not decode to a hostname (the App Store review 500)", () => {
    expect(hasMalformedHost(withHost("99956e7tjE8I7cu/ffff"))).toBe(true);
    expect(hasMalformedHost(withHost("a"))).toBe(true);
  });
});
