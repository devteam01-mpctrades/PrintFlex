import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { cacheSheet, cachedSheet } from "../components/scan/offline";
import { PackScreen } from "../components/scan/PackScreen";
import { ScanShell } from "../components/scan/ScanShell";
import { loadPackSheet, recordOpened } from "../lib/pack/pack.server";
import { requireDevice } from "../lib/scan/scan-request.server";

/** The pack screen. Every entry path (QR, barcode, USB, typed) ends here. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const session = await requireDevice(request);
  const sheet = await loadPackSheet(session.shopId, params.orderId ?? "");
  if (sheet) await recordOpened(session.shopId, sheet.order.id, session.name, session.staffLabel);
  return { device: session.name, sheet, offline: false as boolean, cachedAt: null as string | null };
};

/**
 * Offline: when the server cannot be reached, render the sheet cached when
 * the batch (or this order) was last opened. When it can, refresh the cache.
 */
export async function clientLoader({ serverLoader, params }: ClientLoaderFunctionArgs) {
  try {
    const data = await serverLoader<typeof loader>();
    if (data.sheet) cacheSheet(data.sheet);
    return data;
  } catch (error) {
    const hit = cachedSheet(params.orderId ?? "");
    if (!hit) throw error;
    const device = window.localStorage.getItem("pf:device") ?? "this device";
    return { device, sheet: hit.sheet, offline: true, cachedAt: hit.cachedAt };
  }
}
clientLoader.hydrate = true as const;

export default function ScanOrderPage() {
  const { device, sheet, offline, cachedAt } = useLoaderData<typeof loader>();
  return (
    <ScanShell title="Order" device={device}>
      {offline && cachedAt ? (
        <p className="notice">No connection. Showing this order as it was at {new Date(cachedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Checking items works; packing will sync when the signal returns.</p>
      ) : null}
      {sheet ? (
        <PackScreen sheet={sheet} />
      ) : (
        <section className="card">
          <h1>Order not found</h1>
          <p>No order with that number is in PrintFlex for this store. Check the number and try again.</p>
          <a className="btn secondary" href="/scan">Back</a>
        </section>
      )}
    </ScanShell>
  );
}
