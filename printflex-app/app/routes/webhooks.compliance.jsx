import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received compliance webhook ${topic} for ${shop}`);

  // PrintFlex stores no customer data outside Shopify yet, so there is nothing to export or erase.

  return new Response();
};
