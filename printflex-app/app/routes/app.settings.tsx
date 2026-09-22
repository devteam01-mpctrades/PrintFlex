import fs from "node:fs/promises";
import path from "node:path";
import { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { downloadFile } from "../components/download";
import { useNativeEvent } from "../components/orders/useNativeEvent";
import { RouteError } from "../components/RouteError";
import prisma from "../db.server";
import { audit, listAudit } from "../lib/audit.server";
import { configureInvoiceNumbering } from "../lib/invoices/invoice-number.server";
import { storageRoot } from "../lib/render/storage.server";
import { requireShop } from "../lib/request.server";
import { listDevices, revokeDevice } from "../lib/scan/devices.server";
import { hasStorePin, setStorePin } from "../lib/scan/pin.server";
import { DEFAULT_TAG_NAMES, parseSettings, updateShopSettings, type PackSettings } from "../lib/settings.server";
import { clearBins, clearBundles, importBins, importBundles, warehouseSummary } from "../lib/warehouse/warehouse.server";
import { DOCUMENT_TYPES } from "../lib/types";

const PACK_TOGGLES: Array<{ key: keyof PackSettings; label: string; details: string }> = [
  { key: "requireAllChecked", label: "Require every item to be checked", details: "Mark as packed stays disabled until every line is complete or flagged." },
  { key: "showPhotos", label: "Show product photos on the pack screen", details: "Photos come from Shopify, so new packers still fill the right box." },
  { key: "strictMode", label: "Strict mode: scan each product barcode", details: "Tapping is disabled; a wrong scan shows a loud mismatch." },
  { key: "askWeight", label: "Ask for parcel weight when packing", details: "Written to the order as a metafield." },
  { key: "allowShortPick", label: "Allow short-pick and damage reports", details: "Staff can flag a line they cannot complete. The order goes to Needs review, never to Packed." },
];

const DOC_LABEL = { INVOICE: "Invoice", PACKING_SLIP: "Packing slip", PICK_LIST: "Pick list" } as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const settings = parseSettings(shop.settingsJson);
  const [hasPin, devices, warehouse, auditRows] = await Promise.all([hasStorePin(shop.id), listDevices(shop.id), warehouseSummary(shop.id), listAudit(shop.id, 50)]);
  const exportsDir = path.join(storageRoot(), "compliance", shop.id);
  let exportsList: string[] = [];
  try {
    exportsList = (await fs.readdir(exportsDir)).filter((f) => f.endsWith(".json")).sort().reverse();
  } catch {
    exportsList = [];
  }
  return {
    timezone: shop.timezone,
    timezones: Intl.supportedValuesOf("timeZone"),
    settings,
    hasPin,
    devices: devices.map((d) => ({ ...d, lastSeenAt: d.lastSeenAt.toISOString(), createdAt: d.createdAt.toISOString() })),
    warehouse,
    invoice: { prefix: shop.invoicePrefix, nextNumber: shop.invoiceNextNumber },
    exports: exportsList,
    audit: auditRows,
    defaultTags: DEFAULT_TAG_NAMES,
  };
};

