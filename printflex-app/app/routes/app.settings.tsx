import { useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useNativeEvent } from "../components/orders/useNativeEvent";
import { RouteError } from "../components/RouteError";
import { Btn, Check, Switch } from "../components/ui";
import prisma from "../db.server";
import { audit } from "../lib/audit.server";
import { configureInvoiceNumbering } from "../lib/invoices/invoice-number.server";
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
  const [hasPin, devices, warehouse] = await Promise.all([hasStorePin(shop.id), listDevices(shop.id), warehouseSummary(shop.id)]);
  return {
    timezone: shop.timezone,
    timezones: Intl.supportedValuesOf("timeZone"),
    settings,
    hasPin,
    devices: devices.map((d) => ({ ...d, lastSeenAt: d.lastSeenAt.toISOString(), createdAt: d.createdAt.toISOString() })),
    warehouse,
    invoice: { prefix: shop.invoicePrefix, nextNumber: shop.invoiceNextNumber },
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

  const nextInvoice = `${data.invoice.prefix}${String(data.invoice.nextNumber).padStart(6, "0")}`;

  return (
    <s-page heading="Settings" inlineSize="large">
      {fetcher.data && !busy ? <s-banner tone={fetcher.data.ok ? "success" : "critical"}><s-paragraph>{fetcher.data.message}</s-paragraph></s-banner> : null}

      <div className="pf-settings">
        <div className="pf-settings-grid">
          {/* Left: the warehouse and how packing behaves */}
          <div className="pf-settings-col">
            <section className="pf-panel" aria-labelledby="h-warehouse">
              <div className="pf-panel__h"><h2 id="h-warehouse">Warehouse</h2></div>

              <div className="pf-panel__b">
                <form ref={binsRef} className="pf-form" onSubmit={(e) => { e.preventDefault(); submitForm(binsRef.current, "bins"); }}>
                  <div className="pf-block">
                    <h3 className="pf-kicker">Bin location map</h3>
                    <div className={`pf-stat-line${warehouse.bins === 0 ? " empty" : ""}`}>
                      {warehouse.bins === 0 ? (
                        <span>No bin locations yet. Pick lists sort by SKU until you add some.</span>
                      ) : (
                        <><b>{warehouse.bins.toLocaleString("en-US")}</b><span>SKUs mapped{warehouse.withSequence ? ` · ${warehouse.withSequence} with a walking sequence` : ""}. Pick lists are sorted into walking order.</span></>
                      )}
                    </div>
                  </div>
                  <s-text-area name="csv" label="Paste CSV" details="One line per SKU: SKU, bin, walking sequence (optional)." rows={4} placeholder={"PF-001,B-07,2\nPF-003,A-01,1"}></s-text-area>
                  <s-select name="mode" label="Walking sequence" value="csv">
                    <s-option value="csv">From the third column, if present</s-option>
                    <s-option value="derive">Derive from bin codes: aisle, then shelf, then bin</s-option>
                  </s-select>
                  <div className="pf-actions">
                    <Btn type="submit" variant="primary" disabled={busy}>Import bin locations</Btn>
                    {warehouse.bins > 0 ? <Btn variant="tertiary" tone="critical" disabled={busy} onClick={() => fetcher.submit({ intent: "clearBins" }, { method: "post" })}>Clear bin locations</Btn> : null}
                  </div>
                </form>
              </div>

              <div className="pf-panel__b">
                <form ref={bundlesRef} className="pf-form" onSubmit={(e) => { e.preventDefault(); submitForm(bundlesRef.current, "bundles"); }}>
                  <div className="pf-block">
                    <h3 className="pf-kicker">Bundle map</h3>
                    <div className={`pf-stat-line${warehouse.bundles === 0 ? " empty" : ""}`}>
                      {warehouse.bundles === 0 ? (
                        <span>No bundles yet. A bundle SKU on an order expands into its components on the pack screen.</span>
                      ) : (
                        <><b>{warehouse.bundles}</b><span>bundle SKUs expand into components on the pack screen.</span></>
                      )}
                    </div>
                  </div>
                  <s-text-area name="csv" label="Paste CSV" details="One line per component: bundle SKU, component SKU, quantity, component title (optional)." rows={3} placeholder={"KIT-GLASS,PF-001,1,Ginseng Cream\nKIT-GLASS,PF-009,2,Travel Toner"}></s-text-area>
                  <div className="pf-actions">
                    <Btn type="submit" variant="primary" disabled={busy}>Import bundle map</Btn>
                    {warehouse.bundles > 0 ? <Btn variant="tertiary" tone="critical" disabled={busy} onClick={() => fetcher.submit({ intent: "clearBundles" }, { method: "post" })}>Clear bundle map</Btn> : null}
                  </div>
                </form>
              </div>
            </section>

            <section className="pf-panel" aria-labelledby="h-pack">
              <div className="pf-panel__h"><h2 id="h-pack">Pack behaviour</h2><div className="right"><span className="pf-badge pf-b-brand">Saves on change</span></div></div>
              <div className="pf-panel__b">
                <form ref={packRef} onSubmit={(e) => e.preventDefault()}>
                  <div className="pf-toggles">
                    {PACK_TOGGLES.map((t) => (
                      <Switch key={t.key} name={t.key} value="on" defaultChecked={settings.pack[t.key]} disabled={busy} label={t.label} details={t.details} />
                    ))}
                  </div>
                </form>
              </div>
            </section>

            <section className="pf-panel" aria-labelledby="h-invoice">
              <div className="pf-panel__h"><h2 id="h-invoice">Invoice numbering</h2><div className="right"><span className="pf-badge pf-b-brand mono">Next {nextInvoice}</span></div></div>
              <div className="pf-panel__b">
                <form ref={invoiceRef} className="pf-form" onSubmit={(e) => { e.preventDefault(); submitForm(invoiceRef.current, "invoice"); }}>
                  <p className="pf-sub">Numbers are sequential with no gaps and never reused. The next number can only move forward past numbers already issued.</p>
                  <div className="pf-grid2">
                    <s-text-field name="prefix" label="Prefix" defaultValue={data.invoice.prefix} placeholder="INV-"></s-text-field>
                    <s-number-field name="nextNumber" label="Next number" min={1} step={1} defaultValue={String(data.invoice.nextNumber)}></s-number-field>
                  </div>
                  <div className="pf-actions"><Btn type="submit" variant="primary" disabled={busy}>Save numbering</Btn></div>
                </form>
              </div>
            </section>
          </div>

          {/* Right: who can scan, what gets written to Shopify, defaults */}
          <div className="pf-settings-col">
            <section className="pf-panel" aria-labelledby="h-staff">
              <div className="pf-panel__h">
                <h2 id="h-staff">Staff access</h2>
                <div className="right">
                  <span className={`pf-badge ${data.hasPin ? "pf-b-ok" : "pf-b-crit"}`}>{data.hasPin ? "PIN set" : "No PIN yet"}</span>
                </div>
              </div>
              <div className="pf-panel__b">
                <form ref={pinRef} className="pf-form" onSubmit={(e) => { e.preventDefault(); submitForm(pinRef.current, "setPin"); }}>
                  <p className="pf-sub">
                    {data.hasPin
                      ? "Staff sign in on their phones with this PIN plus a device name. Changing it signs every device out."
                      : "No store PIN yet, so nobody can open scan mode. Set one to let staff sign in on their phones."}
                  </p>
                  <div className="pf-row">
                    <s-text-field name="pin" label={data.hasPin ? "New store PIN" : "Store PIN"} placeholder="4 to 8 digits" autocomplete="off"></s-text-field>
                    <Btn type="submit" variant="primary" disabled={busy}>{data.hasPin ? "Rotate PIN" : "Set PIN"}</Btn>
                  </div>
                </form>
              </div>
              {devices.length === 0 ? (
                <div className="pf-panel__empty">No device has signed in yet. Enrol a phone from Scan &amp; pack, or scan any printed QR code, enter the PIN and name the device.</div>
              ) : (
                <div className="pf-tscroll">
                  <table className="pf-t">
                    <thead><tr><th>Device</th><th>Last seen</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {devices.map((d) => (
                        <tr key={d.id}>
                          <td>{d.name}{d.staffLabel ? ` · ${d.staffLabel}` : ""}</td>
                          <td className="mono" title={when(d.lastSeenAt)}>{relative(d.lastSeenAt)}</td>
                          <td><span className={`pf-badge ${d.stale ? "pf-b-warn" : "pf-b-ok"}`}>{d.stale ? "Must sign in again" : "Active"}</span></td>
                          <td className="end">
                            <Btn variant="tertiary" tone="critical" aria-label={`Revoke ${d.name}`} disabled={busy} onClick={() => fetcher.submit({ intent: "revoke", deviceId: d.id }, { method: "post" })}>Revoke</Btn>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="pf-panel" aria-labelledby="h-tags">
              <div className="pf-panel__h"><h2 id="h-tags">Tags written to Shopify</h2></div>
              <div className="pf-panel__b">
                <form ref={tagsRef} className="pf-form" onSubmit={(e) => { e.preventDefault(); submitForm(tagsRef.current, "tags"); }}>
                  <p className="pf-sub">PrintFlex adds one of these tags to an order when it is printed, packed or flagged. Rename them to fit your own tag scheme.</p>
                  <s-text-field name="printed" label="Printed" defaultValue={settings.tagNames.printed} placeholder={data.defaultTags.printed} details="Added when at least one document has been generated."></s-text-field>
                  <s-text-field name="packed" label="Packed" defaultValue={settings.tagNames.packed} placeholder={data.defaultTags.packed} details="Added when staff mark the order packed in scan mode."></s-text-field>
                  <s-text-field name="needsReview" label="Needs review" defaultValue={settings.tagNames.needsReview} placeholder={data.defaultTags.needsReview} details="Added when a line is short-picked or reported damaged."></s-text-field>
                  <div className="pf-actions"><Btn type="submit" variant="primary" disabled={busy}>Save tag names</Btn></div>
                </form>
              </div>
            </section>

            <section className="pf-panel" aria-labelledby="h-defaults">
              <div className="pf-panel__h"><h2 id="h-defaults">Defaults</h2></div>
              <div className="pf-panel__b">
                <form ref={defaultsRef} className="pf-form" onSubmit={(e) => { e.preventDefault(); submitForm(defaultsRef.current, "defaults"); }}>
                  <s-select name="paperSize" label="Default paper size for new templates" value={settings.defaults.paperSize}>
                    <s-option value="A4">A4</s-option>
                    <s-option value="LETTER">US Letter</s-option>
                  </s-select>

                  <fieldset className="pf-fieldset">
                    <legend className="pf-legend">Default document set</legend>
                    <p className="pf-sub">What the morning batch on Home prints for each order.</p>
                    <div className="pf-checks">
                      {DOCUMENT_TYPES.map((t) => (
                        <Check key={t} name={`set.${t}`} value="on" defaultChecked={settings.defaults.documentSet.includes(t)} label={DOC_LABEL[t]} />
                      ))}
                    </div>
                  </fieldset>

                  <s-select name="timezone" label="Meter timezone" value={data.timezone} details="Billing periods, date filters and the daily tiles use this timezone.">
                    {data.timezones.map((tz) => <s-option key={tz} value={tz}>{tz}</s-option>)}
                  </s-select>

                  <s-number-field name="scanTokenDays" label="Printed QR codes keep working for" min={1} max={3650} step={1} suffix="days" defaultValue={String(settings.scanTokenDays)} details="After this, a scanned code asks staff to reprint the document."></s-number-field>

                  <div className="pf-actions"><Btn type="submit" variant="primary" disabled={busy}>Save defaults</Btn></div>
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
