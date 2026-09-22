import type { OrderSummary } from "../../lib/scan/lookup.server";

const STATUS: Record<string, { label: string; cls: string }> = {
  NEW: { label: "Not printed", cls: "" },
  PRINTED: { label: "Printed", cls: "info" },
  PACKED: { label: "Packed", cls: "ok" },
  NEEDS_REVIEW: { label: "Needs review", cls: "warn" },
};

export function OrderSummaryCard({ order }: { order: OrderSummary }) {
  const status = STATUS[order.documentStatus] ?? { label: order.documentStatus, cls: "" };
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="big">{order.orderName}</p>
        <span className={`badge ${status.cls}`} style={{ flex: "0 0 auto" }}>{status.label}</span>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>{order.customerName ?? "Guest checkout"}</p>
      <div className="meta">
        <div><div className="l">Items</div><div className="v num">{order.itemCount}</div></div>
        <div><div className="l">Shipping</div><div className="v">{order.shippingMethod ?? "—"}</div></div>
        <div style={{ gridColumn: "1 / -1" }}><div className="l">Destination</div><div className="v">{order.destination ?? "—"}</div></div>
      </div>
    </section>
  );
}
