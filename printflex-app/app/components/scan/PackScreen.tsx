import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PackLine, PackSheet } from "../../lib/pack/pack.server";
import { CameraScanner } from "./CameraScanner";
import { enqueue, markCachedStatus, pendingFor, postEvent, type ApiResult } from "./offline";

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

/** Avatar colours for items without a photo, chosen from the title so the same product always looks the same. */
const AVATAR_COLOURS = ["#b8480a", "#2f6b3a", "#5b4b9a", "#2f5fa8", "#a03060", "#0f766e", "#7c5a12"];
function avatarColour(title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}
function initials(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : title.slice(0, 2)).toUpperCase();
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

export type PackActionResult = ApiResult;

interface Props {
  sheet: PackSheet;
  /** The merchant's "What the packer sees" pane: nothing is sent or stored. */
  preview?: boolean;
}

export function PackScreen({ sheet, preview = false }: Props) {
  const { order, lines, settings } = sheet;
  const [progress, setProgress] = useState<Progress>({ counts: {}, flags: {}, eventId: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(ApiResult & { queued?: boolean }) | null>(null);
  const [pendingQueued, setPendingQueued] = useState(false);
  // Local view of the status: flips as soon as the event is queued or accepted.
  const [status, setStatus] = useState(order.documentStatus);
  const [hydrated, setHydrated] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [problemFor, setProblemFor] = useState<string | null>(null);
  // "Can't complete this order?" opens one flow for the whole order; the line is chosen inside it.
  const [exception, setException] = useState(false);
  /** The merchant's preview shows a short list so the pack button stays in view. */
  const PREVIEW_LINES = 5;
  const visibleLines = preview ? lines.slice(0, PREVIEW_LINES) : lines;
  const hiddenLines = lines.length - visibleLines.length;
  const [weight, setWeight] = useState("");
  const [camera, setCamera] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanValue, setScanValue] = useState("");

  useEffect(() => {
    setProgress(load(order.id));
    setHydrated(true);
    setPendingQueued(Boolean(pendingFor(order.id)));
    const onQueue = () => setPendingQueued(Boolean(pendingFor(order.id)));
    window.addEventListener("pf:queue", onQueue);
    // Tell the server this order is being worked on (best effort, offline-safe).
    if (!preview) postEvent(order.id, "opened", {}).catch(() => undefined);
    return () => window.removeEventListener("pf:queue", onQueue);
  }, [order.id, preview]);
  useEffect(() => setStatus(order.documentStatus), [order.documentStatus]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey(order.id), JSON.stringify(progress));
    } catch {
      /* storage full or blocked: the screen still works */
    }
  }, [progress, hydrated, order.id]);

  const done = status === "PACKED";
  const flaggedOrder = status === "NEEDS_REVIEW";

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
        if (!preview) postEvent(order.id, "wrongScan", { scanned: value }).catch(() => undefined);
      }
      setScanValue("");
      scanRef.current?.focus();
    },
    [lines, bump, order.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (settings.strictMode && !done) scanRef.current?.focus();
  }, [settings.strictMode, done]);

  /**
   * Send an event now if the network is there; otherwise queue it and apply
   * it locally. Either way the merchant sees the truth: "Packed" when the
   * server confirmed, "Packed · pending sync" when it is only queued.
   */
  const send = async (intent: "pack" | "flag", fields: Record<string, string>, localStatus: "PACKED" | "NEEDS_REVIEW") => {
    if (preview) {
      setResult({ ok: true, message: `Preview only. On a real device this would mark the order ${localStatus === "PACKED" ? "packed" : "for review"} and tag it in Shopify.` });
      return;
    }
    setBusy(true);
    try {
      const response = await postEvent(order.id, intent, fields);
      if (response.ok || !/retried automatically/.test(response.message)) {
        setResult(response);
        if (response.ok) {
          setStatus(localStatus);
          markCachedStatus(order.id, localStatus);
          try { window.localStorage.removeItem(storageKey(order.id)); } catch { /* ignore */ }
        }
        return;
      }
      // Server reached but Shopify was not: queue for retry.
      enqueue({ id: fields.clientEventId, orderId: order.id, intent, fields });
      setStatus(localStatus);
      markCachedStatus(order.id, localStatus);
      setResult({ ok: true, queued: true, message: "Saved on this device. Shopify was not reachable; it will sync automatically." });
    } catch {
      enqueue({ id: fields.clientEventId, orderId: order.id, intent, fields });
      setStatus(localStatus);
      markCachedStatus(order.id, localStatus);
      setResult({ ok: true, queued: true, message: "No connection. Saved on this device and will sync when the signal returns. Nothing will be counted twice." });
    } finally {
      setBusy(false);
    }
  };
  const pack = () =>
    void send("pack", { clientEventId: progress.eventId, itemCount: String(checkedUnits), weightGrams: weight.trim() ? String(Math.round(Number(weight))) : "" }, "PACKED");
  const sendForReview = () => {
    const flagged = lines.filter((l) => progress.flags[l.id]).map((l) => ({ lineId: l.id, title: l.title, ...progress.flags[l.id] }));
    void send("flag", { clientEventId: `${progress.eventId}:review`, lines: JSON.stringify(flagged) }, "NEEDS_REVIEW");
  };

  const statusBadge = done ? (
    <span className={`badge ${pendingQueued ? "warn" : "ok"}`}>{pendingQueued ? "Packed · pending sync" : "Packed"}</span>
  ) : flaggedOrder ? (
    <span className="badge warn">{pendingQueued ? "Review · pending sync" : "Needs review"}</span>
  ) : null;

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

      {result && !busy ? (
        <p className={`notice ${result.ok ? (result.queued || result.outcome === "flagged" ? "" : "ok") : "bad"}`}>{result.message}</p>
      ) : null}

      {done ? (
        <section className="card">
          <p>{pendingQueued ? "This order is packed on this device and waiting to sync." : "This order is already packed. Scanning it again changes nothing and counts nothing twice."}</p>
          {preview ? null : <a className="btn secondary" href="/scan">Scan another order</a>}
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
              {visibleLines.map((line) => {
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
                          <div className="avatar" style={{ background: avatarColour(line.title) }}>{initials(line.title)}</div>
                        )
                      ) : null}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="title" style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.25 }}>{line.title}</div>
                        {preview ? null : (
                          <div className="muted" style={{ fontSize: 14 }}>
                            {[line.variantTitle, line.sku, line.partOf ? `part of ${line.partOf}` : null].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        {flag ? <div style={{ fontSize: 14, color: "#b45309", fontWeight: 600 }}>{PROBLEM_LABEL[flag.outcome]}{flag.note ? ` — ${flag.note}` : ""}</div> : null}
                      </div>
                      <div style={{ flex: "0 0 auto", textAlign: "center", minWidth: 64 }}>
                        <div className="count" style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: isDone ? "#047857" : "#111827" }}>
                          {isDone ? "✓" : `${count}/${line.quantity}`}
                        </div>
                        {isDone && line.quantity > 1 ? <div className="hint" style={{ marginTop: 0 }}>{line.quantity}/{line.quantity}</div> : null}
                      </div>
                    </div>
                    {(!settings.strictMode && count > 0) || flag ? (
                      <div className="row" style={{ padding: "0 10px 10px", gap: 8 }}>
                        {!settings.strictMode && count > 0 ? (
                          <button className="btn ghost" type="button" style={{ marginTop: 0, flex: "0 0 auto" }} onClick={() => bump(line, -1)}>−1</button>
                        ) : null}
                        {flag ? (
                          <button className="btn ghost" type="button" style={{ marginTop: 0 }} onClick={() => setProgress((p) => { const flags = { ...p.flags }; delete flags[line.id]; return { ...p, flags }; })}>Clear problem</button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {hiddenLines > 0 ? (
                <li style={{ padding: "12px 10px" }}>
                  <span className="muted">+{hiddenLines} more {hiddenLines === 1 ? "item" : "items"}</span>
                </li>
              ) : null}
            </ul>
          </section>

          {exception && settings.allowShortPick ? (
            <section className="card">
              <h2>Can’t complete this order</h2>
              <p className="hint">Pick the line with the problem, say what happened, then send the order for review. It will be flagged for the store instead of shipped short.</p>
              {problemFor ? (
                <>
                  <p style={{ fontWeight: 600 }}>{lines.find((l) => l.id === problemFor)?.title}</p>
                  <ProblemForm
                    onCancel={() => setProblemFor(null)}
                    onSave={(outcome, note) => {
                      setProgress((p) => ({ ...p, flags: { ...p.flags, [problemFor]: { outcome, note } } }));
                      setProblemFor(null);
                      setException(false);
                    }}
                  />
                </>
              ) : (
                <>
                  {lines.filter((l) => !progress.flags[l.id]).map((line) => (
                    <button key={line.id} className="btn secondary" type="button" onClick={() => setProblemFor(line.id)}>
                      {line.title}
                    </button>
                  ))}
                  <button className="btn ghost" type="button" onClick={() => setException(false)}>Never mind</button>
                </>
              )}
            </section>
          ) : null}

          <section className="card">
            {/* The button already says how many are left while checking is required; say it once. */}
            {anyFlag || !settings.requireAllChecked || allDone ? (
              <p className="muted">
                {checkedUnits} of {totalUnits} units checked{anyFlag ? ` · ${Object.keys(progress.flags).length} line${Object.keys(progress.flags).length === 1 ? "" : "s"} flagged` : ""}
              </p>
            ) : null}
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
            {settings.allowShortPick && !anyFlag && !exception ? (
              <button className="btn ghost" type="button" onClick={() => setException(true)}>Can’t complete this order?</button>
            ) : null}
            {preview ? null : <a className="btn ghost" href="/scan">Scan another order</a>}
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
    <div className="problem">
      <div className="choices" role="group" aria-label="What happened">
        {(Object.keys(PROBLEM_LABEL) as Problem[]).map((p) => (
          <button key={p} type="button" className={`btn ${outcome === p ? "" : "secondary"}`} aria-pressed={outcome === p} onClick={() => setOutcome(p)}>
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
