import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { Btn } from "../ui";

export interface DeviceItem {
  id: string;
  name: string;
  staffLabel: string | null;
  lastSeenAt: string;
  stale: boolean;
}

interface Props {
  hasPin: boolean;
  enrolUrl: string;
  /** Server-rendered SVG from the qrcode library. */
  qrSvg: string;
  devices: DeviceItem[];
  timezone: string;
  fetcher: FetcherWithComponents<{ ok: boolean; message: string }>;
}

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

/** Enrol a phone: one QR to scan, a link to fall back on, the PIN state, and who is signed in. */
export function StaffAccess({ hasPin, enrolUrl, qrSvg, devices, timezone, fetcher }: Props) {
  const [copied, setCopied] = useState(false);
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

  return (
    <div className="pf-panel">
      <div className="pf-panel__h"><h2>Staff access</h2></div>
      <div className="pf-panel__b">
      <s-stack gap="base">
        <s-stack direction="inline" gap="base" alignItems="start">
          <div className="pf-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <s-stack gap="small-200">
            <s-text type="strong">Enrol a phone</s-text>
            <s-text color="subdued">
              Open the camera on the phone and point it at this code. It asks for the store PIN once and a name for the device, then scan mode is ready.
              The code is valid for 24 hours; reload this page for a fresh one.
            </s-text>
          </s-stack>
        </s-stack>

        <s-stack gap="small-200">
          <s-text color="subdued">Camera will not cooperate? Send the link instead.</s-text>
          <s-stack direction="inline" gap="small" alignItems="center">
            <span className="pf-code" title={enrolUrl}>{displayUrl(enrolUrl)}</span>
            <Btn icon={copied ? "check" : "clipboard"} onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Btn>
          </s-stack>
        </s-stack>

        <s-divider></s-divider>

        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text type="strong">Store PIN</s-text>
            <s-badge tone={hasPin ? "success" : "critical"}>{hasPin ? "Set" : "Not set"}</s-badge>
          </s-stack>
          <s-link href="/app/settings">{hasPin ? "Rotate in Settings" : "Set it in Settings"}</s-link>
        </s-stack>

        <s-divider></s-divider>

        <s-stack gap="small-200">
          <s-text type="strong">Devices</s-text>
          {devices.length === 0 ? (
            <s-text color="subdued">No devices have signed in yet.</s-text>
          ) : (
            <s-stack gap="small-200">
              {devices.map((d) => (
                <s-stack key={d.id} direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                  <s-stack gap="none">
                    <s-text type="strong">{d.name}{d.staffLabel ? ` · ${d.staffLabel}` : ""}</s-text>
                    <s-text color="subdued">{d.stale ? "Signed out by PIN change · " : "Last seen "}{when(d.lastSeenAt)}</s-text>
                  </s-stack>
                  <Btn variant="tertiary" tone="critical" aria-label={`Revoke ${d.name}`} disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "revoke", deviceId: d.id }, { method: "post" })}>
                    Revoke
                  </Btn>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-stack>
      </div>
    </div>
  );
}
