import { beforeEach, describe, expect, it } from "vitest";
import type { GraphqlClient } from "../graphql.server";
import { FORCE_TEST_BILLING, billingTestMode, resetBillingTestModeCache } from "./test-mode.server";

function client(partnerDevelopment: boolean, calls: { n: number }): GraphqlClient {
  return {
    graphql: async () => {
      calls.n += 1;
      return new Response(JSON.stringify({ data: { shop: { plan: { partnerDevelopment } } } }), { status: 200 });
    },
  } as unknown as GraphqlClient;
}

describe("billing test mode", () => {
  beforeEach(() => resetBillingTestModeCache());

  it("is forced on outside production, so the test suite itself never risks a real charge", () => {
    expect(FORCE_TEST_BILLING).toBe(true);
  });

  it("asks Shopify once per shop whether it is a development store", async () => {
    const calls = { n: 0 };
    const production = { force: false };
    expect(await billingTestMode(client(true, calls), "dev.myshopify.com", production)).toBe(true);
    expect(await billingTestMode(client(true, calls), "dev.myshopify.com", production)).toBe(true);
    expect(calls.n).toBe(1);
    expect(await billingTestMode(client(false, calls), "real.myshopify.com", production)).toBe(false);
    expect(calls.n).toBe(2);
    // The forced mode never asks Shopify.
    expect(await billingTestMode(client(false, calls), "other.myshopify.com", { force: true })).toBe(true);
    expect(calls.n).toBe(2);
  });
});
