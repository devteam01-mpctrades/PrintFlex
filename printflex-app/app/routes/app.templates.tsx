import { useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RouteError } from "../components/RouteError";
import prisma from "../db.server";
import { canCreateAnother, getPlan } from "../lib/plans.server";
import { requireShop } from "../lib/request.server";
import {
  createTemplate,
  describeRule,
  orderByPrecedence,
  parseAssignmentRule,
  templatesForType,
} from "../lib/templates/templates.server";
import { DOCUMENT_TYPE_LABELS } from "../lib/templates/template-constants";
import { DOCUMENT_TYPES, type DocumentType } from "../lib/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const groups = [];
  for (const type of DOCUMENT_TYPES) {
    const templates = orderByPrecedence(await templatesForType(shop.id, type));
    groups.push({
      type,
      label: DOCUMENT_TYPE_LABELS[type],
      templates: templates.map((t, index) => ({
        id: t.id,
        name: t.name,
        rule: describeRule(parseAssignmentRule(t.assignmentRuleJson)),
        isCatchAll: describeRule(parseAssignmentRule(t.assignmentRuleJson)) === "All orders",
        version: t.version,
        updatedAt: t.updatedAt.toISOString(),
        rank: index + 1,
      })),
    });
  }
  const count = await prisma.template.count({ where: { shopId: shop.id, active: true } });
  return {
    groups,
    timezone: shop.timezone,
    planName: getPlan(shop.plan).name,
    canCreate: canCreateAnother(shop.plan, "templates", count),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const type = String(form.get("documentType") ?? "");
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) return { ok: false, message: "Choose a document type." };
  const result = await createTemplate(shop.id, shop.plan, type as DocumentType, String(form.get("name") ?? ""));
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "plan"
          ? "Your plan includes one template. Upgrade on Plans & billing to add more."
          : "Give the template a name of up to 60 characters.",
    };
  }
  return redirect(`/app/templates/${result.template.id}`);
};

export default function TemplatesPage() {
  const { groups, timezone, planName, canCreate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const nameRef = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const typeRef = useRef<HTMLElementTagNameMap["s-select"]>(null);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <s-page heading="Templates">
      <s-button slot="primary-action" variant="primary" commandFor="new-template" command="--show" disabled={!canCreate || undefined}>
        New template
      </s-button>

      {!canCreate ? (
        <s-banner tone="info">
          <s-paragraph>
            Your {planName} plan includes one template. Premium and Unlimited add templates per country, market or tag.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="How templates are chosen">
        <s-paragraph>
          For each document type, PrintFlex walks the templates in the order shown and uses the first whose rule matches
          the order. A rule with a tag beats one without; then a rule with a country beats one without; then more conditions
          beat fewer; then the older template wins. The &ldquo;All orders&rdquo; template is always last, so every order prints.
        </s-paragraph>
      </s-section>

      {groups.map((group) => (
        <s-section key={group.type} heading={group.label}>
          <s-table>
            <s-table-header-row>
              <s-table-header>Precedence</s-table-header>
              <s-table-header listSlot="primary">Template</s-table-header>
              <s-table-header>Applies to</s-table-header>
              <s-table-header format="numeric">Version</s-table-header>
              <s-table-header>Updated</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {group.templates.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>
                    <s-badge tone={t.isCatchAll ? "neutral" : "info"}>{t.isCatchAll ? "Fallback" : `${t.rank}`}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={`/app/templates/${t.id}`}>{t.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>{t.rule}</s-table-cell>
                  <s-table-cell><s-text fontVariantNumeric="tabular-nums">{t.version}</s-text></s-table-cell>
                  <s-table-cell>{when(t.updatedAt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ))}

      <s-modal id="new-template" heading="New template">
        <s-stack gap="base">
          <s-select ref={typeRef} label="Document type" value="INVOICE">
            {DOCUMENT_TYPES.map((type) => (
              <s-option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</s-option>
            ))}
          </s-select>
          <s-text-field ref={nameRef} label="Name" placeholder="Invoice — Japan"></s-text-field>
          {fetcher.data && !fetcher.data.ok ? <s-paragraph tone="critical">{fetcher.data.message}</s-paragraph> : null}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={fetcher.state !== "idle" || undefined}
          onClick={() =>
            fetcher.submit(
              { documentType: typeRef.current?.value ?? "INVOICE", name: nameRef.current?.value ?? "" },
              { method: "post" },
            )
          }
        >
          Create
        </s-button>
        <s-button slot="secondary-actions" commandFor="new-template" command="--hide">Cancel</s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return <RouteError />;
}
