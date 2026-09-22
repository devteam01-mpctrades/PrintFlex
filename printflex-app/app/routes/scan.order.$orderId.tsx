import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { OrderSummaryCard } from "../components/scan/OrderSummaryCard";
import { ScanShell } from "../components/scan/ScanShell";
import { loadOrderSummary } from "../lib/scan/lookup.server";
import { requireDevice } from "../lib/scan/scan-request.server";

/** An order opened from the hub (barcode, USB scanner or typed number) by a signed-in device. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const session = await requireDevice(request);
  const order = await loadOrderSummary(session.shopId, params.orderId ?? "");
  return { device: session.name, order };
};

export default function ScanOrderPage() {
  const { device, order } = useLoaderData<typeof loader>();
  return (
    <ScanShell title="Order" device={device}>
      {order ? (
        <>
          <OrderSummaryCard order={order} />
          <section className="card">
            <p className="muted">Checking items and marking the order packed arrive in the next update.</p>
            <a className="btn secondary" href="/scan">Scan another order</a>
          </section>
        </>
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
