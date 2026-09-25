import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import { useNativeEvent } from "../components/orders/useNativeEvent";
import { PreviewPane } from "../components/templates/PreviewPane";
import { SettingsPane } from "../components/templates/SettingsPane";
import { TemplateList, type TemplateGroup } from "../components/templates/TemplateList";
import { useTemplateDraft } from "../components/templates/useTemplateDraft";
import prisma from "../db.server";
import { canCreateAnother, getPlan } from "../lib/plans.server";
import { requireShop } from "../lib/request.server";
import { listPreviewOrders, pickPreviewOrder, renderPreview } from "../lib/templates/preview.server";
import { conflictMessage, findRuleConflict } from "../lib/templates/rule-conflicts.server";
import { ruleFromForm, settingsFromForm } from "../lib/templates/template-form.server";
import {
  createTemplate,
  deleteTemplate,
  describeRule,
  listVersions,
  orderByPrecedence,
  parseAssignmentRule,
  parseTemplateSettings,
  restoreVersion,
  saveTemplate,
  templatesForType,
} from "../lib/templates/templates.server";
import { DOCUMENT_TYPE_LABELS, FONT_CHOICES } from "../lib/templates/template-constants";
import { DOCUMENT_TYPES, type DocumentType } from "../lib/types";
import editorStyles from "../styles/templates.css?url";
import { Btn } from "../components/ui";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: editorStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);

  const groups: TemplateGroup[] = [];
  const all: Array<{ id: string; name: string; documentType: DocumentType; assignmentRuleJson: string; createdAt: Date }> = [];
  for (const type of DOCUMENT_TYPES) {
    const templates = orderByPrecedence(await templatesForType(shop.id, type));
    all.push(...templates.map((t) => ({ id: t.id, name: t.name, documentType: type, assignmentRuleJson: t.assignmentRuleJson, createdAt: t.createdAt })));
    groups.push({
      type,
      label: DOCUMENT_TYPE_LABELS[type],
      templates: templates.map((t, index) => {
        const rule = describeRule(parseAssignmentRule(t.assignmentRuleJson));
        return { id: t.id, name: t.name, rule, isCatchAll: rule === "All orders", rank: index + 1 };
      }),
    });
  }

  const requested = url.searchParams.get("template");
  const selectedId = all.some((t) => t.id === requested) ? requested! : all[0].id;
  const template = await prisma.template.findFirstOrThrow({ where: { id: selectedId, shopId: shop.id } });
  const type = template.documentType as DocumentType;

  const [versions, orders, defaultOrder, count] = await Promise.all([
    listVersions(shop.id, template.id),
    listPreviewOrders(shop.id),
    pickPreviewOrder(shop.id),
    prisma.template.count({ where: { shopId: shop.id, active: true } }),
  ]);
  const siblings = all
    .filter((t) => t.documentType === type && t.id !== template.id)
    .map((t) => ({ id: t.id, name: t.name, rule: parseAssignmentRule(t.assignmentRuleJson), createdAt: t.createdAt.toISOString() }));

  return {
    groups,
    template: {
      id: template.id,
      name: template.name,
      type,
      typeLabel: DOCUMENT_TYPE_LABELS[type],
      version: template.version,
      updatedAt: template.updatedAt.toISOString(),
      createdAt: template.createdAt.toISOString(),
      settings: parseTemplateSettings(template.settingsJson),
      rule: parseAssignmentRule(template.assignmentRuleJson),
      canDelete: siblings.length > 0,
    },
    siblings,
    fonts: FONT_CHOICES,
    versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), rule: describeRule(parseAssignmentRule(v.assignmentRuleJson)) })),
    orders,
    defaultOrderId: defaultOrder?.id ?? null,
    timezone: shop.timezone,
    planName: getPlan(shop.plan).name,
    canCreate: canCreateAnother(shop.plan, "templates", count),
  };
};

