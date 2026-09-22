import { useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/request.server";
import { listDevices, revokeDevice } from "../lib/scan/devices.server";
import { hasStorePin, setStorePin } from "../lib/scan/pin.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const [hasPin, devices] = await Promise.all([hasStorePin(shop.id), listDevices(shop.id)]);
  return {
    hasPin,
    timezone: shop.timezone,
    scanUrl: `${(process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "")}/scan`,
    devices: devices.map((d) => ({ ...d, lastSeenAt: d.lastSeenAt.toISOString(), createdAt: d.createdAt.toISOString() })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "setPin") {
    const result = await setStorePin(shop.id, String(form.get("pin") ?? "").trim());
    if (!result.ok) return { ok: false, message: "The PIN must be 4 to 8 digits." };
    return { ok: true, message: "PIN saved. Every device must sign in again with the new PIN." };
  }
  if (intent === "revoke") {
    const revoked = await revokeDevice(shop.id, String(form.get("deviceId") ?? ""));
    return revoked ? { ok: true, message: "Device removed. It will be asked for the PIN next time." } : { ok: false, message: "That device was already removed." };
  }
  return { ok: false, message: "Unknown action." };
};

export default function ScanPackPage() {
  const { hasPin, devices, timezone, scanUrl } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const pinRef = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const busy = fetcher.state !== "idle";
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <s-page heading="Scan & pack">
      {fetcher.data && !busy ? (
        <s-banner tone={fetcher.data.ok ? "success" : "critical"}><s-paragraph>{fetcher.data.message}</s-paragraph></s-banner>
      ) : null}

      {!hasPin ? (
        <s-banner tone="warning" heading="Set a store PIN to open scan mode">
          <s-paragraph>Staff sign in on their phone with this PIN and a device name. Nobody needs a Shopify account.</s-paragraph>
        </s-banner>
      ) : null}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        <s-section heading="Packed today">
          <s-paragraph color="subdued">Arrives with the pack checklist.</s-paragraph>
        </s-section>
        <s-section heading="Median time per parcel">
          <s-paragraph color="subdued">Arrives with the pack checklist.</s-paragraph>
        </s-section>
        <s-section heading="Needs review">
          <s-paragraph color="subdued">Short-picked or damaged, flagged by staff, not discovered by a customer.</s-paragraph>
        </s-section>
      </s-grid>

      <s-section heading="Staff access">
        <s-stack gap="base">
          <s-paragraph>
            Scan mode lives at <s-link href={scanUrl} target="_blank">{scanUrl}</s-link>. Staff reach it by scanning the QR on any printed sheet,
            then sign in with the store PIN and a device name. Changing the PIN signs every device out.
          </s-paragraph>
          <s-stack direction="inline" gap="small" alignItems="end">
            <s-text-field ref={pinRef} label={hasPin ? "New store PIN" : "Store PIN"} placeholder="4 to 8 digits"></s-text-field>
            <s-button
              variant="primary"
              disabled={busy || undefined}
              onClick={() => fetcher.submit({ intent: "setPin", pin: pinRef.current?.value ?? "" }, { method: "post" })}
            >
              {hasPin ? "Rotate PIN" : "Set PIN"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Devices">
        {devices.length === 0 ? (
          <s-paragraph color="subdued">No device has signed in yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Device</s-table-header>
              <s-table-header>Last seen</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {devices.map((d) => (
                <s-table-row key={d.id}>
                  <s-table-cell>{d.name}</s-table-cell>
                  <s-table-cell>{when(d.lastSeenAt)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={d.stale ? "warning" : "success"}>{d.stale ? "Must sign in again" : "Active"}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button variant="tertiary" tone="critical" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "revoke", deviceId: d.id }, { method: "post" })}>
                      Revoke
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Batch progress and scan history">
        <s-paragraph color="subdued">Arrive with the pack checklist and offline sync in later updates.</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
