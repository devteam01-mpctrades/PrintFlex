import fs from "node:fs/promises";
import path from "node:path";
import { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
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
import settingsStyles from "../styles/settings.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: settingsStyles }];

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
    case "setupGuide": {
      await updateShopSettings(prisma, shop.id, (current) => ({ ...current, showSetupGuide: true }));
      return { ok: true, message: "The setup guide is back on Home." };
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

  const relative = (iso: string) => {
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  };

  return (
    <s-page heading="Settings" inlineSize="large">
      {fetcher.data && !busy ? <s-banner tone={fetcher.data.ok ? "success" : "critical"}><s-paragraph>{fetcher.data.message}</s-paragraph></s-banner> : null}

      <div className="pf-settings">
        <div className="pf-settings-grid">
          {/* Left: the warehouse and how packing behaves */}
          <div className="pf-settings-col">
            <div className="pf-panel">
              <div className="pf-panel__h"><h2>Warehouse</h2></div>
              <div className="pf-panel__b">
                <form ref={binsRef} onSubmit={(e) => { e.preventDefault(); submitForm(binsRef.current, "bins"); }}>
                  <span className="pf-kicker">Bin location map</span>
                  <div className={`pf-stat-line${warehouse.bins === 0 ? " empty" : ""}`}>
                    {warehouse.bins === 0 ? (
                      <span>No bin locations yet. Pick lists sort by SKU until you add some.</span>
                    ) : (
                      <><b>{warehouse.bins.toLocaleString("en-US")}</b><span>SKUs mapped{warehouse.withSequence ? ` · ${warehouse.withSequence} with a walking sequence` : ""}. Pick lists are sorted into walking order.</span></>
                    )}
                  </div>
                  <s-stack gap="small">
                    <s-text-area name="csv" label="Paste CSV: SKU, bin, walking sequence (optional)" rows={4} placeholder={"PF-001,B-07,2\nPF-003,A-01,1"}></s-text-area>
                    <s-select name="mode" label="Walking sequence" value="csv">
                      <s-option value="csv">From the third column, if present</s-option>
                      <s-option value="derive">Derive from bin codes: aisle, then shelf, then bin</s-option>
                    </s-select>
                  </s-stack>
                  <div className="pf-actions">
                    <button type="submit" className="pf-btn pf-btn--p" disabled={busy}>Import bin locations</button>
                    {warehouse.bins > 0 ? <button type="button" className="pf-btn pf-btn--ghost" disabled={busy} onClick={() => fetcher.submit({ intent: "clearBins" }, { method: "post" })}>Clear</button> : null}
                  </div>
                </form>
              </div>
              <div className="pf-panel__b">
                <form ref={bundlesRef} onSubmit={(e) => { e.preventDefault(); submitForm(bundlesRef.current, "bundles"); }}>
                  <span className="pf-kicker">Bundle map</span>
                  <div className={`pf-stat-line${warehouse.bundles === 0 ? " empty" : ""}`}>
                    {warehouse.bundles === 0 ? (
                      <span>No bundles yet. A bundle SKU on an order expands into its components on the pack screen.</span>
                    ) : (
                      <><b>{warehouse.bundles}</b><span>bundle SKUs expand into components on the pack screen.</span></>
                    )}
                  </div>
                  <s-text-area name="csv" label="Paste CSV: bundle SKU, component SKU, quantity, component title (optional)" rows={3} placeholder={"KIT-GLASS,PF-001,1,Ginseng Cream\nKIT-GLASS,PF-009,2,Travel Toner"}></s-text-area>
                  <div className="pf-actions">
                    <button type="submit" className="pf-btn pf-btn--p" disabled={busy}>Import bundle map</button>
                    {warehouse.bundles > 0 ? <button type="button" className="pf-btn pf-btn--ghost" disabled={busy} onClick={() => fetcher.submit({ intent: "clearBundles" }, { method: "post" })}>Clear</button> : null}
                  </div>
                </form>
              </div>
            </div>

            <div className="pf-panel">
              <div className="pf-panel__h"><h2>Pack behaviour</h2><div className="right"><span className="pf-badge pf-b-neu">Saves on change</span></div></div>
              <div className="pf-panel__b">
                <form ref={packRef} onSubmit={(e) => e.preventDefault()}>
                  <div className="pf-toggles">
                    {PACK_TOGGLES.map((t) => (
                      <s-switch key={t.key} name={t.key} value="on" checked={settings.pack[t.key] || undefined} label={t.label} details={t.details}></s-switch>
                    ))}
                  </div>
                </form>
              </div>
            </div>

            <div className="pf-panel">
              <div className="pf-panel__h"><h2>Invoice numbering</h2></div>
              <div className="pf-panel__b">
                <form ref={invoiceRef} onSubmit={(e) => { e.preventDefault(); submitForm(invoiceRef.current, "invoice"); }}>
                  <p className="pf-sub">Numbers are sequential with no gaps and never reused. The next number can only move forward past numbers already issued.</p>
                  <div className="pf-stat-line"><span>Next invoice</span><b>{data.invoice.prefix}{String(data.invoice.nextNumber).padStart(6, "0")}</b></div>
                  <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                    <s-text-field name="prefix" label="Prefix" value={data.invoice.prefix}></s-text-field>
                    <s-number-field name="nextNumber" label="Next number" value={String(data.invoice.nextNumber)} min={1}></s-number-field>
                  </s-grid>
                  <div className="pf-actions"><button type="submit" className="pf-btn pf-btn--p" disabled={busy}>Save numbering</button></div>
                </form>
              </div>
            </div>
          </div>

          {/* Right: who can scan, what gets written to Shopify, defaults */}
          <div className="pf-settings-col">
            <div className="pf-panel">
              <div className="pf-panel__h">
                <h2>Staff access</h2>
                <div className="right">
                  <span className={`pf-badge ${data.hasPin ? "pf-b-ok" : "pf-b-crit"}`}>{data.hasPin ? "PIN set" : "No PIN yet"}</span>
                </div>
              </div>
              <div className="pf-panel__b">
                <form ref={pinRef} onSubmit={(e) => { e.preventDefault(); submitForm(pinRef.current, "setPin"); }}>
                  {!data.hasPin ? <p className="pf-sub">No store PIN yet, so nobody can open scan mode. Set one to let staff sign in on their phones.</p> : null}
                  <s-stack direction="inline" gap="small" alignItems="end">
                    <s-text-field name="pin" label={data.hasPin ? "New store PIN" : "Store PIN"} placeholder="4 to 8 digits" details="Changing the PIN signs every device out."></s-text-field>
                    <button type="submit" className="pf-btn pf-btn--p" disabled={busy}>{data.hasPin ? "Rotate PIN" : "Set PIN"}</button>
                  </s-stack>
                </form>
              </div>
              {devices.length === 0 ? (
                <div className="pf-panel__empty">No device has signed in yet. Enrol a phone from Scan &amp; pack, or scan any printed QR code, enter the PIN and name the device.</div>
              ) : (
                <div className="pf-tscroll">
                  <table className="pf-t">
                    <thead><tr><th>Device</th><th>Last seen</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {devices.map((d) => (
                        <tr key={d.id}>
                          <td>{d.name}{d.staffLabel ? ` · ${d.staffLabel}` : ""}</td>
                          <td className="mono" title={when(d.lastSeenAt)}>{relative(d.lastSeenAt)}</td>
                          <td><span className={`pf-badge ${d.stale ? "pf-b-warn" : "pf-b-ok"}`}>{d.stale ? "Must sign in again" : "Active"}</span></td>
                          <td className="end">
                            <button type="button" className="pf-btn pf-btn--ghost" aria-label={`Revoke ${d.name}`} disabled={busy} onClick={() => fetcher.submit({ intent: "revoke", deviceId: d.id }, { method: "post" })}>Revoke</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="pf-panel">
              <div className="pf-panel__h"><h2>Tags written to Shopify</h2></div>
              <div className="pf-panel__b">
                <form ref={tagsRef} onSubmit={(e) => { e.preventDefault(); submitForm(tagsRef.current, "tags"); }}>
                  <p className="pf-sub">PrintFlex adds one of these tags to an order when it is printed, packed or flagged. Rename them to fit your own tag scheme.</p>
                  <s-stack gap="small">
                    <s-text-field name="printed" label="Printed" value={settings.tagNames.printed} placeholder={data.defaultTags.printed}></s-text-field>
                    <s-text-field name="packed" label="Packed" value={settings.tagNames.packed} placeholder={data.defaultTags.packed}></s-text-field>
                    <s-text-field name="needsReview" label="Needs review" value={settings.tagNames.needsReview} placeholder={data.defaultTags.needsReview}></s-text-field>
                  </s-stack>
                  <div className="pf-actions"><button type="submit" className="pf-btn pf-btn--p" disabled={busy}>Save tag names</button></div>
                </form>
              </div>
            </div>

            <div className="pf-panel">
              <div className="pf-panel__h"><h2>Defaults</h2></div>
              <div className="pf-panel__b">
                <form ref={defaultsRef} onSubmit={(e) => { e.preventDefault(); submitForm(defaultsRef.current, "defaults"); }}>
                  <s-stack gap="small">
                    <s-select name="paperSize" label="Default paper size for new templates" value={settings.defaults.paperSize}>
                      <s-option value="A4">A4</s-option>
                      <s-option value="LETTER">US Letter</s-option>
                    </s-select>
                    <span className="pf-kicker" style={{ marginTop: 6 }}>Default document set · what the morning batch on Home prints</span>
                    {DOCUMENT_TYPES.map((t) => (
                      <s-checkbox key={t} name={`set.${t}`} value="on" label={DOC_LABEL[t]} checked={settings.defaults.documentSet.includes(t) || undefined}></s-checkbox>
                    ))}
                    <s-select name="timezone" label="Meter timezone" value={data.timezone} details="Billing periods, date filters and the daily tiles use this timezone.">
                      {data.timezones.map((tz) => <s-option key={tz} value={tz}>{tz}</s-option>)}
                    </s-select>
                    <s-number-field name="scanTokenDays" label="Printed QR codes keep working for (days)" value={String(settings.scanTokenDays)} min={1} max={3650}></s-number-field>
                  </s-stack>
                  <div className="pf-actions"><button type="submit" className="pf-btn pf-btn--p" disabled={busy}>Save defaults</button></div>
                </form>
              </div>
              <div className="pf-panel__f">
                <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                  <span>The setup guide leaves Home once the first document is printed. Bring it back for a new team member.</span>
                  <button type="button" className="pf-btn" disabled={busy || settings.showSetupGuide} onClick={() => fetcher.submit({ intent: "setupGuide" }, { method: "post" })}>
                    {settings.showSetupGuide ? "Shown on Home" : "Show the setup guide"}
                  </button>
                </s-stack>
              </div>
            </div>

            <div className="pf-panel">
              <div className="pf-panel__h"><h2>Customer data requests</h2></div>
              {exportError ? <div className="pf-panel__b"><s-banner tone="critical"><s-paragraph>{exportError}</s-paragraph></s-banner></div> : null}
              {data.exports.length === 0 ? (
                <div className="pf-panel__empty">When a customer asks Shopify for their data, the export PrintFlex prepares appears here for you to forward.</div>
              ) : (
                <div className="pf-tscroll">
                  <table className="pf-t">
                    <tbody>
                      {data.exports.map((f) => (
                        <tr key={f}>
                          <td className="mono">{f}</td>
                          <td className="end"><button type="button" className="pf-btn pf-btn--ghost" onClick={() => void downloadFile(`/app/settings/export/${encodeURIComponent(f)}`, f).then(setExportError)}>Download</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pf-panel">
          <div className="pf-panel__h"><h2>Audit log</h2><div className="right"><span className="pf-badge pf-b-neu">Last {data.audit.length}</span></div></div>
          {data.audit.length === 0 ? (
            <div className="pf-panel__empty">Template changes, PIN rotations, plan changes and code revocations will be listed here.</div>
          ) : (
            <div className="pf-tscroll">
              <table className="pf-t">
                <thead><tr><th>When</th><th>What</th><th>Who</th><th>Details</th></tr></thead>
                <tbody>
                  {data.audit.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{when(a.createdAt)}</td>
                      <td>{a.label}</td>
                      <td>{a.actor}</td>
                      <td style={{ color: "var(--pf-sub)" }}>{a.details === "{}" ? "" : a.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