interface ActionResult {
  ok: boolean;
  message?: string;
  html?: string;
  sample?: boolean;
  orderName?: string;
  previewLabel?: string;
}

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const { shop, admin } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const type = String(form.get("documentType") ?? "");
    if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) return { ok: false, message: "Choose a document type." };
    const result = await createTemplate(shop.id, shop.plan, type as DocumentType, String(form.get("name") ?? ""));
    if (!result.ok) {
      return {
        ok: false,
        message: result.reason === "plan" ? "Your plan includes one template per document type. See Plans & billing to add more." : "Give the template a name of up to 60 characters.",
      };
    }
    return redirect(`/app/templates?template=${result.template.id}`);
  }

  const template = await prisma.template.findFirst({ where: { id: String(form.get("templateId") ?? ""), shopId: shop.id, active: true } });
  if (!template) return { ok: false, message: "This template no longer exists. Pick another one from the list." };
  const type = template.documentType as DocumentType;
  const typeLabel = DOCUMENT_TYPE_LABELS[type];
  const current = parseTemplateSettings(template.settingsJson);
  const orderId = String(form.get("orderId") ?? "") || null;
  const preview = (settings: ReturnType<typeof parseTemplateSettings>) =>
    renderPreview({ shopId: shop.id, timezone: shop.timezone, template, settings, orderId, client: admin });

  switch (intent) {
    case "preview": {
      const result = await preview(settingsFromForm(form, current));
      return { ok: true, html: result.html, sample: result.sample, orderName: result.orderName, previewLabel: "Preview" };
    }
    case "previewVersion": {
      const version = Number(form.get("version"));
      const stored = await prisma.templateVersion.findUnique({ where: { templateId_version: { templateId: template.id, version } } });
      if (!stored) return { ok: false, message: `Version ${version} does not exist.` };
      const result = await preview(parseTemplateSettings(stored.settingsJson));
      return { ok: true, html: result.html, sample: result.sample, orderName: result.orderName, previewLabel: `Version ${version}` };
    }
    case "save": {
      const rule = ruleFromForm(form);
      const conflict = await findRuleConflict(shop.id, type, rule, template.id);
      if (conflict) return { ok: false, message: `Not saved: ${conflictMessage(conflict, rule, typeLabel)}` };
      const saved = await saveTemplate(shop.id, template.id, { name: String(form.get("name") ?? ""), settings: settingsFromForm(form, current), rule });
      return {
        ok: true,
        message:
          saved.version === template.version
            ? "Nothing changed, so no new version was saved."
            : `Saved as version ${saved.version}. Documents printed from now on use it; already printed PDFs are unchanged.`,
      };
    }
    case "restore": {
      const version = Number(form.get("version"));
      const stored = await prisma.templateVersion.findUnique({ where: { templateId_version: { templateId: template.id, version } } });
      if (!stored) return { ok: false, message: `Version ${version} does not exist.` };
      const rule = parseAssignmentRule(stored.assignmentRuleJson);
      const conflict = await findRuleConflict(shop.id, type, rule, template.id);
      if (conflict) return { ok: false, message: `Version ${version} was not restored: ${conflictMessage(conflict, rule, typeLabel)}` };
      const restored = await restoreVersion(shop.id, template.id, version);
      return { ok: true, message: `Restored version ${version} as version ${restored.version}.` };
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

function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

export default function TemplatesPage() {
  const data = useLoaderData<typeof loader>();
  const { template, groups, siblings, versions, orders, timezone } = data;
  const saver = useFetcher<ActionResult>();
  const previewer = useFetcher<ActionResult>();
  const creator = useFetcher<ActionResult>();
  const formRef = useRef<HTMLFormElement>(null);
  const leaveModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const versionsModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const pickModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const newNameRef = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const newTypeRef = useRef<HTMLElementTagNameMap["s-select"]>(null);
  const newModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const pickListRef = useRef<HTMLElementTagNameMap["s-choice-list"]>(null);

  const [orderId, setOrderId] = useState<string | null>(data.defaultOrderId);
  const [html, setHtml] = useState("");
  const [sample, setSample] = useState(false);
  const [orderName, setOrderName] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState("Current version");

  const requestPreview = useCallback(
    (override?: Record<string, string>) => {
      if (!formRef.current) return;
      const form = new FormData(formRef.current);
      form.set("intent", "preview");
      form.set("templateId", template.id);
      form.set("orderId", orderId ?? "");
      for (const [k, v] of Object.entries(override ?? {})) form.set(k, v);
      previewer.submit(form, { method: "post" });
    },
    [orderId, previewer, template.id],
  );

  const loadedKey = `${template.id}:${template.version}`;
  const draft = useTemplateDraft({ formRef, loadedKey, onPreview: requestPreview });

  // First preview, and again whenever the template, its version or the order changes.
  useEffect(() => {
    const handle = setTimeout(() => requestPreview(), 60);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, orderId]);

  useEffect(() => {
    if (previewer.state === "idle" && previewer.data?.html) {
      setHtml(previewer.data.html);
      setSample(Boolean(previewer.data.sample));
      setOrderName(previewer.data.orderName ?? null);
      setPreviewLabel(previewer.data.previewLabel ?? "Preview");
    }
  }, [previewer.state, previewer.data]);

  // A successful create redirects to the new template; the modal is still mounted, so close it.
  useEffect(() => {
    newModalRef.current?.hideOverlay();
  }, [template.id]);

  // Leaving with unsaved edits opens the confirmation instead of navigating.
  useEffect(() => {
    if (draft.blocker.state === "blocked") leaveModalRef.current?.showOverlay();
  }, [draft.blocker.state]);

  const save = () => {
    if (!formRef.current) return;
    const form = new FormData(formRef.current);
    form.set("intent", "save");
    form.set("templateId", template.id);
    saver.submit(form, { method: "post" });
  };

  useNativeEvent(
    pickListRef,
    "change",
    useCallback((event: Event) => {
      const list = event.target as HTMLElementTagNameMap["s-choice-list"];
      const chosen = list.values?.[0];
      if (chosen) {
        setOrderId(chosen);
        pickModalRef.current?.hideOverlay();
      }
    }, []),
  );

  const busy = saver.state !== "idle";
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <s-page heading="Templates" inlineSize="large">
      <Btn slot="primary-action" variant="primary" commandFor="new-template" command="--show">
        New template
      </Btn>

      {saver.data?.message && saver.state === "idle" ? (
        <s-banner tone={saver.data.ok ? "success" : "critical"} heading={saver.data.ok ? undefined : "Not saved"}>
          <s-paragraph>{saver.data.message}</s-paragraph>
        </s-banner>
      ) : null}
      {previewer.data && !previewer.data.ok && previewer.state === "idle" ? (
        <s-banner tone="critical"><s-paragraph>{previewer.data.message}</s-paragraph></s-banner>
      ) : null}

      <div className="pf-editor">
          <TemplateList
            groups={groups}
            selectedId={template.id}
            version={template.version}
            savedLabel={relativeTime(template.updatedAt)}
            hasHistory={versions.length > 1}
            onRestore={() => versionsModalRef.current?.showOverlay()}
          />
          <PreviewPane
            name={template.name}
            html={html}
            loading={previewer.state !== "idle"}
            orderName={orderName}
            sample={sample}
            previewLabel={previewLabel}
            dirty={draft.dirty}
            saving={busy}
            hasOrders={orders.length > 0}
            onSave={save}
          />
          <form ref={formRef} onSubmit={(e) => e.preventDefault()} key={loadedKey}>
            <SettingsPane
              template={template}
              fonts={data.fonts}
              siblings={siblings}
              onChanged={draft.markChanged}
              busy={busy}
              onDelete={() => saver.submit({ intent: "delete", templateId: template.id }, { method: "post" })}
            />
          </form>
      </div>

      {/* New template */}
      <s-modal id="new-template" heading="New template" ref={newModalRef}>
        {data.canCreate ? (
          <>
            <s-stack gap="base">
              <s-select ref={newTypeRef} label="Document type" value="INVOICE">
                {DOCUMENT_TYPES.map((type) => (
                  <s-option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</s-option>
                ))}
              </s-select>
              <s-text-field ref={newNameRef} label="Name" placeholder="Invoice — Japan"></s-text-field>
              {creator.data && !creator.data.ok ? <s-paragraph tone="critical">{creator.data.message}</s-paragraph> : null}
            </s-stack>
            <Btn
              slot="primary-action"
              variant="primary"
              disabled={creator.state !== "idle" || undefined}
              onClick={() => creator.submit({ intent: "create", documentType: newTypeRef.current?.value ?? "INVOICE", name: newNameRef.current?.value ?? "" }, { method: "post" })}
            >
              Create
            </Btn>
            <Btn slot="secondary-actions" commandFor="new-template" command="--hide">Cancel</Btn>
          </>
        ) : (
          <>
            <s-paragraph>
              Your {data.planName} plan includes one template per document type: one invoice, one packing slip and one pick list.
              Premium and Unlimited add templates per country or tag, so a Japanese invoice or a B2B invoice can print differently.
            </s-paragraph>
            <Btn slot="primary-action" variant="primary" href="/app/billing">See plans</Btn>
            <Btn slot="secondary-actions" commandFor="new-template" command="--hide">Not now</Btn>
          </>
        )}
      </s-modal>

      {/* Versions */}
      <s-modal id="versions-modal" heading="Previous versions" ref={versionsModalRef}>
        <s-stack gap="small">
          <s-paragraph color="subdued">The last ten saves. Preview one in the centre pane before restoring; restoring writes it as a new version, so nothing is lost.</s-paragraph>
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
                  <s-table-cell>{when(v.createdAt)}</s-table-cell>
                  <s-table-cell>{v.rule}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <Btn variant="tertiary" onClick={() => { previewer.submit({ intent: "previewVersion", templateId: template.id, version: String(v.version), orderId: orderId ?? "" }, { method: "post" }); versionsModalRef.current?.hideOverlay(); }}>
                        Preview
                      </Btn>
                      {v.version !== template.version ? (
                        <Btn variant="tertiary" disabled={busy || undefined} onClick={() => { saver.submit({ intent: "restore", templateId: template.id, version: String(v.version) }, { method: "post" }); versionsModalRef.current?.hideOverlay(); }}>
                          Restore
                        </Btn>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
        <Btn slot="secondary-actions" commandFor="versions-modal" command="--hide">Close</Btn>
      </s-modal>

      {/* Order picker */}
      <s-modal id="pick-order-modal" heading="Preview another order" ref={pickModalRef}>
        <s-stack gap="small">
          <s-paragraph color="subdued">Hardest layouts first: most line items, then the longest product title.</s-paragraph>
          <s-choice-list ref={pickListRef} label="Order" labelAccessibilityVisibility="exclusive" values={orderId ? [orderId] : []}>
            {orders.map((o) => (
              <s-choice key={o.id} value={o.id}>
                {o.orderName} · {o.customerName ?? "Guest"}{o.countryCode ? ` · ${o.countryCode}` : ""} · {o.itemCount} {o.itemCount === 1 ? "item" : "items"}
                <s-text slot="details">Longest title {o.longestTitle} characters</s-text>
              </s-choice>
            ))}
          </s-choice-list>
        </s-stack>
        <Btn slot="secondary-actions" commandFor="pick-order-modal" command="--hide">Close</Btn>
      </s-modal>

      {/* Unsaved changes */}
      <s-modal id="leave-modal" heading="Discard unsaved changes?" ref={leaveModalRef}>
        <s-paragraph>You changed {template.name} and did not save. Leave now and those edits are gone.</s-paragraph>
        <Btn slot="primary-action" variant="primary" tone="critical" onClick={() => { leaveModalRef.current?.hideOverlay(); draft.blocker.proceed?.(); }}>
          Discard and leave
        </Btn>
        <Btn slot="secondary-actions" onClick={() => { leaveModalRef.current?.hideOverlay(); draft.blocker.reset?.(); }}>
          Keep editing
        </Btn>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
