import { describe, expect, it } from "vitest";
import { isOutsideAdmin } from "./outside-admin";

describe("isOutsideAdmin", () => {
  it("is true only for a request with nothing from Shopify", () => {
    expect(isOutsideAdmin(new Request("https://app.example/app/orders"))).toBe(true);
    // The admin iframe's first load carries shop and id_token; client data requests carry the session token header.
    expect(isOutsideAdmin(new Request("https://app.example/app?shop=s.myshopify.com&host=abc&embedded=1&id_token=t"))).toBe(false);
    expect(isOutsideAdmin(new Request("https://app.example/app/orders.data", { headers: { Authorization: "Bearer t" } }))).toBe(false);
    expect(isOutsideAdmin(new Request("https://app.example/app?shop=s.myshopify.com"))).toBe(false);
  });
});
