import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { PackLine, PackSheet } from "../../lib/pack/pack.server";
import { CameraScanner } from "./CameraScanner";

/**
 * The pack checklist. One big row per line: photo, title, variant, SKU,
 * and a count that must reach the required quantity. Tap = +1. Strict
 * mode swaps tapping for scanning each product barcode and shouts on a
 * mismatch. Progress is kept per order in localStorage so a refresh or a
 * dropped connection does not lose the count. Pack and flag actions carry
 * a client-generated event id, so a retry can never double-count.
 */

type Problem = "SHORT_PICK" | "DAMAGED" | "SUBSTITUTED";
const PROBLEM_LABEL: Record<Problem, string> = { SHORT_PICK: "Missing", DAMAGED: "Damaged", SUBSTITUTED: "Substituted" };

interface Progress {
  counts: Record<string, number>;
  flags: Record<string, { outcome: Problem; note: string }>;
  eventId: string;
}

function storageKey(orderId: string): string {
  return `pf:pack:${orderId}`;
}

function newEventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function load(orderId: string): Progress {
  try {
    const raw = window.localStorage.getItem(storageKey(orderId));
    if (raw) return JSON.parse(raw) as Progress;
  } catch {
    /* fall through */
  }
  return { counts: {}, flags: {}, eventId: newEventId() };
}

export interface PackActionResult {
  ok: boolean;
  message: string;
  outcome?: "packed" | "flagged";
}

interface Props {
  sheet: PackSheet;
}

