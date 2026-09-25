import { runGraphql, type GraphqlClient } from "../graphql.server";

/**
 * Whether charges for a shop are test charges. Development stores can only
 * approve test charges, so the decision is per shop: Shopify says whether
 * the store is a partner development store. Outside production, or with
 * PRINTFLEX_TEST_BILLING=1, everything is a test charge.
 */

export const FORCE_TEST_BILLING = process.env.NODE_ENV !== "production" || process.env.PRINTFLEX_TEST_BILLING === "1";

const QUERY = `query BillingTestMode { shop { plan { partnerDevelopment } } }`;
interface Data {
  shop: { plan: { partnerDevelopment: boolean } };
}

/** Remembered per shop for an hour: a store does not stop being a development store mid-session. */
const cache = new Map<string, { value: boolean; until: number }>();
const TTL_MS = 60 * 60 * 1000;

export async function billingTestMode(
  client: GraphqlClient,
  shopDomain: string,
  options: { now?: number; force?: boolean } = {},
): Promise<boolean> {
  const { now = Date.now(), force = FORCE_TEST_BILLING } = options;
  if (force) return true;
  const hit = cache.get(shopDomain);
  if (hit && hit.until > now) return hit.value;
  const { data } = await runGraphql<Data>(client, QUERY);
  const value = Boolean(data.shop?.plan?.partnerDevelopment);
  cache.set(shopDomain, { value, until: now + TTL_MS });
  return value;
}

/** Tests only. */
export function resetBillingTestModeCache(): void {
  cache.clear();
}
