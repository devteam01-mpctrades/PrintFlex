import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { handleUninstall } from "../lib/lifecycle.server";
import { verifyWebhook } from "../lib/webhook-auth.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Not authenticate.webhook: it refreshes the expired offline token first, which Shopify refuses
  // for an uninstalled shop, and the library then answers 500. This handler never calls the API.
  const { shop, topic } = await verifyWebhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled;
  // deleting sessions and handleUninstall are both safe to repeat.
  await db.session.deleteMany({ where: { shop } });
  // Shopify has already cancelled the subscription. Mirror Free, stop jobs and emails, start the retention clock.
  await handleUninstall(shop);

  return new Response();
};
