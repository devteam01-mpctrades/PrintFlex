import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handleCustomerRedact, handleDataRequest, handleShopRedact, type DataRequestPayload, type RedactPayload } from "../lib/compliance.server";

/**
 * customers/data_request, customers/redact, shop/redact. Each is real work
 * done now: files off disk, rows out of the database, an audit entry.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      const file = await handleDataRequest(payload as unknown as DataRequestPayload);
      console.log(`GDPR data request for ${shop}: ${file ?? "no data"}`);
      break;
    }
    case "CUSTOMERS_REDACT": {
      const result = await handleCustomerRedact(payload as unknown as RedactPayload);
      console.log(`GDPR customer redact for ${shop}: ${result.orders} orders, ${result.files} files`);
      break;
    }
    case "SHOP_REDACT": {
      const done = await handleShopRedact(shop);
      console.log(`GDPR shop redact for ${shop}: ${done ? "done" : "nothing stored"}`);
      break;
    }
    default:
      console.warn(`Unexpected compliance topic ${topic} for ${shop}`);
  }
  return new Response();
};
