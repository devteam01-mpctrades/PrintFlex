import { Link } from "react-router";

interface Props {
  packedToday: number;
  devicesToday: number;
  medianLabel: string | null;
  needsReview: number;
}

/** Three tiles. Needs review earns the brand tint only when there is something to act on. */
export function StatCards({ packedToday, devicesToday, medianLabel, needsReview }: Props) {
  return (
    <div className="pf-scan-stats">
      <div className="pf-stat">
        <div className="k">Packed today</div>
        <div className="v">{packedToday}</div>
        <div className="d">{packedToday === 0 ? "No parcels packed yet today" : `Across ${devicesToday} ${devicesToday === 1 ? "device" : "devices"}`}</div>
      </div>
      <div className="pf-stat">
        <div className="k">Median time per parcel</div>
        <div className="v">{medianLabel ?? "—"}</div>
        <div className="d">{medianLabel ? "From first scan to packed" : "Appears once an order has been scanned and packed"}</div>
      </div>
      <div className={`pf-stat${needsReview > 0 ? " hero" : ""}`}>
        <div className="k">Needs review</div>
        <div className="v">
          {needsReview > 0 ? (
            <Link to="/app/orders?docStatus=NEEDS_REVIEW" aria-label={`${needsReview} ${needsReview === 1 ? "order needs" : "orders need"} review. Open them in Orders.`}>
              {needsReview}
            </Link>
          ) : (
            needsReview
          )}
        </div>
        <div className="d">Short-picked or damaged — flagged by staff, not discovered by a customer</div>
      </div>
    </div>
  );
}
