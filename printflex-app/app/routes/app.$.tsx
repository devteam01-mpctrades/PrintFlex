import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import { requireShop } from "../lib/request.server";

/**
 * Any /app/* path no route matches. Without this, React Router's root boundary rendered a bare
 * "404 Not Found" with no way back; this keeps the visitor inside the admin with Home and Orders.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireShop(request);
  throw new Response("This page does not exist in PrintFlex. The link may be old or mistyped; carry on from Home or Orders.", { status: 404 });
};

export default function NotFound() {
  return null;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
