import { useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useNativeEvent } from "../components/orders/useNativeEvent";
import prisma from "../db.server";
import { zonedDayStart } from "../lib/period.server";
import { requireShop } from "../lib/request.server";
import { listDevices, revokeDevice } from "../lib/scan/devices.server";
import { hasStorePin, setStorePin } from "../lib/scan/pin.server";
import { parseSettings, updateShopSettings, type PackSettings } from "../lib/settings.server";

const PACK_TOGGLES: Array<{ key: keyof PackSettings; label: string; details: string }> = [
  { key: "requireAllChecked", label: "Require every item to be checked", details: "Mark as packed stays disabled until every line is complete or flagged." },
  { key: "showPhotos", label: "Show product photos on the pack screen", details: "Photos come from Shopify, so new packers still fill the right box." },
  { key: "strictMode", label: "Strict mode: scan each product barcode", details: "Tapping is disabled; a wrong scan shows a loud mismatch." },
  { key: "askWeight", label: "Ask for parcel weight when packing", details: "Written to the order as a metafield." },
  { key: "allowShortPick", label: "Allow short-pick and damage reports", details: "Staff can flag a line they cannot complete. The order goes to Needs review, never to Packed." },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const today = zonedDayStart(new Intl.DateTimeFormat("en-CA", { timeZone: shop.timezone }).format(new Date()), shop.timezone);
  const [hasPin, devices, packedToday, needsReview, devicesToday] = await Promise.all([
    hasStorePin(shop.id),
    listDevices(shop.id),
    prisma.packEvent.count({ where: { shopId: shop.id, outcome: "PACKED", occurredAt: { gte: today } } }),
    prisma.orderIndex.count({ where: { shopId: shop.id, documentStatus: "NEEDS_REVIEW" } }),
    prisma.packEvent.findMany({ where: { shopId: shop.id, occurredAt: { gte: today } }, distinct: ["deviceName"], select: { deviceName: true } }),
  ]);
  return {
    hasPin,
    packedToday,
    needsReview,
    devicesToday: devicesToday.length,
    pack: parseSettings(shop.settingsJson).pack,
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
  if (intent === "pack") {
    await updateShopSettings(prisma, shop.id, (current) => ({
      ...current,
      pack: {
        requireAllChecked: form.get("requireAllChecked") === "on",
        showPhotos: form.get("showPhotos") === "on",
        strictMode: form.get("strictMode") === "on",
        askWeight: form.get("askWeight") === "on",
        allowShortPick: form.get("allowShortPick") === "on",
      },
    }));
    return { ok: true, message: "Pack behaviour saved. Devices pick it up on their next scan." };
  }
  if (intent === "revoke") {
    const revoked = await revokeDevice(shop.id, String(form.get("deviceId") ?? ""));
    return revoked ? { ok: true, message: "Device removed. It will be asked for the PIN next time." } : { ok: false, message: "That device was already removed." };
  }
  return { ok: false, message: "Unknown action." };
};

export default function ScanPackPage() {
  const { hasPin, devices, timezone, scanUrl, packedToday, needsReview, devicesToday, pack } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const pinRef = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const packFormRef = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";
  useNativeEvent(packFormRef, "change", () => {
    if (!packFormRef.current) return;
    const form = new FormData(packFormRef.current);
    form.set("intent", "pack");
    fetcher.submit(form, { method: "post" });
  });
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
          <s-heading>{packedToday}</s-heading>
          <s-paragraph color="subdued">Across {devicesToday} {devicesToday === 1 ? "device" : "devices"}</s-paragraph>
        </s-section>
        <s-section heading="Median time per parcel">
          <s-paragraph color="subdued">Arrives with scan history.</s-paragraph>
        </s-section>
        <s-section heading="Needs review">
          <s-heading>{needsReview}</s-heading>
          <s-paragraph color="subdued">Short-picked or damaged, flagged by staff, not discovered by a customer.</s-paragraph>
          {needsReview > 0 ? <s-link href="/app/orders?docStatus=NEEDS_REVIEW">Open the Needs review view</s-link> : null}
        </s-section>
      </s-grid>

      <s-section heading="Pack behaviour">
        <form ref={packFormRef} onSubmit={(e) => e.preventDefault()}>
          <s-stack gap="small">
            {PACK_TOGGLES.map((t) => (
              <s-switch key={t.key} name={t.key} value="on" checked={pack[t.key] || undefined} label={t.label} details={t.details}></s-switch>
            ))}
          </s-stack>
        </form>
      </s-section>

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
