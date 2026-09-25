import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BILLING_CONFIG } from "./lib/billing/plans-config.server";
import { handleReinstall } from "./lib/lifecycle.server";
import { startBackfill } from "./lib/orders/sync.server";
import { syncShopFromShopify } from "./lib/shops.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: BILLING_CONFIG,
  // Order webhooks are registered per store at install (shop-level subscriptions), because the
  // app-level ones declared in shopify.app.toml were not delivered for an already-installed store.
  // Uninstall, scope and compliance topics stay app-level in the toml, as Shopify requires.
  webhooks: {
    ORDERS_CREATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/orders" },
    ORDERS_UPDATED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/orders" },
    ORDERS_FULFILLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/orders" },
    ORDERS_CANCELLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/orders" },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await shopify.registerWebhooks({ session });
      const shop = await syncShopFromShopify(admin, session.shop);
      if (shop.uninstalledAt) await handleReinstall(shop.id);
      const synced = await prisma.orderIndex.count({ where: { shopId: shop.id } });
      if (synced === 0) {
        // First install: backfill in the background so auth completes fast.
        // Progress and failures are recorded in SyncRun, not just logged.
        const { run, started } = await startBackfill(admin, shop.id, "install");
        console.log(`Initial order sync for ${session.shop}: ${started ? "started" : "already running"} (${run.id})`);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
