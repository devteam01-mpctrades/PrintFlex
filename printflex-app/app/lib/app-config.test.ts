import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dev (shopify.app.toml) and production (shopify.app.production.toml) are two
 * Shopify apps running the same code, so everything but the app id and URLs
 * must match: a scope or webhook added to one and not the other only shows up
 * after release.
 */
const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
const dev = read("shopify.app.toml");
const production = read("shopify.app.production.toml");

/** The text from `[access_scopes]` up to `[auth]`: scopes, webhook API version, every subscription. */
function scopesAndWebhooks(toml: string): string {
  const start = toml.indexOf("[access_scopes]");
  const end = toml.indexOf("[auth]");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return toml.slice(start, end).replace(/^\s*#.*$/gm, "").replace(/\s+/g, " ").trim();
}

describe("Shopify app configs", () => {
  it("request the same scopes and webhooks in dev and production", () => {
    expect(scopesAndWebhooks(production)).toBe(scopesAndWebhooks(dev));
    expect(production).toContain('compliance_topics = [ "customers/data_request", "customers/redact", "shop/redact" ]');
  });

  it("point production only at the production URL", () => {
    expect(production).toContain('application_url = "https://app.printflex.mpctrades.com"');
    expect(production).toContain('"https://app.printflex.mpctrades.com/auth/callback"');
    expect(production).not.toContain("dev.printflex.mpctrades.com");
  });

  it("uses the listed app's client_id in production", () => {
    expect(production).toMatch(/^client_id = "34363db3a11f246c64f2b24864846aea"$/m);
  });

  // Turns into a real check once shopify.app.toml carries the PrintFlex Dev app's client_id.
  it.todo("uses a different Shopify app (client_id) for dev than for production");
});
