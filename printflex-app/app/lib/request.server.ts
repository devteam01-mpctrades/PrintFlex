import { authenticate } from "../shopify.server";
import { ensureShop } from "./shops.server";

/**
 * Authenticate an embedded admin request and resolve its Shop row. Routes
 * call this instead of authenticate.admin directly so they never have to
 * look up the shop themselves. Lives apart from shops.server.ts so that
 * shopify.server.ts can import the shop helpers without an import cycle.
 */
export async function requireShop(request: Request) {
  const context = await authenticate.admin(request);
  const shop = await ensureShop(context.session.shop);
  return { ...context, shop };
}
