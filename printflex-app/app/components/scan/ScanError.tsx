import { isRouteErrorResponse, useRouteError } from "react-router";
import { ScanShell } from "./ScanShell";

/** The scan-mode error page: never a stack trace, always a next step. */
export function ScanError() {
  const error = useRouteError();
  const text =
    isRouteErrorResponse(error) && typeof error.data === "string" && error.data.trim()
      ? error.data
      : "Something went wrong on this page. Go back to the scan screen and try again; if there is no connection, orders you opened earlier still work.";
  return (
    <ScanShell title="Problem">
      <section className="card">
        <h1>That did not work</h1>
        <p>{text}</p>
        <a className="btn secondary" href="/scan">Back to scan</a>
      </section>
    </ScanShell>
  );
}
