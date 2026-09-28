import { useEffect, useState, type ReactNode } from "react";
import { queue, registerServiceWorker, startSyncLoop, syncQueue } from "./offline";

/**
 * Layout for scan mode. This runs outside the embedded admin on any phone,
 * so Polaris web components (which need App Bridge) are unavailable and the
 * page is plain HTML with one small stylesheet: large tap targets, high
 * contrast, no horizontal scroll.
 */

export const SCAN_CSS = `
  :root {
    --ink: #1c1917; --muted: #6b6560; --rule: #ece7e2; --bg: #f7f4f1; --card: #ffffff;
    --brand: #e25b07; --brand-dark: #c24e06; --brand-ink: #a84206; --brand-soft: #fdefe3; --brand-soft-2: #f9d9bc;
    --ok: #15803d; --ok-dark: #116b33; --ok-soft: #e8f7ee; --ok-rule: #b7ebc9;
    --warn: #b45309; --warn-soft: #fff7e6; --bad: #b91c1c; --bad-soft: #fdecec;
    --accent: var(--brand);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-text-size-adjust: 100%; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 0 14px 32px; }

  /* Header bar: brand on the left, who is signed in on the right */
  .top { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0 -14px 12px; padding: 10px 14px; background: rgba(255,255,255,.92); backdrop-filter: saturate(1.4) blur(8px); -webkit-backdrop-filter: saturate(1.4) blur(8px); border-bottom: 1px solid var(--rule); color: var(--muted); font-size: 13px; }
  .top strong { color: var(--ink); font-size: 15px; }
  .top .brand { display: inline-flex; align-items: center; gap: 9px; }
  .top .brand img { width: 22px; height: 22px; border-radius: 6px; }
  .who { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 999px; background: #f1ede9; color: var(--muted); font-size: 12.5px; font-weight: 600; white-space: nowrap; max-width: 52vw; overflow: hidden; text-overflow: ellipsis; }
  .who::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #b9b2ab; flex: 0 0 auto; }
  .who.on { background: var(--ok-soft); color: var(--ok-dark); }
  .who.on::before { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.18); }

  .card { background: var(--card); border: 1px solid var(--rule); border-radius: 16px; padding: 16px; box-shadow: 0 1px 2px rgba(28,25,23,.04), 0 6px 18px rgba(28,25,23,.05); margin-bottom: 12px; }
  h1 { font-size: 22px; line-height: 1.2; margin: 0 0 6px; letter-spacing: -0.015em; }
  h2 { font-size: 12px; margin: 0 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: .09em; font-weight: 700; }
  p { margin: 0 0 10px; }
  .muted { color: var(--muted); }
  .big { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; margin: 0; line-height: 1.1; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-top: 14px; }
  .meta div { border-top: 1px solid var(--rule); padding-top: 8px; }
  .meta .l { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .meta .v { font-size: 18px; font-weight: 600; }
  .meta .v.num { font-size: 26px; font-variant-numeric: tabular-nums; }

  label { display: block; font-weight: 700; font-size: 14px; margin: 12px 0 6px; }
  input, select { width: 100%; font: inherit; font-size: 17px; padding: 11px 14px; border: 1.5px solid #ddd5ce; border-radius: 12px; background: #fff; color: var(--ink); transition: border-color .15s, box-shadow .15s; }
  input::placeholder { color: #b3aba4; }
  input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 4px rgba(226,91,7,.16); }
  .btn:focus-visible, a:focus-visible, button:focus-visible, [role="button"]:focus-visible { outline: 3px solid rgba(226,91,7,.45); outline-offset: 2px; }
  input.pin { letter-spacing: .4em; text-align: center; font-size: 24px; font-weight: 700; }

  .btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; font: inherit; font-size: 16px; font-weight: 700; padding: 12px 14px; border-radius: 12px; border: 1.5px solid transparent; background: var(--brand); color: #fff; cursor: pointer; text-align: center; text-decoration: none; margin-top: 10px; min-height: 48px; box-shadow: 0 1px 0 rgba(0,0,0,.04), 0 4px 12px rgba(226,91,7,.22); transition: background-color .15s, transform .05s; -webkit-tap-highlight-color: transparent; }
  .btn:active { transform: translateY(1px); }
  .btn svg { width: 19px; height: 19px; flex: 0 0 auto; }
  .btn.go { background: var(--ok); box-shadow: 0 1px 0 rgba(0,0,0,.04), 0 4px 12px rgba(21,128,61,.25); }
  .btn.review { background: var(--warn); box-shadow: 0 4px 12px rgba(180,83,9,.22); }
  .btn.secondary { background: var(--brand-soft); color: var(--brand-ink); border-color: var(--brand-soft-2); box-shadow: none; }
  .btn.ghost { background: transparent; color: var(--muted); font-weight: 600; font-size: 14.5px; min-height: 44px; padding: 8px; box-shadow: none; }
  .btn:disabled { background: #efe7e0; color: #a39a92; border-color: transparent; box-shadow: none; cursor: default; opacity: 1; transform: none; }
  .chipbtn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--rule); background: #fff; color: var(--muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }

  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #f1ede9; color: var(--muted); }
  .badge.ok { background: var(--ok-soft); color: var(--ok-dark); } .badge.warn { background: #fef3c7; color: var(--warn); } .badge.info { background: #e0edff; color: #1d4ed8; }
  .notice { border-left: 4px solid var(--warn); background: var(--warn-soft); padding: 10px 12px; border-radius: 12px; margin-bottom: 14px; }
  .notice.bad { border-color: var(--bad); background: var(--bad-soft); }
  .notice.ok { border-color: var(--ok); background: var(--ok-soft); }
  .row { display: flex; gap: 10px; align-items: center; }
  .row > * { flex: 1 1 0; min-width: 0; }
  .problem { padding: 4px 0 0; }
  .choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .choices .btn { margin-top: 0; min-height: 44px; padding: 8px 6px; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  video { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; background: #111; border-radius: 16px; }
  .hint { font-size: 13px; color: var(--muted); margin-top: 8px; }
  .list { list-style: none; padding: 0; margin: 0; }
  .list li { padding: 12px 0; border-top: 1px solid var(--rule); }
  .list li:first-child { border-top: 0; }
  .list a { color: var(--ink); text-decoration: none; font-weight: 600; font-size: 16px; }
  .pending { display: inline-flex; gap: 6px; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #fef3c7; color: var(--warn); }
  .pending.offline { background: #fee2e2; color: var(--bad); }
  .pending.synced { background: #d1fae5; color: var(--ok); }

  /* Welcome (not signed in): icon, heading, numbered steps */
  .hero { text-align: center; padding: 22px 18px 18px; }
  .hero .icon { width: 60px; height: 60px; margin: 0 auto 12px; border-radius: 18px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); }
  .hero .icon svg { width: 32px; height: 32px; }
  .hero .icon.ok { background: var(--ok-soft); color: var(--ok); border-radius: 50%; }
  .hero p { color: var(--muted); }
  .steps { list-style: none; margin: 14px 0 4px; padding: 0; display: grid; gap: 8px; text-align: left; counter-reset: step; }
  .steps li { counter-increment: step; display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 12px; background: #faf7f4; border: 1px solid var(--rule); font-size: 14.5px; }
  .steps li::before { content: counter(step); flex: 0 0 26px; height: 26px; border-radius: 50%; background: var(--brand); color: #fff; font-weight: 800; font-size: 13px; display: grid; place-items: center; }
  .fine { font-size: 13px; color: var(--muted); margin: 12px 0 0; }

  /* "or" divider between camera and typing */
  .or { display: flex; align-items: center; gap: 10px; margin: 14px 0 2px; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  .or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--rule); }
  .storechip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; background: var(--brand-soft); color: var(--brand-ink); font-size: 12px; font-weight: 700; margin-bottom: 4px; }

  /* Order header chips */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chips span { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; background: #f4f0ec; color: #4a4540; font-size: 12.5px; font-weight: 600; }

  /* Pack checklist */
  .items { padding: 6px; }
  .items .list li { border-top: 0; padding: 0; margin-bottom: 6px; }
  .items .list li:last-child { margin-bottom: 0; }
  .item { display: flex; gap: 12px; align-items: center; padding: 10px; min-height: 68px; border-radius: 12px; border: 1.5px solid var(--rule); background: #fff; cursor: pointer; transition: background-color .15s, border-color .15s; -webkit-tap-highlight-color: transparent; }
  .item.done { background: var(--ok-soft); border-color: var(--ok-rule); }
  .item.flag { background: var(--warn-soft); border-color: #f5d49a; }
  .item.locked { cursor: default; }
  .item img { width: 50px; height: 50px; border-radius: 10px; object-fit: cover; flex: 0 0 auto; background: #eee; }
  .item .body { flex: 1; min-width: 0; }
  .item .title { font-weight: 700; font-size: 15px; line-height: 1.25; }
  .item .sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .item .problemtxt { font-size: 12.5px; color: var(--warn); font-weight: 700; margin-top: 4px; }
  .count { flex: 0 0 auto; min-width: 50px; height: 34px; padding: 0 9px; border-radius: 999px; display: grid; place-items: center; font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; background: #f4f0ec; color: var(--ink); }
  .item.done .count { background: var(--ok); color: #fff; min-width: 34px; width: 34px; padding: 0; }
  .item.done .count svg { width: 18px; height: 18px; }
  .itemtools { display: flex; gap: 8px; justify-content: flex-end; padding: 6px 4px 2px; }
  .more { padding: 10px 12px; color: var(--muted); }

  /* Progress summary above the pack button */
  .progress { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; font-weight: 700; margin-bottom: 8px; }
  .progress .muted { font-weight: 600; font-size: 13px; }
  .bar { height: 8px; border-radius: 999px; background: #f1ebe5; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: inherit; background: var(--brand); transition: width .25s; }
  .bar.full i { background: var(--ok); }

  /* Strict-mode mismatch */
  .card.mismatch { background: var(--bad-soft); border-color: var(--bad); box-shadow: 0 0 0 3px rgba(185,28,28,.25); }

  /* Item avatars when Shopify has no product photo: initials on a colour derived from the title. */
  .avatar { width: 50px; height: 50px; border-radius: 10px; flex: 0 0 auto; display: grid; place-items: center; font-weight: 700; font-size: 13px; color: #fff; letter-spacing: .02em; }

  /* Preview mode (the merchant's phone frame in the admin): the scanner header stands in for the camera. */
  .preview .wrap { padding: 0 14px 14px; }
  .scanhead { background: #161616; color: #b8b8b8; padding: 22px 16px 14px; margin: 0 -14px 14px; text-align: center; }
  .scanhead .vf { position: relative; width: 104px; height: 104px; margin: 0 auto 12px; display: grid; place-items: center; }
  .scanhead .vf::before, .scanhead .vf::after, .scanhead .vf i::before, .scanhead .vf i::after { content: ""; position: absolute; width: 22px; height: 22px; border: 3px solid var(--brand, #e25b07); }
  .scanhead .vf::before { top: 0; left: 0; border-right: 0; border-bottom: 0; border-radius: 6px 0 0 0; }
  .scanhead .vf::after { top: 0; right: 0; border-left: 0; border-bottom: 0; border-radius: 0 6px 0 0; }
  .scanhead .vf i::before { bottom: 0; left: 0; border-right: 0; border-top: 0; border-radius: 0 0 0 6px; }
  .scanhead .vf i::after { bottom: 0; right: 0; border-left: 0; border-top: 0; border-radius: 0 0 6px 0; }
  .scanhead .vf svg { width: 64px; height: 64px; }
  .scanhead .cap { font-family: ui-monospace, Menlo, monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
  .preview .card { padding: 14px; border-radius: 14px; margin-bottom: 10px; }
  .preview .items { padding: 6px; }
  .preview .big { font-size: 22px; }
  .preview .muted { font-size: 14px; }
  .preview .item { min-height: 52px; padding: 8px; gap: 10px; border-radius: 12px; }
  .preview .item img, .preview .avatar { width: 38px; height: 38px; font-size: 12px; border-radius: 9px; }
  .preview .item .title { font-size: 15px; }
  .preview .count { font-size: 14px; min-width: 44px; height: 30px; }
  .preview .item.done .count { width: 30px; min-width: 30px; }
  .preview .chips span { font-size: 12.5px; padding: 3px 9px; }
  .preview .btn { min-height: 46px; font-size: 15px; padding: 12px; border-radius: 12px; }
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
          <strong className="brand"><img src="/logo.svg" alt="" width="26" height="26" />PrintFlex scan</strong>
          <span className="row" style={{ gap: 8 }}>
            {status.pending > 0 ? (
              <button type="button" className={`pending ${status.online ? "" : "offline"}`} onClick={() => void syncQueue()} style={{ border: 0, font: "inherit", cursor: "pointer" }}>
                {status.online ? `${status.pending} pending sync` : `Offline · ${status.pending} pending`}
              </button>
            ) : !status.online ? (
              <span className="pending offline">Offline · checklist still works</span>
            ) : null}
            <span className={`who${device ? " on" : ""}`}>{device ?? title}</span>
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
