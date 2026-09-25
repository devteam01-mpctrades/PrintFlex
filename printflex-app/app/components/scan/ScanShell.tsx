import { useEffect, useState, type ReactNode } from "react";
import { queue, registerServiceWorker, startSyncLoop, syncQueue } from "./offline";

/**
 * Layout for scan mode. This runs outside the embedded admin on any phone,
 * so Polaris web components (which need App Bridge) are unavailable and the
 * page is plain HTML with one small stylesheet: large tap targets, high
 * contrast, no horizontal scroll.
 */

export const SCAN_CSS = `
  :root { --ink: #111827; --muted: #6b7280; --rule: #e5e7eb; --accent: #1f2937; --ok: #047857; --warn: #b45309; --bad: #b91c1c; --bg: #f3f4f6; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font: 17px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-text-size-adjust: 100%; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 16px 16px 40px; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 4px 0 12px; color: var(--muted); font-size: 14px; }
  .top strong { color: var(--ink); font-size: 16px; }
  .card { background: white; border-radius: 14px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 14px; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 0 0 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 600; }
  p { margin: 0 0 12px; }
  .muted { color: var(--muted); }
  .big { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; margin: 0; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-top: 14px; }
  .meta div { border-top: 1px solid var(--rule); padding-top: 8px; }
  .meta .l { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .meta .v { font-size: 18px; font-weight: 600; }
  .meta .v.num { font-size: 26px; font-variant-numeric: tabular-nums; }
  label { display: block; font-weight: 600; margin: 12px 0 6px; }
  input, select { width: 100%; font: inherit; font-size: 20px; padding: 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; background: white; color: var(--ink); }
  input:focus { outline: 3px solid #93c5fd; outline-offset: 1px; border-color: #3b82f6; }
  .btn:focus-visible, a:focus-visible, button:focus-visible, [role="button"]:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
  input.pin { letter-spacing: .3em; text-align: center; font-size: 28px; }
  .btn { display: block; width: 100%; font: inherit; font-size: 18px; font-weight: 700; padding: 16px; border-radius: 12px; border: 0; background: var(--accent); color: white; cursor: pointer; text-align: center; text-decoration: none; margin-top: 12px; min-height: 56px; }
  .btn.secondary { background: white; color: var(--ink); border: 1.5px solid #cbd5e1; }
  .btn.ghost { background: transparent; color: var(--muted); font-weight: 500; min-height: 44px; padding: 10px; }
  .btn:disabled { opacity: .5; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #e5e7eb; }
  .badge.ok { background: #d1fae5; color: var(--ok); } .badge.warn { background: #fef3c7; color: var(--warn); } .badge.info { background: #dbeafe; color: #1d4ed8; }
  .notice { border-left: 4px solid var(--warn); background: #fffbeb; padding: 12px 14px; border-radius: 8px; margin-bottom: 14px; }
  .notice.bad { border-color: var(--bad); background: #fef2f2; }
  .notice.ok { border-color: var(--ok); background: #ecfdf5; }
  .row { display: flex; gap: 10px; align-items: center; }
  .row > * { flex: 1 1 0; min-width: 0; }
  .problem { padding: 4px 0 0; }
  .choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .choices .btn { margin-top: 0; min-height: 48px; padding: 10px 6px; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  video { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; background: #111; border-radius: 12px; }
  .hint { font-size: 14px; color: var(--muted); margin-top: 8px; }
  .list { list-style: none; padding: 0; margin: 0; }
  .list li { padding: 12px 0; border-top: 1px solid var(--rule); }
  .list a { color: var(--ink); text-decoration: none; font-weight: 600; font-size: 18px; }
  .pending { display: inline-flex; gap: 6px; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #fef3c7; color: var(--warn); }
  .pending.offline { background: #fee2e2; color: var(--bad); }
  .pending.synced { background: #d1fae5; color: var(--ok); }

  /* Item avatars when Shopify has no product photo: initials on a colour derived from the title. */
  .avatar { width: 56px; height: 56px; border-radius: 8px; flex: 0 0 auto; display: grid; place-items: center; font-weight: 700; font-size: 15px; color: #fff; letter-spacing: .02em; }

  /* Preview mode (the merchant's phone frame in the admin): the scanner header stands in for the camera. */
  .preview .wrap { padding: 0 14px 14px; }
  .top .brand { display: inline-flex; align-items: center; gap: 8px; }
  .top .brand img { width: 22px; height: 22px; border-radius: 6px; }
  .scanhead { background: #161616; color: #b8b8b8; padding: 22px 16px 14px; margin: 0 -14px 14px; text-align: center; }
  .scanhead .vf { position: relative; width: 104px; height: 104px; margin: 0 auto 12px; display: grid; place-items: center; }
  .scanhead .vf::before, .scanhead .vf::after, .scanhead .vf i::before, .scanhead .vf i::after { content: ""; position: absolute; width: 22px; height: 22px; border: 3px solid var(--brand, #e25b07); }
  .scanhead .vf::before { top: 0; left: 0; border-right: 0; border-bottom: 0; border-radius: 6px 0 0 0; }
  .scanhead .vf::after { top: 0; right: 0; border-left: 0; border-bottom: 0; border-radius: 0 6px 0 0; }
  .scanhead .vf i::before { bottom: 0; left: 0; border-right: 0; border-top: 0; border-radius: 0 0 0 6px; }
  .scanhead .vf i::after { bottom: 0; right: 0; border-left: 0; border-top: 0; border-radius: 0 0 6px 0; }
  .scanhead .vf svg { width: 64px; height: 64px; }
  .scanhead .cap { font-family: ui-monospace, Menlo, monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
  .preview .card { padding: 14px; border-radius: 12px; margin-bottom: 10px; }
  .preview .big { font-size: 22px; }
  .preview .muted { font-size: 14px; }
  .preview .list li > div { min-height: 52px !important; padding: 8px 6px !important; gap: 10px !important; }
  .preview .list img, .preview .avatar { width: 38px; height: 38px; font-size: 12px; }
  .preview .list .title { font-size: 15px !important; }
  .preview .list .count { font-size: 15px !important; font-weight: 600 !important; min-width: 40px !important; color: var(--muted) !important; }
  .preview .btn { min-height: 46px; font-size: 15px; padding: 12px; border-radius: 10px; }
  .preview .btn:disabled { background: #d9d9d9; color: #6b6b6b; opacity: 1; }
  .preview .choices { gap: 6px; }
  .preview .choices .btn { min-height: 40px; font-size: 13px; padding: 8px 4px; }
  .preview label { font-size: 14px; margin: 10px 0 5px; }
  .preview input { font-size: 15px; padding: 10px 12px; }
`;

