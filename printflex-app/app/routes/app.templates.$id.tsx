import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useNativeEvent } from "../components/orders/useNativeEvent";
import prisma from "../db.server";
import { wrapDocument } from "../lib/render/batch-html.server";
import { renderPickListFragment, aggregatePickList } from "../lib/render/fragments.server";
import { fetchOrderDocumentData } from "../lib/render/order-document-data.server";
import { buildOrderFragment, loadBins, orderContext } from "../lib/render/order-fragments.server";
import { requireShop } from "../lib/request.server";
import { ruleFromForm, settingsFromForm } from "../lib/templates/template-form.server";
import {
  deleteTemplate,
  describeRule,
  DOCUMENT_TYPE_LABELS,
  FIELD_LABELS,
  FIELDS_BY_TYPE,
  FONT_CHOICES,
  listVersions,
  parseAssignmentRule,
  parseTemplateSettings,
  restoreVersion,
  saveTemplate,
  type TemplateSettings,
} from "../lib/templates/templates.server";
import type { DocumentType } from "../lib/types";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const template = await prisma.template.findFirst({ where: { id: params.id, shopId: shop.id, active: true } });
  if (!template) throw new Response("This template does not exist.", { status: 404 });
  const [versions, orders, siblings] = await Promise.all([
    listVersions(shop.id, template.id),
    prisma.orderIndex.findMany({
      where: { shopId: shop.id },
      orderBy: { shopifyCreatedAt: "desc" },
      take: 30,
      select: { id: true, orderName: true, customerName: true, countryCode: true, itemCount: true },
    }),
    prisma.template.count({ where: { shopId: shop.id, documentType: template.documentType, active: true } }),
  ]);
  const type = template.documentType as DocumentType;
  return {
    template: {
      id: template.id,
      name: template.name,
      type,
      typeLabel: DOCUMENT_TYPE_LABELS[type],
      version: template.version,
      settings: parseTemplateSettings(template.settingsJson),
      rule: parseAssignmentRule(template.assignmentRuleJson),
      canDelete: siblings > 1,
    },
    fields: FIELDS_BY_TYPE[type],
    fonts: FONT_CHOICES,
    versions: versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt.toISOString(),
      rule: describeRule(parseAssignmentRule(v.assignmentRuleJson)),
    })),
    orders,
    timezone: shop.timezone,
  };
};

interface ActionResult {
  ok: boolean;
  message?: string;
  /** Preview HTML for the iframe. */
  html?: string;
  previewLabel?: string;
}

