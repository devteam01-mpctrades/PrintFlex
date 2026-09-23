import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import { BatchProgress } from "../components/scan-pack/BatchProgress";
import { PackerPreview } from "../components/scan-pack/PackerPreview";
import { ScanHistory } from "../components/scan-pack/ScanHistory";
import { StaffAccess } from "../components/scan-pack/StaffAccess";
import { StatCards } from "../components/scan-pack/StatCards";
import prisma from "../db.server";
import { canExportHistory, listHistory, packStats } from "../lib/pack/history.server";
import { loadBatchProgress } from "../lib/pack/pack.server";
import { zonedDayStart } from "../lib/period.server";
import { getPlan } from "../lib/plans.server";
import { qrSvgPx } from "../lib/render/codes.server";
import { requireShop } from "../lib/request.server";
import { listDevices, revokeDevice } from "../lib/scan/devices.server";
import { hasStorePin } from "../lib/scan/pin.server";
import { mintEnrolToken, mintPreviewToken, scanUrl } from "../lib/scan/tokens.server";
import scanPackStyles from "../styles/scan-pack.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: scanPackStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const now = new Date();
  const today = zonedDayStart(new Intl.DateTimeFormat("en-CA", { timeZone: shop.timezone }).format(now), shop.timezone);
  const [hasPin, devices, stats, history, eventCount, latestJob, enrol, previewToken] = await Promise.all([
    hasStorePin(shop.id),
    listDevices(shop.id),
    packStats(shop.id, today, now),
    listHistory(shop.id, { limit: 50, now }),
    prisma.packEvent.count({ where: { shopId: shop.id } }),
    prisma.documentJob.findFirst({ where: { shopId: shop.id, state: { in: ["SUCCEEDED", "PRINTED_IN_FALLBACK"] } }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    mintEnrolToken(shop.id, now),
    mintPreviewToken(shop.id, now),
  ]);
  const batch = latestJob ? await loadBatchProgress(shop.id, latestJob.id) : null;
  const enrolUrl = scanUrl(enrol.token);
  const hasOrders = (await prisma.orderIndex.count({ where: { shopId: shop.id } })) > 0;

  return {
    hasPin,
    /**
     * Running once a PIN is set, a device has enrolled and a scan event exists.
     * Derived from those rows every load; there is no switch a merchant can flip.
     */
    running: hasPin && devices.length > 0 && eventCount > 0,
    devices: devices.map((d) => ({ id: d.id, name: d.name, staffLabel: d.staffLabel, lastSeenAt: d.lastSeenAt.toISOString(), stale: d.stale })),
    packedToday: stats.packedToday,
    devicesToday: stats.devicesToday,
    needsReview: stats.needsReview,
    medianPackSeconds: stats.medianPackSeconds,
    canExport: canExportHistory(shop.plan),
    planName: getPlan(shop.plan).name,
    history: history.map((h) => ({
      id: h.id,
      occurredAt: h.occurredAt.toISOString(),
      orderName: h.orderName,
      shopifyOrderNumber: h.shopifyOrderNumber,
      deviceName: h.deviceName,
      staffLabel: h.staffLabel,
      outcome: h.outcome,
      note: h.note,
    })),
    batch: batch ? { id: batch.jobId, label: batch.label, total: batch.total, counts: batch.counts } : null,
    timezone: shop.timezone,
    enrolUrl,
    qrSvg: await qrSvgPx(enrolUrl, 148),
    previewSrc: `/scan/preview/${previewToken}`,
    previewIsSample: !hasOrders,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  if (form.get("intent") === "revoke") {
    const revoked = await revokeDevice(shop.id, String(form.get("deviceId") ?? ""));
    return revoked
      ? { ok: true, message: "Device removed. It will be asked for the PIN next time." }
      : { ok: false, message: "That device was already removed." };
  }
  return { ok: false, message: "Unknown action." };
};

export default function ScanPackPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [showEnrol, setShowEnrol] = useState(false);
  const median =
    data.medianPackSeconds === null
      ? null
      : `${Math.floor(data.medianPackSeconds / 60)}:${String(Math.round(data.medianPackSeconds % 60)).padStart(2, "0")}`;

  const stats = <StatCards packedToday={data.packedToday} devicesToday={data.devicesToday} medianLabel={median} needsReview={data.needsReview} />;
  const staffAccess = <StaffAccess hasPin={data.hasPin} enrolUrl={data.enrolUrl} qrSvg={data.qrSvg} devices={data.devices} timezone={data.timezone} fetcher={fetcher} />;
  const packerPreview = <PackerPreview src={data.previewSrc} sample={data.previewIsSample} />;
  const batchProgress = <BatchProgress batch={data.batch} />;
  const scanHistory = <ScanHistory history={data.history} timezone={data.timezone} canExport={data.canExport} planName={data.planName} />;

  return (
    <s-page heading="Scan & pack" inlineSize="large">
      {!data.hasPin ? (
        <s-banner tone="warning">
          <s-stack gap="small-200">
            <s-text type="strong">Set a store PIN to open scan mode</s-text>
            <s-paragraph>Staff sign in on their phone with this PIN and a device name. Nobody needs a Shopify account.</s-paragraph>
          </s-stack>
          <s-button slot="secondary-actions" href="/app/settings">Set the PIN in Settings</s-button>
        </s-banner>
      ) : null}
      {fetcher.data && fetcher.state === "idle" ? (
        <s-banner tone={fetcher.data.ok ? "success" : "critical"}><s-paragraph>{fetcher.data.message}</s-paragraph></s-banner>
      ) : null}

      <div className="pf-scan">
        {stats}

        {data.running ? (
          <div className="pf-scan-grid">
            <div className="pf-scan-col">
              {batchProgress}
              {scanHistory}
              <div className="pf-panel">
                <div className="pf-panel__h">
                  <h2>Enrol another phone</h2>
                  <div className="right">
                    <s-button variant="tertiary" icon={showEnrol ? "chevron-up" : "chevron-down"} onClick={() => setShowEnrol((v) => !v)}>
                      {showEnrol ? "Hide" : "Show"}
                    </s-button>
                  </div>
                </div>
                <div hidden={!showEnrol}>{staffAccess}</div>
              </div>
            </div>
            <div className="pf-scan-col">{packerPreview}</div>
          </div>
        ) : (
          <>
            <div className="pf-scan-grid">
              <div className="pf-scan-col">
                {staffAccess}
                {batchProgress}
              </div>
              <div className="pf-scan-col">{packerPreview}</div>
            </div>
            {scanHistory}
          </>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
