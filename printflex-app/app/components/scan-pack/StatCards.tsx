import type { ReactNode } from "react";
import { Btn } from "../ui";

interface Props {
  packedToday: number;
  devicesToday: number;
  medianLabel: string | null;
  needsReview: number;
}

const ICONS: Record<"box" | "clock" | "flag", ReactNode> = {
  box: <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <span className="pf-stat__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>
    </span>
  );
}

/** Jump to a section further down this page (the page scrolls inside the admin iframe, so no hash navigation). */
function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Three tiles, each with the action it leads to. Needs review earns the brand tint only when there is something to act on. */
export function StatCards({ packedToday, devicesToday, medianLabel, needsReview }: Props) {
  return (
    <div className="pf-scan-stats">
      <div className="pf-stat">
        <div className="pf-stat__top">
          <div className="k">Packed today</div>
          <Icon name="box" />
        </div>
        <div className="v">{packedToday}</div>
        <div className="d">{packedToday === 0 ? "No parcels packed yet today" : `Across ${devicesToday} ${devicesToday === 1 ? "device" : "devices"}`}</div>
        <div className="pf-stat__action">
          <Btn variant="tertiary" onClick={() => jumpTo("scan-history")}>View scan history ↓</Btn>
        </div>
      </div>
      <div className="pf-stat">
        <div className="pf-stat__top">
          <div className="k">Median time per parcel</div>
          <Icon name="clock" />
        </div>
        <div className="v">{medianLabel ?? "—"}</div>
        <div className="d">{medianLabel ? "From first scan to packed" : "Appears once an order has been scanned and packed"}</div>
        <div className="pf-stat__action">
          <Btn variant="tertiary" onClick={() => jumpTo("packer-preview")}>See the packer’s screen ↓</Btn>
        </div>
      </div>
      <div className={`pf-stat${needsReview > 0 ? " hero" : ""}`}>
        <div className="pf-stat__top">
          <div className="k">Needs review</div>
          <Icon name="flag" />
        </div>
        <div className="v">{needsReview}</div>
        <div className="d">Short-picked or damaged — flagged by staff, not discovered by a customer</div>
        <div className="pf-stat__action">
          {needsReview > 0 ? (
            <Btn variant="tertiary" href="/app/orders?docStatus=NEEDS_REVIEW">Review {needsReview === 1 ? "order" : `${needsReview} orders`} →</Btn>
          ) : (
            <span className="pf-stat__clear">✓ All clear</span>
          )}
        </div>
      </div>
    </div>
  );
}
