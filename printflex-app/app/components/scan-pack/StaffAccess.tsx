import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { Btn } from "../ui";
import { DeviceLabel } from "./DeviceAvatar";

export interface DeviceItem {
  id: string;
  name: string;
  staffLabel: string | null;
  lastSeenAt: string;
  stale: boolean;
}

interface Props {
  enrolUrl: string;
  /** Server-rendered SVG from the qrcode library. */
  qrSvg: string;
  devices: DeviceItem[];
  timezone: string;
  fetcher: FetcherWithComponents<{ ok: boolean; message: string }>;
  /** Once staff are scanning, enrolment folds away behind a header button. */
  collapsible?: boolean;
}

/** Seen in the last 15 minutes counts as on the floor right now. */
const ACTIVE_MS = 15 * 60_000;

/** "host/scan/AbCd…wxyz": the host stays whole, the token is shortened in the middle. */
function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const token = parts.pop() ?? "";
    const shortToken = token.length > 12 ? `${token.slice(0, 5)}…${token.slice(-4)}` : token;
    return `${u.host}${parts.join("/")}/${shortToken}`;
  } catch {
    return url;
  }
}

function relative(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Enrol a phone: one QR to scan, a link to fall back on, and who is signed in. (The PIN lives in Settings.) */
export function StaffAccess({ enrolUrl, qrSvg, devices, timezone, fetcher, collapsible = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [showEnrol, setShowEnrol] = useState(!collapsible);
  const busy = fetcher.state !== "idle";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(enrolUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", enrolUrl);
    }
  };
  const when = (iso: string) =>
    `${relative(iso)} · ${new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))}`;
  const status = (d: DeviceItem) =>
    d.stale
      ? { cls: "pf-b-warn", label: "Signed out by PIN change", title: "Sign in again on this phone with the new PIN" }
      : Date.now() - Date.parse(d.lastSeenAt) < ACTIVE_MS
        ? { cls: "pf-b-ok", label: "Active", title: "Seen in the last 15 minutes" }
        : { cls: "pf-b-neu", label: "Idle", title: "Not seen in the last 15 minutes" };

  return (
    <div className="pf-panel">
      <div className="pf-panel__h">
        <h2>Staff access</h2>
        <span className="pf-badge pf-b-brand">{devices.length} {devices.length === 1 ? "device" : "devices"}</span>
        {collapsible ? (
          <div className="right">
            <Btn variant={showEnrol ? "tertiary" : "secondary"} icon={showEnrol ? "chevron-up" : "plus"} onClick={() => setShowEnrol((v) => !v)}>
              {showEnrol ? "Hide" : "Enrol a phone"}
            </Btn>
          </div>
        ) : null}
      </div>

      {showEnrol ? (
        <div className="pf-panel__b">
          <div className="pf-enrol">
            <div className="pf-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div className="pf-enrol__body">
              <h3>Enrol a phone</h3>
              <ol className="pf-steps">
                <li>Open the camera on the phone and point it at this code.</li>
                <li>Enter the store PIN and give the device a name.</li>
                <li>Scan mode is ready. No app to install, no Shopify account.</li>
              </ol>
              <p className="pf-enrol__note">The code is valid for 24 hours; reload this page for a fresh one.</p>
            </div>
          </div>
          <div className="pf-enrol__link">
            <span className="pf-enrol__hint">Camera will not cooperate? Send the link instead.</span>
            <div className="pf-kv">
              <span className="pf-code" title={enrolUrl}>{displayUrl(enrolUrl)}</span>
              <Btn icon={copied ? "check" : "clipboard"} onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Btn>
            </div>
          </div>
        </div>
      ) : null}

      {devices.length === 0 ? (
        <div className="pf-panel__empty">
          <strong>No devices yet</strong>
          Scan the code above with a phone to sign in the first one.
        </div>
      ) : (
        <ul className="pf-devices">
          {devices.map((d) => {
            const st = status(d);
            return (
              <li key={d.id}>
                <DeviceLabel name={d.name} staffLabel={d.staffLabel} />
                <span className="pf-devices__seen" title={`Last seen ${when(d.lastSeenAt)}`}>Last seen {relative(d.lastSeenAt)}</span>
                <span className={`pf-badge ${st.cls}`} title={st.title}>{st.label}</span>
                <Btn variant="tertiary" className="pf-btn--revoke" aria-label={`Revoke ${d.name}`} disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "revoke", deviceId: d.id }, { method: "post" })}>
                  Revoke
                </Btn>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
