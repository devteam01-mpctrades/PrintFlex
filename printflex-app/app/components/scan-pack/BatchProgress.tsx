import { Link } from "react-router";
import { Btn } from "../ui";

export interface BatchCounts {
  packed: number;
  "in-progress": number;
  "needs-review": number;
  "not-started": number;
}

interface Props {
  batch: { id: string; label: string; total: number; counts: BatchCounts } | null;
}

const SEGMENTS: Array<{ key: keyof BatchCounts; label: string }> = [
  { key: "packed", label: "Packed" },
  { key: "in-progress", label: "In progress" },
  { key: "needs-review", label: "Needs review" },
  { key: "not-started", label: "Not started" },
];

/** The most recent printed batch and where every order in it stands. */
export function BatchProgress({ batch }: Props) {
  if (!batch) {
    return (
      <div className="pf-panel">
        <div className="pf-panel__h"><h2>Batch progress</h2></div>
        <div className="pf-panel__b">
          <p>Print a batch and its progress appears here as staff pack it.</p>
          <div style={{ marginTop: 10 }}>
            <Btn href="/app/orders">Go to Orders</Btn>
          </div>
        </div>
      </div>
    );
  }
  const total = Math.max(1, batch.total);
  return (
    <div className="pf-panel">
      <div className="pf-panel__h">
        <h2>
          <Link className="pf-link" to={`/app/jobs/${batch.id}`}>{batch.label}</Link> progress
        </h2>
        <div className="right">
          <span className="pf-badge pf-b-brand">{batch.total} {batch.total === 1 ? "order" : "orders"}</span>
        </div>
      </div>
      <div className="pf-panel__b">
        <div className="pf-segbar" role="img" aria-label={SEGMENTS.map((s) => `${s.label} ${batch.counts[s.key]}`).join(", ")}>
          {SEGMENTS.map((s) => (
            <span key={s.key} className={s.key} style={{ width: `${(batch.counts[s.key] / total) * 100}%` }} />
          ))}
        </div>
        <div className="pf-legend">
          {SEGMENTS.map((s) => (
            <span key={s.key} className={s.key}>{s.label} {batch.counts[s.key]}</span>
          ))}
        </div>
        <p style={{ marginTop: 10 }}>Scan the batch cover sheet to open this view on any phone on the floor.</p>
      </div>
    </div>
  );
}
