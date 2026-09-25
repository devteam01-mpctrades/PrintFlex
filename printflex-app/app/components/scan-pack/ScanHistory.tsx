import { useState } from "react";
import { downloadFile } from "../download";
import { Btn } from "../ui";

export interface HistoryItem {
  id: string;
  occurredAt: string;
  orderName: string;
  shopifyOrderNumber: string;
  deviceName: string;
  staffLabel: string | null;
  outcome: string;
  note: string | null;
}

interface Props {
  history: HistoryItem[];
  timezone: string;
  canExport: boolean;
  planName: string;
}

interface Badge {
  className: string;
  label: string;
  /** The staff note, shown under the badge in subdued text. */
  detail: string | null;
}

/**
 * flagOrder stores "<item>: missing — <staff note>"; the badge names the item
 * and the note follows as plain text, so the badge stays one short phrase.
 */
function outcomeBadge(item: HistoryItem): Badge {
  const flagged = (label: string, className: string): Badge => {
    const [head, ...rest] = (item.note ?? "").split(":");
    const itemName = head.trim();
    const detail = rest.join(":").split("—").slice(1).join("—").trim() || null;
    return { className, label: itemName ? `${label} — ${itemName}` : label, detail };
  };
  switch (item.outcome) {
    case "PACKED":
      return { className: "pf-b-ok", label: "Packed", detail: null };
    case "SHORT_PICK":
      return flagged("Short pick", "pf-b-crit");
    case "DAMAGED":
      return flagged("Damaged", "pf-b-crit");
    case "SUBSTITUTED":
      return flagged("Substituted", "pf-b-warn");
    case "WRONG_ITEM":
      return { className: "pf-b-warn", label: "Wrong item scanned", detail: item.note };
    default:
      return { className: "pf-b-neu", label: item.outcome.toLowerCase(), detail: item.note };
  }
}

/** Every pack event of the last 90 days, newest first. */
export function ScanHistory({ history, timezone, canExport, planName }: Props) {
  const [notice, setNotice] = useState<{ tone: "info" | "critical"; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const INITIAL_ROWS = 10;
  const rows = expanded ? history : history.slice(0, INITIAL_ROWS);

  // Today's events show the time alone, like a shift log; older ones carry the date.
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayKey(new Date());
  const time = (iso: string) => {
    const date = new Date(iso);
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
    return dayKey(date) === today ? clock : `${new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short" }).format(date)} ${clock}`;
  };

  const exportCsv = () => {
    if (!canExport) {
      setNotice({ tone: "info", text: `CSV export is part of Premium and Unlimited. Your ${planName} plan keeps the history on this page; upgrade on Plans & billing to download it.` });
      return;
    }
    void downloadFile("/app/scan-pack/export", "printflex-scan-history.csv").then((error) => setNotice(error ? { tone: "critical", text: error } : null));
  };

  return (
    <div className="pf-panel">
      <div className="pf-panel__h">
        <h2>Scan history</h2>
        <div className="right">
          <Btn onClick={exportCsv}>Export CSV</Btn>
        </div>
      </div>
      {notice ? (
        <div className="pf-panel__b" style={{ paddingBottom: 0 }}>
          <s-banner tone={notice.tone} dismissible onDismiss={() => setNotice(null)}>
            <s-paragraph>{notice.text}</s-paragraph>
            {notice.tone === "info" ? <Btn slot="secondary-actions" href="/app/billing">See plans</Btn> : null}
          </s-banner>
        </div>
      ) : null}
      {history.length === 0 ? (
        <div className="pf-panel__empty">
          <strong>No scans yet</strong>
          Staff sign in with a store PIN and a device name — no Shopify accounts, no staff seats used.
        </div>
      ) : (
        <div className="pf-tscroll">
          <table className="pf-t">
            <thead>
              <tr>
                <th>Time</th>
                <th>Order</th>
                <th>Device</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const badge = outcomeBadge(h);
                return (
                  <tr key={h.id}>
                    <td className="mono">{time(h.occurredAt)}</td>
                    <td className="mono">
                      <a className="pf-link" href={`shopify://admin/orders/${h.shopifyOrderNumber}`}>{h.orderName}</a>
                    </td>
                    <td>{h.deviceName} · {h.staffLabel ?? "—"}</td>
                    <td>
                      <span className={`pf-badge ${badge.className}`}>{badge.label}</span>
                      {badge.detail ? <span className="detail">{badge.detail}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="pf-panel__f">
        <span>
          {history.length > INITIAL_ROWS && !expanded ? `Showing ${INITIAL_ROWS} of ${history.length} · ` : ""}The last 90 days are kept.
        </span>
        {history.length > INITIAL_ROWS ? (
          <span className="right">
            <Btn variant="tertiary" onClick={() => setExpanded((v) => !v)}>{expanded ? "Show fewer" : `Show all ${history.length}`}</Btn>
          </span>
        ) : null}
      </div>
    </div>
  );
}