async function renderPreview(
  shopId: string,
  timezone: string,
  template: { id: string; documentType: string; name: string; version: number; settingsJson: string; assignmentRuleJson: string; shopId: string; active: boolean; createdAt: Date; updatedAt: Date },
  settings: TemplateSettings,
  orderId: string | null,
  admin: Parameters<typeof fetchOrderDocumentData>[0],
): Promise<string> {
  const type = template.documentType as DocumentType;
  const order = orderId
    ? await prisma.orderIndex.findFirst({ where: { id: orderId, shopId }, select: { id: true, shopifyOrderId: true, orderName: true, countryCode: true, tagsJson: true } })
    : await prisma.orderIndex.findFirst({ where: { shopId }, orderBy: { shopifyCreatedAt: "desc" }, select: { id: true, shopifyOrderId: true, orderName: true, countryCode: true, tagsJson: true } });
  if (!order) {
    return wrapDocument([`<article class="doc" style="padding:20mm"><h2>No orders yet</h2><p>The preview renders against a real order. Sync orders first, then pick one here.</p></article>`], { title: "Preview", paperSize: settings.paperSize });
  }
  const data = await fetchOrderDocumentData(admin, order.shopifyOrderId);
  if (!data) {
    return wrapDocument([`<article class="doc" style="padding:20mm"><h2>${order.orderName} is gone</h2><p>That order no longer exists in Shopify. Pick another one.</p></article>`], { title: "Preview", paperSize: settings.paperSize });
  }
  const bins = await loadBins(shopId);
  if (type === "PICK_LIST") {
    const fragment = renderPickListFragment({
      lines: aggregatePickList([data], bins),
      orderCount: 1,
      batchLabel: "BATCH-PREVIEW",
      generatedAt: new Date().toISOString(),
      sellerName: data.seller.name,
      settings,
      timezone,
    });
    return wrapDocument([fragment], { title: "Preview", paperSize: settings.paperSize });
  }
  void orderContext; // rule matching is irrelevant in preview: this template is forced
  const fragment = await buildOrderFragment({
    shopId,
    orderId: order.id,
    data,
    documentType: type,
    resolved: { template, settings },
    timezone,
    bins,
    now: new Date(),
    preview: true,
  });
  return wrapDocument([fragment.html], { title: "Preview", paperSize: settings.paperSize });
}

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const { shop, admin } = await requireShop(request);
  const template = await prisma.template.findFirst({ where: { id: params.id, shopId: shop.id, active: true } });
  if (!template) throw new Response("This template does not exist.", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const current = parseTemplateSettings(template.settingsJson);
  const orderId = String(form.get("orderId") ?? "") || null;

  switch (intent) {
    case "preview": {
      const settings = settingsFromForm(form, current);
      return { ok: true, html: await renderPreview(shop.id, shop.timezone, template, settings, orderId, admin), previewLabel: "Unsaved changes" };
    }
    case "previewVersion": {
      const version = Number(form.get("version"));
      const stored = await prisma.templateVersion.findUnique({ where: { templateId_version: { templateId: template.id, version } } });
      if (!stored) return { ok: false, message: `Version ${version} does not exist.` };
      const settings = parseTemplateSettings(stored.settingsJson);
      return { ok: true, html: await renderPreview(shop.id, shop.timezone, template, settings, orderId, admin), previewLabel: `Version ${version}` };
    }
    case "save": {
      const saved = await saveTemplate(shop.id, template.id, {
        name: String(form.get("name") ?? ""),
        settings: settingsFromForm(form, current),
        rule: ruleFromForm(form),
      });
      return {
        ok: true,
        message:
          saved.version === template.version
            ? "Nothing changed, so no new version was saved."
            : `Saved as version ${saved.version}. Documents printed from now on use it; already printed PDFs are unchanged.`,
      };
    }
    case "restore": {
      const restored = await restoreVersion(shop.id, template.id, Number(form.get("version")));
      return { ok: true, message: `Restored version ${form.get("version")} as version ${restored.version}.` };
    }
    case "delete": {
      const result = await deleteTemplate(shop.id, template.id);
      if (!result.ok) {
        return { ok: false, message: result.reason === "last-of-type" ? "This is the only template for this document type, so it cannot be deleted. Create another first." : "This template no longer exists." };
      }
      return redirect("/app/templates");
    }
    default:
      return { ok: false, message: "Unknown action." };
  }
};