export function PackScreen({ sheet }: Props) {
  const { order, lines, settings } = sheet;
  const fetcher = useFetcher<PackActionResult>();
  const [progress, setProgress] = useState<Progress>({ counts: {}, flags: {}, eventId: "" });
  const [hydrated, setHydrated] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [problemFor, setProblemFor] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [camera, setCamera] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanValue, setScanValue] = useState("");

  useEffect(() => {
    setProgress(load(order.id));
    setHydrated(true);
  }, [order.id]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey(order.id), JSON.stringify(progress));
    } catch {
      /* storage full or blocked: the screen still works */
    }
  }, [progress, hydrated, order.id]);

  const done = order.documentStatus === "PACKED";
  const flaggedOrder = order.documentStatus === "NEEDS_REVIEW";
  const busy = fetcher.state !== "idle";

  const countFor = (line: PackLine) => Math.min(line.quantity, progress.counts[line.id] ?? 0);
  const complete = (line: PackLine) => countFor(line) >= line.quantity || Boolean(progress.flags[line.id]);
  const allDone = lines.every(complete);
  const anyFlag = Object.keys(progress.flags).length > 0;
  const checkedUnits = useMemo(() => lines.reduce((n, l) => n + countFor(l), 0), [lines, progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalUnits = lines.reduce((n, l) => n + l.quantity, 0);

  const bump = useCallback((line: PackLine, delta: number) => {
    setProgress((p) => {
      const next = Math.max(0, Math.min(line.quantity, (p.counts[line.id] ?? 0) + delta));
      return { ...p, counts: { ...p.counts, [line.id]: next } };
    });
  }, []);

  // Strict mode: a scanned value must match a line that still needs units.
  const handleScan = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      const match = lines.find((l) => (l.barcode === value || l.sku === value) && countFor(l) < l.quantity);
      if (match) {
        setMismatch(null);
        bump(match, 1);
        if (navigator.vibrate) navigator.vibrate(40);
      } else {
        const known = lines.find((l) => l.barcode === value || l.sku === value);
        setMismatch(known ? `${known.title} is already complete. Scanned ${value}.` : `${value} is not in this order.`);
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
        fetcher.submit({ intent: "wrongScan", scanned: value }, { method: "post" });
      }
      setScanValue("");
      scanRef.current?.focus();
    },
    [lines, bump, fetcher], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (settings.strictMode && !done) scanRef.current?.focus();
  }, [settings.strictMode, done]);

  const pack = () => {
    fetcher.submit(
      { intent: "pack", clientEventId: progress.eventId, itemCount: String(checkedUnits), weightGrams: weight.trim() ? String(Math.round(Number(weight))) : "" },
      { method: "post" },
    );
  };
  const sendForReview = () => {
    const flagged = lines.filter((l) => progress.flags[l.id]).map((l) => ({ lineId: l.id, title: l.title, ...progress.flags[l.id] }));
    fetcher.submit({ intent: "flag", clientEventId: `${progress.eventId}:review`, lines: JSON.stringify(flagged) }, { method: "post" });
  };

  // After a successful pack or flag, forget local progress so a re-scan starts clean.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.outcome) {
      try {
        window.localStorage.removeItem(storageKey(order.id));
      } catch {
        /* ignore */
      }
    }
  }, [fetcher.state, fetcher.data, order.id]);

  const statusBadge = done ? <span className="badge ok">Packed</span> : flaggedOrder ? <span className="badge warn">Needs review</span> : null;

  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <p className="big">{order.orderName}</p>
          <span style={{ flex: "0 0 auto" }}>{statusBadge}</span>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          {order.customerName ?? "Guest"} · {totalUnits} {totalUnits === 1 ? "item" : "items"}
          {order.destination ? ` · ${order.destination}` : ""}
          {order.shippingMethod ? ` · ${order.shippingMethod}` : ""}
        </p>
        {sheet.lastEvent ? (
          <p className="hint">
            Last: {sheet.lastEvent.outcome.replaceAll("_", " ").toLowerCase()} by {sheet.lastEvent.deviceName} at{" "}
            {new Date(sheet.lastEvent.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {sheet.lastEvent.note ? ` — ${sheet.lastEvent.note}` : ""}
          </p>
        ) : null}
      </section>

      {fetcher.data && !busy ? (
        <p className={`notice ${fetcher.data.ok ? (fetcher.data.outcome === "flagged" ? "" : "ok") : "bad"}`}>{fetcher.data.message}</p>
      ) : null}

      {done ? (
        <section className="card">
          <p>This order is already packed. Scanning it again changes nothing and counts nothing twice.</p>
          <a className="btn secondary" href="/scan">Scan another order</a>
        </section>
      ) : (
        <>
          {settings.strictMode ? (
            <section className="card" style={mismatch ? { background: "#fef2f2", outline: "4px solid #b91c1c" } : undefined}>
              <h2>Strict mode: scan each item</h2>
              {mismatch ? (
                <p className="notice bad" style={{ fontSize: 20, fontWeight: 700 }}>
                  ✕ Wrong item. {mismatch}
                </p>
              ) : (
                <p className="hint">Scan the product barcode on each unit. Tapping is disabled.</p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleScan(scanValue);
                }}
              >
                <input ref={scanRef} value={scanValue} onChange={(e) => setScanValue(e.target.value)} placeholder="Scan product barcode" autoComplete="off" inputMode="text" />
              </form>
              {camera ? (
                <>
                  <CameraScanner active={camera} onResult={(t) => { handleScan(t); }} />
                  <button className="btn ghost" type="button" onClick={() => setCamera(false)}>Stop camera</button>
                </>
              ) : (
                <button className="btn secondary" type="button" onClick={() => setCamera(true)}>Use camera</button>
              )}
            </section>
          ) : null}

          <section className="card" style={{ padding: 0 }}>
            <ul className="list" style={{ padding: "0 6px" }}>
              {lines.map((line) => {
                const count = countFor(line);
                const flag = progress.flags[line.id];
                const isDone = count >= line.quantity;
                return (
                  <li key={line.id} style={{ padding: 0 }}>
                    <div
                      role={settings.strictMode ? undefined : "button"}
                      tabIndex={settings.strictMode ? -1 : 0}
                      onClick={() => !settings.strictMode && !flag && bump(line, 1)}
                      onKeyDown={(e) => { if (!settings.strictMode && (e.key === "Enter" || e.key === " ")) bump(line, 1); }}
                      style={{
                        display: "flex", gap: 12, alignItems: "center", padding: "12px 10px", minHeight: 76, cursor: settings.strictMode ? "default" : "pointer",
                        background: flag ? "#fffbeb" : isDone ? "#ecfdf5" : "transparent", borderRadius: 10,
                      }}
                    >
                      {settings.showPhotos ? (
                        line.imageUrl ? (
                          <img src={line.imageUrl} alt="" width={56} height={56} style={{ borderRadius: 8, objectFit: "cover", flex: "0 0 auto", background: "#eee" }} />
                        ) : (
                          <div style={{ width: 56, height: 56, borderRadius: 8, background: "#e5e7eb", flex: "0 0 auto", display: "grid", placeItems: "center", fontWeight: 700, color: "#6b7280" }}>
                            {line.title.slice(0, 2).toUpperCase()}
                          </div>
                        )
                      ) : null}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.25 }}>{line.title}</div>
                        <div className="muted" style={{ fontSize: 14 }}>
                          {[line.variantTitle, line.sku, line.partOf ? `part of ${line.partOf}` : null].filter(Boolean).join(" · ")}
                        </div>
                        {flag ? <div style={{ fontSize: 14, color: "#b45309", fontWeight: 600 }}>{PROBLEM_LABEL[flag.outcome]}{flag.note ? ` — ${flag.note}` : ""}</div> : null}
                      </div>
                      <div style={{ flex: "0 0 auto", textAlign: "center", minWidth: 64 }}>
                        <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: isDone ? "#047857" : "#111827" }}>
                          {isDone ? "✓" : `${count}/${line.quantity}`}
                        </div>
                        {isDone && line.quantity > 1 ? <div className="hint" style={{ marginTop: 0 }}>{line.quantity}/{line.quantity}</div> : null}
                      </div>
                    </div>
                    <div className="row" style={{ padding: "0 10px 10px", gap: 8 }}>
                      {!settings.strictMode && count > 0 ? (
                        <button className="btn ghost" type="button" style={{ marginTop: 0, flex: "0 0 auto" }} onClick={() => bump(line, -1)}>−1</button>
                      ) : null}
                      {settings.allowShortPick && !flag ? (
                        <button className="btn ghost" type="button" style={{ marginTop: 0 }} onClick={() => setProblemFor(line.id)}>Can’t complete this line</button>
                      ) : null}
                      {flag ? (
                        <button className="btn ghost" type="button" style={{ marginTop: 0 }} onClick={() => setProgress((p) => { const flags = { ...p.flags }; delete flags[line.id]; return { ...p, flags }; })}>Clear problem</button>
                      ) : null}
                    </div>
                    {problemFor === line.id ? (
                      <ProblemForm
                        onCancel={() => setProblemFor(null)}
                        onSave={(outcome, note) => {
                          setProgress((p) => ({ ...p, flags: { ...p.flags, [line.id]: { outcome, note } } }));
                          setProblemFor(null);
                        }}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <p className="muted">
              {checkedUnits} of {totalUnits} units checked{anyFlag ? ` · ${Object.keys(progress.flags).length} line${Object.keys(progress.flags).length === 1 ? "" : "s"} flagged` : ""}
            </p>
            {settings.askWeight && !anyFlag ? (
              <>
                <label htmlFor="weight">Parcel weight (grams)</label>
                <input id="weight" inputMode="numeric" pattern="[0-9]*" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d]/g, ""))} placeholder="640" />
              </>
            ) : null}
            {anyFlag ? (
              <button className="btn" type="button" disabled={busy} onClick={sendForReview} style={{ background: "#b45309" }}>
                Send for review
              </button>
            ) : (
              <button className="btn" type="button" disabled={busy || (settings.requireAllChecked && !allDone)} onClick={pack}>
                {busy ? "Saving…" : settings.requireAllChecked && !allDone ? `${totalUnits - checkedUnits} left to check` : "Mark as packed"}
              </button>
            )}
            <a className="btn ghost" href="/scan">Scan another order</a>
          </section>
        </>
      )}
    </>
  );
}

function ProblemForm({ onSave, onCancel }: { onSave: (outcome: Problem, note: string) => void; onCancel: () => void }) {
  const [outcome, setOutcome] = useState<Problem>("SHORT_PICK");
  const [note, setNote] = useState("");
  return (
    <div style={{ padding: "0 10px 12px" }}>
      <div className="row">
        {(Object.keys(PROBLEM_LABEL) as Problem[]).map((p) => (
          <button key={p} type="button" className={`btn ${outcome === p ? "" : "secondary"}`} style={{ marginTop: 0, minHeight: 48, padding: 10 }} onClick={() => setOutcome(p)}>
            {PROBLEM_LABEL[p]}
          </button>
        ))}
      </div>
      <label htmlFor="note">Note (optional)</label>
      <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only 1 left on shelf" maxLength={200} />
      <div className="row">
        <button className="btn secondary" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn" type="button" onClick={() => onSave(outcome, note)}>Flag line</button>
      </div>
    </div>
  );
}
