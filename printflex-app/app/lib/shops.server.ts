import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import type { GraphqlClient } from "./graphql.server";
import { runGraphql } from "./graphql.server";

/** Find or create the Shop row for a myshopify domain. */
export async function ensureShop(domain: string, timezone?: string): Promise<Shop> {
  return prisma.shop.upsert({
    where: { domain },
    create: { domain, timezone: timezone ?? "UTC" },
    update: {
      uninstalledAt: null,
      ...(timezone ? { timezone } : {}),
    },
  });
}

const SHOP_QUERY = `#graphql
  query PrintFlexShopInfo {
    shop {
      ianaTimezone
    }
  }
`;

interface ShopInfoData {
  shop: { ianaTimezone: string };
}

/** Create or refresh the Shop row using the store's timezone from Shopify. */
export async function syncShopFromShopify(
  client: GraphqlClient,
  domain: string,
): Promise<Shop> {
  const { data } = await runGraphql<ShopInfoData>(client, SHOP_QUERY);
  return ensureShop(domain, data.shop.ianaTimezone);
}
