import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "./shops.server";
import { hasMalformedHost, isOutsideAdmin } from "./outside-admin";

/**
 * Authenticate an embedded admin request and resolve its Shop row. Routes
 * call this instead of authenticate.admin directly so they never have to
 * look up the shop themselves. Lives apart from shops.server.ts so that
 * shopify.server.ts can import the shop helpers without an import cycle.
 */
export async function requireShop(request: Request) {
  // Opened outside the Shopify admin (a bookmark, a pasted URL): no shop and no Shopify token at all.
  // Send the visitor to the landing page, which says to open PrintFlex from the admin, instead of the
  // library's bare 410 rendered as "unexpected error". Requests from the admin always carry one of these.
  if (isOutsideAdmin(request)) throw redirect("/");
  rejectMalformedHost(request);
  const context = await authenticate.admin(request);
  const shop = await ensureShop(context.session.shop);
  return { ...context, shop };
}

/** A garbled `host` would make the Shopify library throw (a 500); answer 400 with what to do instead. */
export function rejectMalformedHost(request: Request) {
  if (hasMalformedHost(request)) throw new Response("This link is not valid. Open PrintFlex from Apps in your Shopify admin.", { status: 400 });
}
