import { isRouteErrorResponse, useRouteError } from "react-router";
import { Btn } from "./ui";

/**
 * A sentence about what happened and what to do, for every admin route.
 * Thrown Responses carry their own text; anything else gets a generic one.
 */
export function RouteError() {
  const error = useRouteError();
  let heading = "Something went wrong";
  let text = "PrintFlex hit an unexpected error. Reload the page; if it happens again, the details are in the app logs.";
  if (isRouteErrorResponse(error)) {
    heading = error.status === 404 ? "Not found" : error.status === 403 ? "Not allowed" : `Error ${error.status}`;
    if (typeof error.data === "string" && error.data.trim()) text = error.data;
  }
  return (
    <s-page heading={heading}>
      <s-section>
        <s-banner tone="critical"><s-paragraph>{text}</s-paragraph></s-banner>
        <s-stack direction="inline" gap="small">
          <Btn href="/app">Home</Btn>
          <Btn href="/app/orders" variant="tertiary">Orders</Btn>
        </s-stack>
      </s-section>
    </s-page>
  );
}
