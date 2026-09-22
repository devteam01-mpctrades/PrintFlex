import { useRef, useState } from "react";
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
import { canExportHistory, listHistory, OUTCOME_LABEL, packStats } from "../lib/pack/history.server";
import { loadBatchProgress } from "../lib/pack/pack.server";
import { downloadFile } from "../components/download";

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
  const [hasPin, devices, stats, history, recentJobs] = await Promise.all([
    hasStorePin(shop.id),
    listDevices(shop.id),
    packStats(shop.id, today),
    listHistory(shop.id, { limit: 50 }),
    prisma.documentJob.findMany({ where: { shopId: shop.id, state: { in: ["SUCCEEDED", "PRINTED_IN_FALLBACK"] } }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true } }),
  ]);
  const batches = (await Promise.all(recentJobs.map((j) => loadBatchProgress(shop.id, j.id)))).flatMap((b) => (b ? [b] : []));
  return {
    hasPin,
    packedToday: stats.packedToday,
    needsReview: stats.needsReview,
    devicesToday: stats.devicesToday,
    medianPackSeconds: stats.medianPackSeconds,
    canExport: canExportHistory(shop.plan),
    history: history.map((h) => ({ ...h, occurredAt: h.occurredAt.toISOString(), outcomeLabel: OUTCOME_LABEL[h.outcome] })),
    batches: batches.map((b) => ({ id: b.jobId, label: b.label, total: b.total, counts: b.counts })),
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
  const { hasPin, devices, timezone, scanUrl, packedToday, needsReview, devicesToday, pack, medianPackSeconds, canExport, history, batches } = useLoaderData<typeof loader>();
  const [exportError, setExportError] = useState<string | null>(null);
  const median = medianPackSeconds === null ? null : `${Math.floor(medianPackSeconds / 60)}:${String(Math.round(medianPackSeconds % 60)).padStart(2, "0")}`;
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
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
          <s-heading>{median ?? "—"}</s-heading>
          <s-paragraph color="subdued">From first scan to packed, today</s-paragraph>
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

      <s-section heading="Batch progress">
        {batches.length === 0 ? (
          <s-paragraph color="subdued">Print a batch and its progress appears here as staff pack it.</s-paragraph>
        ) : (
          <s-stack gap="base">
            {batches.map((b) => {
              const done = b.counts.packed + b.counts["needs-review"];
              return (
                <s-box key={b.id} padding="base" borderWidth="base" borderRadius="base">
                  <s-stack gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-link href={`/app/jobs/${b.id}`}>{b.label}</s-link>
                      <s-text color="subdued">{b.total} orders</s-text>
                    </s-stack>
                    <s-progress value={done} max={Math.max(1, b.total)}></s-progress>
                    <s-stack direction="inline" gap="base">
                      <s-badge tone="success">Packed {b.counts.packed}</s-badge>
                      <s-badge tone="info">In progress {b.counts["in-progress"]}</s-badge>
                      <s-badge tone="warning">Needs review {b.counts["needs-review"]}</s-badge>
                      <s-badge tone="neutral">Not started {b.counts["not-started"]}</s-badge>
                    </s-stack>
                  </s-stack>
                </s-box>
              );
            })}
            <s-paragraph color="subdued">Scan the batch cover sheet to open this view on any phone on the floor.</s-paragraph>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Scan history">
        {canExport ? (
          <s-button slot="primary-action" onClick={() => void downloadFile("/app/scan-pack/export", "printflex-scan-history.csv").then(setExportError)}>Export CSV</s-button>
        ) : (
          <s-button slot="primary-action" disabled>Export CSV</s-button>
        )}
        {exportError ? <s-banner tone="critical"><s-paragraph>{exportError}</s-paragraph></s-banner> : null}
        {!canExport ? <s-paragraph color="subdued">CSV export is included on Premium and Unlimited.</s-paragraph> : null}
        {history.length === 0 ? (
          <s-paragraph color="subdued">No scans yet. Staff sign in with a store PIN and a device name. No Shopify accounts, no staff seats used.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Time</s-table-header>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Device</s-table-header>
              <s-table-header listSlot="kicker">Outcome</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {history.map((h) => (
                <s-table-row key={h.id}>
                  <s-table-cell><s-text fontVariantNumeric="tabular-nums">{time(h.occurredAt)}</s-text></s-table-cell>
                  <s-table-cell><s-text type="strong" fontVariantNumeric="tabular-nums">{h.orderName}</s-text></s-table-cell>
                  <s-table-cell>{h.deviceName}{h.staffLabel ? ` · ${h.staffLabel}` : ""}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={h.outcome === "PACKED" ? "success" : h.outcome === "WRONG_ITEM" ? "critical" : "warning"}>{h.outcomeLabel}</s-badge>
                    {h.note ? <s-text color="subdued"> {h.note}</s-text> : null}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        <s-paragraph color="subdued">The last 90 days are kept.</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
