import type { ReactNode } from "react";

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
  .row > * { flex: 1; }
  video { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; background: #111; border-radius: 12px; }
  .hint { font-size: 14px; color: var(--muted); margin-top: 8px; }
  .list { list-style: none; padding: 0; margin: 0; }
  .list li { padding: 12px 0; border-top: 1px solid var(--rule); }
  .list a { color: var(--ink); text-decoration: none; font-weight: 600; font-size: 18px; }
`;

interface Props {
  title: string;
  device?: string | null;
  children: ReactNode;
}

export function ScanShell({ title, device, children }: Props) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SCAN_CSS }} />
      <main className="wrap">
        <div className="top">
          <strong>PrintFlex scan</strong>
          <span>{device ? `Device: ${device}` : title}</span>
        </div>
        {children}
      </main>
    </>
  );
}
