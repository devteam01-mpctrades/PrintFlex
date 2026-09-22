import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop} (order ${String(payload?.id ?? "unknown")})`);

  // Stub: order sync into OrderIndex arrives in Phase 3.

  return new Response();
};