const SCAN_HEAD = (
  <div className="scanhead" aria-hidden="true">
    <div className="vf">
      <i />
      <svg viewBox="0 0 64 64" fill="#fff" role="img" aria-label="QR code">
        <rect x="4" y="4" width="20" height="20" rx="2" /><rect x="9" y="9" width="10" height="10" fill="#161616" /><rect x="12" y="12" width="4" height="4" />
        <rect x="40" y="4" width="20" height="20" rx="2" /><rect x="45" y="9" width="10" height="10" fill="#161616" /><rect x="48" y="12" width="4" height="4" />
        <rect x="4" y="40" width="20" height="20" rx="2" /><rect x="9" y="45" width="10" height="10" fill="#161616" /><rect x="12" y="48" width="4" height="4" />
        <rect x="30" y="4" width="4" height="4" /><rect x="30" y="12" width="4" height="8" /><rect x="4" y="30" width="8" height="4" /><rect x="16" y="30" width="4" height="4" />
        <rect x="24" y="24" width="4" height="4" /><rect x="30" y="28" width="8" height="4" /><rect x="40" y="30" width="4" height="8" /><rect x="48" y="30" width="12" height="4" />
        <rect x="30" y="40" width="4" height="8" /><rect x="38" y="40" width="8" height="4" /><rect x="50" y="40" width="4" height="4" /><rect x="58" y="40" width="2" height="8" />
        <rect x="30" y="52" width="8" height="4" /><rect x="42" y="48" width="4" height="12" /><rect x="50" y="50" width="10" height="4" /><rect x="50" y="56" width="4" height="4" />
      </svg>
    </div>
    <div className="cap">Point at the QR or barcode</div>
  </div>
);

interface Props {
  title: string;
  device?: string | null;
  children: ReactNode;
  /** Embedded in the admin as a preview: no service worker, no sync loop. */
  preview?: boolean;
}

export function ScanShell({ title, device, children, preview = false }: Props) {
  const status = useConnectivity(preview);
  if (preview) {
    return (
      <div className="preview">
        <style dangerouslySetInnerHTML={{ __html: `${SCAN_CSS} html { scrollbar-width: none; } html::-webkit-scrollbar { display: none; }` }} />
        <main className="wrap">
          {SCAN_HEAD}
          {children}
        </main>
      </div>
    );
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SCAN_CSS }} />
      <main className="wrap">
        <div className="top">
          <strong className="brand"><img src="/logo.svg" alt="" width="22" height="22" />PrintFlex scan</strong>
          <span className="row" style={{ gap: 8 }}>
            {status.pending > 0 ? (
              <button type="button" className={`pending ${status.online ? "" : "offline"}`} onClick={() => void syncQueue()} style={{ border: 0, font: "inherit", cursor: "pointer" }}>
                {status.online ? `${status.pending} pending sync` : `Offline · ${status.pending} pending`}
              </button>
            ) : !status.online ? (
              <span className="pending offline">Offline · checklist still works</span>
            ) : null}
            <span>{device ? `Device: ${device}` : title}</span>
          </span>
        </div>
        {children}
      </main>
    </>
  );
}

/** Live connectivity and queue size, shared by every scan page. */
export function useConnectivity(disabled = false): { online: boolean; pending: number } {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (disabled) return;
    registerServiceWorker();
    const update = () => {
      setOnline(navigator.onLine);
      setPending(queue().length);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("pf:queue", update);
    const stop = startSyncLoop();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("pf:queue", update);
      stop();
    };
  }, [disabled]);
  return { online, pending };
}