type Result = { ok: boolean; message: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const str = (k: string) => String(form.get(k) ?? "").trim();

  switch (intent) {
    case "bins": {
      const result = await importBins(shop.id, str("csv"), str("mode") === "derive" ? "derive" : "csv");
      const tail = result.errors.length ? ` ${result.errors.length} ${result.errors.length === 1 ? "line was" : "lines were"} skipped: ${result.errors.slice(0, 3).join(" ")}` : "";
      return result.imported ? { ok: true, message: `Imported ${result.imported} bin locations. Pick lists now sort in walking order.${tail}` } : { ok: false, message: result.errors.join(" ") };
    }
    case "clearBins":
      return { ok: true, message: `Removed ${await clearBins(shop.id)} bin locations. Pick lists sort by SKU until you import again.` };
    case "bundles": {
      const result = await importBundles(shop.id, str("csv"));
      const tail = result.errors.length ? ` ${result.errors.length} ${result.errors.length === 1 ? "line was" : "lines were"} skipped: ${result.errors.slice(0, 3).join(" ")}` : "";
      return result.imported ? { ok: true, message: `Imported ${result.imported} bundle components. Bundles expand on the pack screen.${tail}` } : { ok: false, message: result.errors.join(" ") };
    }
    case "clearBundles":
      return { ok: true, message: `Removed ${await clearBundles(shop.id)} bundle components.` };
    case "pack": {
      await updateShopSettings(prisma, shop.id, (current) => ({
        ...current,
        pack: Object.fromEntries(PACK_TOGGLES.map((t) => [t.key, form.get(t.key) === "on"])) as unknown as PackSettings,
      }));
      await audit(shop.id, "merchant", "settings.changed", "pack");
      return { ok: true, message: "Pack behaviour saved. Devices pick it up on their next scan." };
    }
    case "setPin": {
      const result = await setStorePin(shop.id, str("pin"));
      return result.ok ? { ok: true, message: "PIN saved. Every device must sign in again with the new PIN." } : { ok: false, message: "The PIN must be 4 to 8 digits." };
    }
    case "revoke": {
      const revoked = await revokeDevice(shop.id, str("deviceId"));
      return revoked ? { ok: true, message: "Device removed. It will be asked for the PIN next time." } : { ok: false, message: "That device was already removed." };
    }
    case "tags": {
      const printed = str("printed") || DEFAULT_TAG_NAMES.printed;
      const packed = str("packed") || DEFAULT_TAG_NAMES.packed;
      const needsReview = str("needsReview") || DEFAULT_TAG_NAMES.needsReview;
      if (new Set([printed, packed, needsReview]).size < 3) return { ok: false, message: "The three tags must be different from each other." };
      if ([printed, packed, needsReview].some((t) => t.length > 40 || /[,]/.test(t))) return { ok: false, message: "Tags must be under 40 characters and contain no commas." };
      await updateShopSettings(prisma, shop.id, (current) => ({ ...current, tagNames: { printed, packed, needsReview } }));
      await audit(shop.id, "merchant", "settings.changed", "tags", { printed, packed, needsReview });
      return { ok: true, message: "Tag names saved. New prints and packs use them; tags already on orders are unchanged." };
    }
    case "defaults": {
      const set = DOCUMENT_TYPES.filter((t) => form.get(`set.${t}`) === "on");
      if (set.length === 0) return { ok: false, message: "Choose at least one document for the default set." };
      const paperSize = str("paperSize") === "LETTER" ? "LETTER" : "A4";
      const timezone = str("timezone");
      if (!Intl.supportedValuesOf("timeZone").includes(timezone)) return { ok: false, message: "Choose a timezone from the list." };
      const days = Number(str("scanTokenDays"));
      if (!Number.isInteger(days) || days < 1 || days > 3650) return { ok: false, message: "Scan codes can last between 1 and 3650 days." };
      await prisma.shop.update({ where: { id: shop.id }, data: { timezone } });
      await updateShopSettings(prisma, shop.id, (current) => ({ ...current, defaults: { paperSize, documentSet: set }, scanTokenDays: days }));
      await audit(shop.id, "merchant", "settings.changed", "defaults", { paperSize, documentSet: set, timezone, scanTokenDays: days });
      return { ok: true, message: `Defaults saved. The meter and date filters use ${timezone}.` };
    }
    case "invoice": {
      try {
        const result = await configureInvoiceNumbering(shop.id, { prefix: str("prefix"), nextNumber: Number(str("nextNumber")) });
        await audit(shop.id, "merchant", "invoice.numbering", null, result);
        return { ok: true, message: `Invoice numbers continue from ${result.prefix}${String(result.nextNumber).padStart(6, "0")}.` };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Invoice numbering could not be changed." };
      }
    }
    default:
      return { ok: false, message: "Unknown action." };
  }
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const { settings, devices, warehouse } = data;
  const fetcher = useFetcher<Result>();
  const busy = fetcher.state !== "idle";
  const packRef = useRef<HTMLFormElement>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useNativeEvent(packRef, "change", () => {
    if (!packRef.current) return;
    const form = new FormData(packRef.current);
    form.set("intent", "pack");
    fetcher.submit(form, { method: "post" });
  });
  const submitForm = (ref: HTMLFormElement | null, intent: string) => {
    if (!ref) return;
    const form = new FormData(ref);
    form.set("intent", intent);
    fetcher.submit(form, { method: "post" });
  };
  const binsRef = useRef<HTMLFormElement>(null);
  const bundlesRef = useRef<HTMLFormElement>(null);
  const pinRef = useRef<HTMLFormElement>(null);
  const tagsRef = useRef<HTMLFormElement>(null);
  const defaultsRef = useRef<HTMLFormElement>(null);
  const invoiceRef = useRef<HTMLFormElement>(null);
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <s-page heading="Settings">
      {fetcher.data && !busy ? <s-banner tone={fetcher.data.ok ? "success" : "critical"}><s-paragraph>{fetcher.data.message}</s-paragraph></s-banner> : null}

      <s-section heading="Warehouse">
        <s-stack gap="base">
          <form ref={binsRef} onSubmit={(e) => { e.preventDefault(); submitForm(binsRef.current, "bins"); }}>
            <s-stack gap="small">
              <s-heading>Bin location map</s-heading>
              <s-paragraph color="subdued">
                {warehouse.bins === 0
                  ? "No bin locations yet. Pick lists sort by SKU. Paste a CSV with SKU, bin and an optional walking sequence."
                  : `${warehouse.bins} SKUs mapped${warehouse.withSequence ? `, ${warehouse.withSequence} with a walking sequence` : ""}. Pick lists are sorted into walking order using this map.`}
              </s-paragraph>
              <s-text-area name="csv" label="CSV: SKU, bin, walking sequence (optional)" rows={5} placeholder={"PF-001,B-07,2\nPF-003,A-01,1"}></s-text-area>
              <s-select name="mode" label="Walking sequence" value="csv">
                <s-option value="csv">From the third column, if present</s-option>
                <s-option value="derive">Derive from bin codes: aisle, then shelf, then bin</s-option>
              </s-select>
              <s-stack direction="inline" gap="small">
                <s-button type="submit" variant="primary" disabled={busy || undefined}>Import bin locations</s-button>
                {warehouse.bins > 0 ? <s-button variant="tertiary" tone="critical" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "clearBins" }, { method: "post" })}>Clear</s-button> : null}
              </s-stack>
            </s-stack>
          </form>
          <s-divider />
          <form ref={bundlesRef} onSubmit={(e) => { e.preventDefault(); submitForm(bundlesRef.current, "bundles"); }}>
            <s-stack gap="small">
              <s-heading>Bundle map</s-heading>
              <s-paragraph color="subdued">
                {warehouse.bundles === 0
                  ? "No bundles yet. A bundle SKU on an order expands into its components on the pack screen."
                  : `${warehouse.bundles} bundle SKUs expand into components on the pack screen.`}
              </s-paragraph>
              <s-text-area name="csv" label="CSV: bundle SKU, component SKU, quantity, component title (optional)" rows={4} placeholder={"KIT-GLASS,PF-001,1,Ginseng Cream\nKIT-GLASS,PF-009,2,Travel Toner"}></s-text-area>
              <s-stack direction="inline" gap="small">
                <s-button type="submit" variant="primary" disabled={busy || undefined}>Import bundle map</s-button>
                {warehouse.bundles > 0 ? <s-button variant="tertiary" tone="critical" disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "clearBundles" }, { method: "post" })}>Clear</s-button> : null}
              </s-stack>
            </s-stack>
          </form>
        </s-stack>
      </s-section>

      <s-section heading="Pack behaviour">
        <form ref={packRef} onSubmit={(e) => e.preventDefault()}>
          <s-stack gap="small">
            {PACK_TOGGLES.map((t) => (
              <s-switch key={t.key} name={t.key} value="on" checked={settings.pack[t.key] || undefined} label={t.label} details={t.details}></s-switch>
            ))}
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Staff access">
        <s-stack gap="base">
          {!data.hasPin ? <s-banner tone="warning"><s-paragraph>No store PIN yet, so nobody can open scan mode. Set one below.</s-paragraph></s-banner> : null}
          <form ref={pinRef} onSubmit={(e) => { e.preventDefault(); submitForm(pinRef.current, "setPin"); }}>
            <s-stack direction="inline" gap="small" alignItems="end">
              <s-text-field name="pin" label={data.hasPin ? "New store PIN" : "Store PIN"} placeholder="4 to 8 digits" details="Changing the PIN signs every device out."></s-text-field>
              <s-button type="submit" variant="primary" disabled={busy || undefined}>{data.hasPin ? "Rotate PIN" : "Set PIN"}</s-button>
            </s-stack>
          </form>
          {devices.length === 0 ? (
            <s-paragraph color="subdued">No device has signed in yet. Staff scan any printed QR code, enter the PIN and name the device.</s-paragraph>
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
                    <s-table-cell>{d.name}{d.staffLabel ? ` · ${d.staffLabel}` : ""}</s-table-cell>
                    <s-table-cell>{when(d.lastSeenAt)}</s-table-cell>
                    <s-table-cell><s-badge tone={d.stale ? "warning" : "success"}>{d.stale ? "Must sign in again" : "Active"}</s-badge></s-table-cell>
                    <s-table-cell>
                      <s-button variant="tertiary" tone="critical" accessibilityLabel={`Revoke ${d.name}`} disabled={busy || undefined} onClick={() => fetcher.submit({ intent: "revoke", deviceId: d.id }, { method: "post" })}>Revoke</s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Tags written to Shopify">
        <form ref={tagsRef} onSubmit={(e) => { e.preventDefault(); submitForm(tagsRef.current, "tags"); }}>
          <s-stack gap="small">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="small">
              <s-text-field name="printed" label="Printed" value={settings.tagNames.printed} placeholder={data.defaultTags.printed}></s-text-field>
              <s-text-field name="packed" label="Packed" value={settings.tagNames.packed} placeholder={data.defaultTags.packed}></s-text-field>
              <s-text-field name="needsReview" label="Needs review" value={settings.tagNames.needsReview} placeholder={data.defaultTags.needsReview}></s-text-field>
            </s-grid>
            <s-button type="submit" variant="primary" disabled={busy || undefined}>Save tag names</s-button>
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Defaults">
        <form ref={defaultsRef} onSubmit={(e) => { e.preventDefault(); submitForm(defaultsRef.current, "defaults"); }}>
          <s-stack gap="small">
            <s-select name="paperSize" label="Default paper size for new templates" value={settings.defaults.paperSize}>
              <s-option value="A4">A4</s-option>
              <s-option value="LETTER">US Letter</s-option>
            </s-select>
            <s-heading>Default document set</s-heading>
            <s-paragraph color="subdued">What the morning batch on Home prints.</s-paragraph>
            {DOCUMENT_TYPES.map((t) => (
              <s-checkbox key={t} name={`set.${t}`} value="on" label={DOC_LABEL[t]} checked={settings.defaults.documentSet.includes(t) || undefined}></s-checkbox>
            ))}
            <s-select name="timezone" label="Meter timezone" value={data.timezone} details="Billing periods, date filters and the daily tiles use this timezone.">
              {data.timezones.map((tz) => <s-option key={tz} value={tz}>{tz}</s-option>)}
            </s-select>
            <s-number-field name="scanTokenDays" label="Printed QR codes keep working for (days)" value={String(settings.scanTokenDays)} min={1} max={3650}></s-number-field>
            <s-button type="submit" variant="primary" disabled={busy || undefined}>Save defaults</s-button>
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Invoice numbering">
        <form ref={invoiceRef} onSubmit={(e) => { e.preventDefault(); submitForm(invoiceRef.current, "invoice"); }}>
          <s-stack gap="small">
            <s-paragraph color="subdued">Numbers are sequential with no gaps and never reused. The next number can only move forward past numbers already issued.</s-paragraph>
            <s-stack direction="inline" gap="small" alignItems="end">
              <s-text-field name="prefix" label="Prefix" value={data.invoice.prefix}></s-text-field>
              <s-number-field name="nextNumber" label="Next number" value={String(data.invoice.nextNumber)} min={1}></s-number-field>
              <s-button type="submit" variant="primary" disabled={busy || undefined}>Save numbering</s-button>
            </s-stack>
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Customer data requests">
        {exportError ? <s-banner tone="critical"><s-paragraph>{exportError}</s-paragraph></s-banner> : null}
        {data.exports.length === 0 ? (
          <s-paragraph color="subdued">When a customer asks Shopify for their data, the export PrintFlex prepares appears here for you to forward.</s-paragraph>
        ) : (
          <s-unordered-list>
            {data.exports.map((f) => (
              <s-list-item key={f}>
                <s-button variant="tertiary" onClick={() => void downloadFile(`/app/settings/export/${encodeURIComponent(f)}`, f).then(setExportError)}>{f}</s-button>
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>

      <s-section heading="Audit log">
        {data.audit.length === 0 ? (
          <s-paragraph color="subdued">Template changes, PIN rotations, plan changes and code revocations will be listed here.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>When</s-table-header>
              <s-table-header listSlot="primary">What</s-table-header>
              <s-table-header>Who</s-table-header>
              <s-table-header>Details</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.audit.map((a) => (
                <s-table-row key={a.id}>
                  <s-table-cell>{when(a.createdAt)}</s-table-cell>
                  <s-table-cell>{a.label}</s-table-cell>
                  <s-table-cell>{a.actor}</s-table-cell>
                  <s-table-cell><s-text color="subdued">{a.details === "{}" ? "" : a.details}</s-text></s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return <RouteError />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
