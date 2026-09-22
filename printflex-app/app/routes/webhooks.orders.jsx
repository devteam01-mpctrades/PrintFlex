import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop} (order ${payload?.id ?? "unknown"})`);

  // TODO: sync the order into PrintFlex's print queue.

  return new Response();
};
