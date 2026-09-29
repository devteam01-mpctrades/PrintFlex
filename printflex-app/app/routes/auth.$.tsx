import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { rejectMalformedHost } from "../lib/request.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  rejectMalformedHost(request);
  await authenticate.admin(request);

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