export default function TemplateStudio() {
  const data = useLoaderData<typeof loader>();
  const { template, fields, fonts, versions, orders } = data;
  const s = template.settings;
  const saver = useFetcher<ActionResult>();
  const previewer = useFetcher<ActionResult>();
  const formRef = useRef<HTMLFormElement>(null);
  const logoRef = useRef<HTMLElementTagNameMap["s-drop-zone"]>(null);
  const [logo, setLogo] = useState<string | null>(s.logoUrl);
  const [logoAction, setLogoAction] = useState<"keep" | "set" | "remove">("keep");
  const [orderId, setOrderId] = useState<string>(orders[0]?.id ?? "");
  const [html, setHtml] = useState<string>("");
  const [previewLabel, setPreviewLabel] = useState("Current version");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestPreview = useCallback(
    (override?: Record<string, string>) => {
      if (!formRef.current) return;
      const form = new FormData(formRef.current);
      form.set("intent", "preview");
      form.set("orderId", orderId);
      for (const [k, v] of Object.entries(override ?? {})) form.set(k, v);
      previewer.submit(form, { method: "post" });
    },
    [orderId, previewer],
  );

  // Debounced live preview on any change in the form.
  const schedulePreview = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => requestPreview(), 350);
  }, [requestPreview]);
  useNativeEvent(formRef, "change", schedulePreview);
  useNativeEvent(formRef, "input", schedulePreview);

  // First preview and preview on order change.
  useEffect(() => {
    requestPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    if (previewer.state === "idle" && previewer.data?.html) {
      setHtml(previewer.data.html);
      setPreviewLabel(previewer.data.previewLabel ?? "Preview");
    }
  }, [previewer.state, previewer.data]);

  // Logo drop zone → data URL in a hidden field.
  useNativeEvent(
    logoRef,
    "change",
    useCallback((event: Event) => {
      const zone = event.target as HTMLElementTagNameMap["s-drop-zone"];
      const file = zone.files?.[0];
      if (!file) return;
      if (file.size > 400 * 1024) {
        window.alert("Logos must be under 400 KB. Export a smaller PNG or an SVG.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setLogo(String(reader.result));
        setLogoAction("set");
        setTimeout(schedulePreview, 0);
      };
      reader.readAsDataURL(file);
    }, [schedulePreview]),
  );

  const orderPickerRef = useRef<HTMLElementTagNameMap["s-select"]>(null);
  useNativeEvent(
    orderPickerRef,
    "change",
    useCallback((event: Event) => setOrderId((event.target as HTMLElementTagNameMap["s-select"]).value), []),
  );

  const busy = saver.state !== "idle";
  const bool = (name: string, checked: boolean, label: string, details?: string) => (
    <s-stack key={name} direction="inline" gap="small" alignItems="center">
      <input type="hidden" name={`${name}.present`} value="1" />
      <s-switch name={name} value="on" checked={checked || undefined} label={label} details={details}></s-switch>
    </s-stack>
  );

  return (
    <s-page heading={template.name} inlineSize="large">
      <s-button slot="breadcrumb-actions" href="/app/templates" variant="tertiary">Templates</s-button>
      <s-button slot="primary-action" variant="primary" disabled={busy || undefined} onClick={() => {
        if (!formRef.current) return;
        const form = new FormData(formRef.current);
        form.set("intent", "save");
        saver.submit(form, { method: "post" });
      }}>
        {busy ? "Saving…" : "Save"}
      </s-button>
      {template.canDelete ? (
        <s-button slot="secondary-actions" tone="critical" variant="tertiary" onClick={() => saver.submit({ intent: "delete" }, { method: "post" })}>
          Delete template
        </s-button>
      ) : null}

      {saver.data?.message && saver.state === "idle" ? (
        <s-banner tone={saver.data.ok ? "success" : "critical"}><s-paragraph>{saver.data.message}</s-paragraph></s-banner>
      ) : null}

      <s-grid gridTemplateColumns="minmax(320px, 2fr) minmax(360px, 3fr)" gap="base">
        <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
          <s-stack gap="base">
            <s-section heading="Template">
              <s-text-field name="name" label="Name" value={template.name}></s-text-field>
              <s-paragraph color="subdued">{template.typeLabel} · version {template.version}</s-paragraph>
            </s-section>

            <s-section heading="Brand">
              <s-stack gap="base">
                <s-box>
                  <input type="hidden" name="logoAction" value={logoAction} />
                  <input type="hidden" name="logoDataUrl" value={logoAction === "set" && logo ? logo : ""} />
                  {logo ? (
                    <s-stack direction="inline" gap="base" alignItems="center">
                      <s-thumbnail src={logo} alt="Logo" size="large"></s-thumbnail>
                      <s-button variant="tertiary" tone="critical" onClick={() => { setLogo(null); setLogoAction("remove"); setTimeout(schedulePreview, 0); }}>
                        Remove logo
                      </s-button>
                    </s-stack>
                  ) : null}
                  <s-drop-zone ref={logoRef} label="Logo" accept="image/png,image/jpeg,image/svg+xml"></s-drop-zone>
                  <s-paragraph color="subdued">PNG, JPEG or SVG under 400 KB. Shown at up to 18 mm tall.</s-paragraph>
                </s-box>
                <s-color-field name="accentColor" label="Accent colour" value={s.accentColor}></s-color-field>
                <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                  <s-select name="headingFont" label="Heading font" value={s.headingFont}>
                    {fonts.map((f) => <s-option key={f} value={f}>{f}</s-option>)}
                  </s-select>
                  <s-select name="bodyFont" label="Body font" value={s.bodyFont}>
                    {fonts.map((f) => <s-option key={f} value={f}>{f}</s-option>)}
                  </s-select>
                  <s-select name="paperSize" label="Paper size" value={s.paperSize}>
                    <s-option value="A4">A4</s-option>
                    <s-option value="LETTER">US Letter</s-option>
                  </s-select>
                  <s-select name="density" label="Density" value={s.density}>
                    <s-option value="normal">Normal</s-option>
                    <s-option value="compact">Compact</s-option>
                  </s-select>
                </s-grid>
              </s-stack>
            </s-section>

            <s-section heading="Show on this document">
              <s-stack gap="small">
                {fields.map((key) => bool(`field.${key}`, s.fields[key], FIELD_LABELS[key]))}
              </s-stack>
            </s-section>

            {template.type !== "PICK_LIST" ? (
              <s-section heading="Codes">
                <s-stack gap="small">
                  {bool("codes.qr", s.codes.qr, "QR code", "Opens the order in scan mode")}
                  {bool("codes.barcode", s.codes.barcode, "Barcode", "Code 128 of the order number")}
                  <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                    <s-select name="codes.position" label="Position" value={s.codes.position}>
                      <s-option value="header">Header</s-option>
                      <s-option value="footer">Footer</s-option>
                    </s-select>
                    <s-select name="codes.size" label="Size" value={s.codes.size}>
                      <s-option value="small">Small · 15 mm</s-option>
                      <s-option value="medium">Medium · 22 mm</s-option>
                      <s-option value="large">Large · 30 mm</s-option>
                    </s-select>
                  </s-grid>
                </s-stack>
              </s-section>
            ) : null}

            {template.type === "INVOICE" ? (
              <s-section heading="Automatic invoice email">
                <s-stack gap="small">
                  {bool("email.enabled", s.email.enabled, "Email the invoice automatically", "Premium and Unlimited. Sent once per order for the chosen moment, with the PDF attached.")}
                  <s-select name="email.trigger" label="Send when" value={s.email.trigger}>
                    <s-option value="creation">The order is created</s-option>
                    <s-option value="payment">The order is paid</s-option>
                    <s-option value="fulfillment">The order is fulfilled</s-option>
                  </s-select>
                  <s-paragraph color="subdued">Every send is logged on the Home screen, where you can resend manually.</s-paragraph>
                </s-stack>
              </s-section>
            ) : null}

            <s-section heading="Footer">
              <s-text-area name="footerText" label="Free text" rows={4} value={s.footerText} placeholder="Legal mentions, return policy, bank details, tax numbers"></s-text-area>
            </s-section>

            <s-section heading="Assign to">
              <s-stack gap="small">
                <s-text-field name="rule.countries" label="Destination countries" value={template.rule.countries.join(", ")} placeholder="JP, KR" details="Two-letter ISO codes, comma separated. Leave empty for any country."></s-text-field>
                <s-text-field name="rule.tags" label="Order tags" value={template.rule.tags.join(", ")} placeholder="b2b, wholesale" details="Any of these tags. Leave empty for any order."></s-text-field>
                <s-paragraph color="subdued">
                  Both empty means this template is the fallback for every {template.typeLabel.toLowerCase()}. Markets are not yet
                  available as a condition.
                </s-paragraph>
              </s-stack>
            </s-section>

            <s-section heading="Version history">
              {versions.length <= 1 ? (
                <s-paragraph color="subdued">Every save adds a version here. The last ten are kept, previewable and restorable.</s-paragraph>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header format="numeric">Version</s-table-header>
                    <s-table-header>Saved</s-table-header>
                    <s-table-header>Applies to</s-table-header>
                    <s-table-header></s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {versions.map((v) => (
                      <s-table-row key={v.version}>
                        <s-table-cell><s-text fontVariantNumeric="tabular-nums">{v.version}{v.version === template.version ? " (current)" : ""}</s-text></s-table-cell>
                        <s-table-cell>{new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v.createdAt))}</s-table-cell>
                        <s-table-cell>{v.rule}</s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small">
                            <s-button variant="tertiary" onClick={() => previewer.submit({ intent: "previewVersion", version: String(v.version), orderId }, { method: "post" })}>Preview</s-button>
                            {v.version !== template.version ? (
                              <s-button variant="tertiary" disabled={busy || undefined} onClick={() => saver.submit({ intent: "restore", version: String(v.version) }, { method: "post" })}>Restore</s-button>
                            ) : null}
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-section>
          </s-stack>
        </form>

        <s-section heading="Live preview" padding="base">
          <s-stack gap="small">
            <s-select ref={orderPickerRef} label="Preview against a real order" value={orderId} disabled={orders.length === 0 || undefined}>
              {orders.map((o) => (
                <s-option key={o.id} value={o.id}>
                  {o.orderName} · {o.customerName ?? "Guest"}{o.countryCode ? ` · ${o.countryCode}` : ""} · {o.itemCount} items
                </s-option>
              ))}
            </s-select>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={previewLabel === "Unsaved changes" ? "warning" : "neutral"}>{previewLabel}</s-badge>
              {previewer.state !== "idle" ? <s-spinner size="base"></s-spinner> : null}
              <s-text color="subdued">The preview and the print job share one renderer, so what you see here is what prints.</s-text>
            </s-stack>
            <iframe
              title="Template preview"
              srcDoc={html}
              sandbox=""
              style={{ width: "100%", height: "min(1100px, 130vh)", border: "1px solid #e3e3e3", borderRadius: 8, background: "#e5e7eb" }}
            />
          </s-stack>
        </s-section>
      </s-grid>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
