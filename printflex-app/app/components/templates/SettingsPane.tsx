import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNativeEvent } from "../orders/useNativeEvent";
import { describeRank, previewRank, type AssignmentRule, type RankedTemplate } from "../../lib/templates/rules";
import {
  ACCENT_SWATCHES,
  FIELD_LABELS,
  FIELDS_BY_TYPE,
  MAX_LOGO_BYTES,
  MAX_LOGO_LABEL,
  TOGGLES_BY_TYPE,
  type TemplateSettings,
} from "../../lib/templates/template-constants";
import type { DocumentType } from "../../lib/types";
import { Btn, Switch } from "../ui";

export interface SettingsTemplate {
  id: string;
  name: string;
  type: DocumentType;
  typeLabel: string;
  createdAt: string;
  settings: TemplateSettings;
  rule: AssignmentRule;
  canDelete: boolean;
}

interface Props {
  template: SettingsTemplate;
  fonts: readonly string[];
  siblings: Array<RankedTemplate & { name: string }>;
  /** Whether the plan includes per-market (ships-to-country) rules. */
  perMarket: boolean;
  /** Called after a change that fires no form event (logo, swatch). */
  onChanged: () => void;
  onDelete: () => void;
  busy: boolean;
}

type RuleKind = "all" | "country" | "tag" | "both";

function kindOf(rule: AssignmentRule): RuleKind {
  if (rule.countries.length && rule.tags.length) return "both";
  if (rule.countries.length) return "country";
  if (rule.tags.length) return "tag";
  return "all";
}

function parseList(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * The right pane. Every control is a form-associated field inside the form
 * the route owns, so settingsFromForm on the server reads exactly what is
 * shown here. Only toggles that drive a branch in this document type's
 * render are shown.
 */
export function SettingsPane({ template, fonts, siblings, perMarket, onChanged, onDelete, busy }: Props) {
  const s = template.settings;
  const [logo, setLogo] = useState<string | null>(s.logoUrl);
  const [logoAction, setLogoAction] = useState<"keep" | "set" | "remove">("keep");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [kind, setKind] = useState<RuleKind>(kindOf(template.rule));
  const [countries, setCountries] = useState(template.rule.countries.join(", "));
  const [tags, setTags] = useState(template.rule.tags.join(", "));
  const [accent, setAccent] = useState(s.accentColor);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const colorRef = useRef<HTMLElementTagNameMap["s-color-field"]>(null);
  const kindRef = useRef<HTMLElementTagNameMap["s-select"]>(null);
  const countriesRef = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const tagsRef = useRef<HTMLElementTagNameMap["s-text-field"]>(null);

  const acceptLogoFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) {
        setLogoError("That file is not a PNG, JPEG or SVG.");
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        setLogoError(`This file is ${Math.round(file.size / 1024)} KB. Logos must be under ${MAX_LOGO_LABEL}; export a smaller PNG or an SVG.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setLogo(String(reader.result));
        setLogoAction("set");
        setLogoError(null);
        onChanged();
      };
      reader.readAsDataURL(file);
    },
    [onChanged],
  );

  // The drop zone only exists while there is no logo, so it is tracked in
  // state rather than a ref: the listener must attach whenever it mounts.
  const [dropZone, setDropZone] = useState<HTMLElementTagNameMap["s-drop-zone"] | null>(null);
  useEffect(() => {
    if (!dropZone) return;
    const listener = () => acceptLogoFile(dropZone.files?.[0]);
    dropZone.addEventListener("change", listener);
    return () => dropZone.removeEventListener("change", listener);
  }, [dropZone, acceptLogoFile]);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useNativeEvent(kindRef, "change", useCallback((e: Event) => setKind((e.target as HTMLElementTagNameMap["s-select"]).value as RuleKind), []));
  useNativeEvent(countriesRef, "input", useCallback((e: Event) => setCountries((e.target as HTMLElementTagNameMap["s-text-field"]).value), []));
  useNativeEvent(tagsRef, "input", useCallback((e: Event) => setTags((e.target as HTMLElementTagNameMap["s-text-field"]).value), []));
  useNativeEvent(colorRef, "input", useCallback((e: Event) => setAccent((e.target as HTMLElementTagNameMap["s-color-field"]).value), []));

  const pickSwatch = (hex: string) => {
    setAccent(hex);
    if (colorRef.current) colorRef.current.value = hex;
    onChanged();
  };

  const draftRule = useMemo<AssignmentRule>(() => {
    const c = kind === "country" || kind === "both" ? parseList(countries).map((x) => x.toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)) : [];
    const t = kind === "tag" || kind === "both" ? parseList(tags) : [];
    return { countries: c, tags: t };
  }, [kind, countries, tags]);
  const rank = useMemo(() => previewRank({ id: template.id, rule: draftRule, createdAt: template.createdAt }, siblings), [template.id, template.createdAt, draftRule, siblings]);
  const needsValue = (kind === "country" || kind === "both") && draftRule.countries.length === 0 ? "country" : (kind === "tag" || kind === "both") && draftRule.tags.length === 0 ? "tag" : null;

  const toggles = TOGGLES_BY_TYPE[template.type];
  const primaryFieldKeys = new Set(toggles.flatMap((t) => (t.kind === "field" ? [t.key] : [])));
  const advancedFields = FIELDS_BY_TYPE[template.type].filter((key) => !primaryFieldKeys.has(key));

  const toggle = (name: string, checked: boolean, label: string, details?: string) => (
    <s-box key={name}>
      <input type="hidden" name={`${name}.present`} value="1" />
      <Switch name={name} value="on" defaultChecked={checked} label={label} details={details} />
    </s-box>
  );

  return (
    <s-section padding="none" accessibilityLabel="Settings">
      <s-box padding="base">
        <s-heading>Settings</s-heading>
      </s-box>
      <s-divider></s-divider>
      <s-box padding="base">
        <s-stack gap="large">
          <s-text-field name="name" label="Template name" value={template.name}></s-text-field>

          {/* Logo */}
          <s-stack gap="small">
            <input type="hidden" name="logoAction" value={logoAction} />
            <input type="hidden" name="logoDataUrl" value={logoAction === "set" && logo ? logo : ""} />
            {logo ? (
              <>
                <s-text type="strong">Logo</s-text>
                <div className="pf-logo">
                  <div className="pf-logo__tile"><img src={logo} alt="Current logo" /></div>
                  <div className="pf-logo__body">
                    <span className="pf-logo__title">{logoAction === "set" ? "New logo, not saved yet" : "Current logo"}</span>
                    <span className="pf-logo__hint">Printed up to 18 mm tall on every document.</span>
                  </div>
                  <div className="pf-logo__actions">
                    <Btn onClick={() => replaceInputRef.current?.click()}>Replace</Btn>
                    <Btn
                      tone="critical"
                      icon="delete"
                      onClick={() => {
                        setLogo(null);
                        setLogoAction("remove");
                        setLogoError(null);
                        onChanged();
                      }}
                    >
                      Remove
                    </Btn>
                  </div>
                </div>
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  hidden
                  aria-label="Replace logo"
                  onChange={(e) => {
                    acceptLogoFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </>
            ) : (
              <s-drop-zone ref={setDropZone} label="Logo" accept="image/png,image/jpeg,image/svg+xml"></s-drop-zone>
            )}
            {logoError ? (
              <s-text tone="critical">{logoError}</s-text>
            ) : logo ? null : (
              <s-text color="subdued">PNG, JPEG or SVG under {MAX_LOGO_LABEL}. Printed up to 18 mm tall.</s-text>
            )}
          </s-stack>

          {/* Accent colour */}
          <s-stack gap="small">
            <s-text type="strong">Accent colour</s-text>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {ACCENT_SWATCHES.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  title={swatch.name}
                  aria-label={`${swatch.name} ${swatch.hex}`}
                  aria-pressed={accent.toLowerCase() === swatch.hex}
                  onClick={() => pickSwatch(swatch.hex)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: accent.toLowerCase() === swatch.hex ? "2px solid #303030" : "1px solid #d2d2d2",
                    background: swatch.hex,
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
            </s-stack>
            <s-color-field ref={colorRef} name="accentColor" label="Custom colour" labelAccessibilityVisibility="exclusive" value={s.accentColor}></s-color-field>
            <s-text color="subdued">Used for headings and rules on the printed document only.</s-text>
          </s-stack>

          <s-select name="paperSize" label="Paper size" value={s.paperSize}>
            <s-option value="A4">A4</s-option>
            <s-option value="LETTER">US Letter</s-option>
          </s-select>

          {/* Assign to */}
          <s-stack gap="small">
            <s-select ref={kindRef} name="rule.kind" label="Assign to" value={kind}>
              <s-option value="all">All orders</s-option>
              <s-option value="country">{perMarket ? "Ships to country" : "Ships to country · Unlimited plan"}</s-option>
              <s-option value="tag">Orders with a tag</s-option>
              <s-option value="both">{perMarket ? "Tag and ships to country" : "Tag and ships to country · Unlimited plan"}</s-option>
            </s-select>
            {(kind === "country" || kind === "both") && !perMarket ? (
              <s-banner tone="warning">
                <s-paragraph>Per-market template variants are part of the Unlimited plan. This template will not save with a country rule until you upgrade in <s-link href="/app/billing">Plans &amp; billing</s-link>.</s-paragraph>
              </s-banner>
            ) : null}
            {kind === "country" || kind === "both" ? (
              <s-text-field ref={countriesRef} name="rule.countries" label="Countries" value={countries} placeholder="JP, KR" details="Two-letter ISO codes, comma separated."></s-text-field>
            ) : (
              <input type="hidden" name="rule.countries" value="" />
            )}
            {kind === "tag" || kind === "both" ? (
              <s-text-field ref={tagsRef} name="rule.tags" label="Order tags" value={tags} placeholder="b2b, wholesale" details="Any of these tags matches."></s-text-field>
            ) : (
              <input type="hidden" name="rule.tags" value="" />
            )}
            {needsValue ? (
              <s-text tone="critical">Enter at least one {needsValue === "country" ? "country code" : "tag"}, or this template falls back to all orders.</s-text>
            ) : rank.duplicateOf ? (
              <s-text tone="critical">Same rule as &ldquo;{rank.duplicateOf}&rdquo;. Saving will be refused until one of them changes.</s-text>
            ) : (
              <s-text color="subdued">{describeRank(rank, template.typeLabel)}</s-text>
            )}
          </s-stack>

          {/* Toggles */}
          <s-stack gap="small">
            <s-text type="strong">Show on this document</s-text>
            {toggles.map((t) =>
              t.kind === "field"
                ? toggle(`field.${t.key}`, s.fields[t.key], t.label)
                : toggle(`codes.${t.key}`, s.codes[t.key], t.label, t.key === "qr" ? "Opens the order in scan mode" : "Code 128 of the order number"),
            )}
          </s-stack>

          {/* Advanced */}
          <s-stack gap="small">
            <Btn variant="tertiary" icon={showAdvanced ? "chevron-up" : "chevron-down"} onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? "Hide advanced settings" : "Advanced settings"}
            </Btn>
            <div hidden={!showAdvanced}>
              <s-stack gap="base">
                <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                  <s-select name="headingFont" label="Heading font" value={s.headingFont}>
                    {fonts.map((f) => <s-option key={f} value={f}>{f}</s-option>)}
                  </s-select>
                  <s-select name="bodyFont" label="Body font" value={s.bodyFont}>
                    {fonts.map((f) => <s-option key={f} value={f}>{f}</s-option>)}
                  </s-select>
                  <s-select name="density" label="Density" value={s.density}>
                    <s-option value="normal">Normal</s-option>
                    <s-option value="compact">Compact</s-option>
                  </s-select>
                  {template.type !== "PICK_LIST" ? (
                    <s-select name="codes.position" label="Codes position" value={s.codes.position}>
                      <s-option value="footer">Bottom, beside the totals</s-option>
                      <s-option value="header">Top, in the header</s-option>
                    </s-select>
                  ) : null}
                  {template.type !== "PICK_LIST" ? (
                    <s-select name="codes.size" label="Codes size" value={s.codes.size}>
                      <s-option value="small">Small · 15 mm</s-option>
                      <s-option value="medium">Medium · 22 mm</s-option>
                      <s-option value="large">Large · 30 mm</s-option>
                    </s-select>
                  ) : null}
                </s-grid>
                {advancedFields.length ? (
                  <s-stack gap="small">
                    <s-text type="strong">Also show</s-text>
                    {advancedFields.map((key) => toggle(`field.${key}`, s.fields[key], FIELD_LABELS[key]))}
                  </s-stack>
                ) : null}
                {template.type === "INVOICE" ? (
                  <s-stack gap="small">
                    <s-text type="strong">Automatic invoice email</s-text>
                    {toggle("email.enabled", s.email.enabled, "Email the invoice automatically", "Premium and Unlimited. Sent once per order for the chosen moment, with the PDF attached.")}
                    <s-select name="email.trigger" label="Send when" value={s.email.trigger}>
                      <s-option value="creation">The order is created</s-option>
                      <s-option value="payment">The order is paid</s-option>
                      <s-option value="fulfillment">The order is fulfilled</s-option>
                    </s-select>
                  </s-stack>
                ) : null}
                <s-text-area name="footerText" label="Footer text" rows={3} value={s.footerText} placeholder="Legal mentions, return policy, bank details, tax numbers"></s-text-area>
              </s-stack>
            </div>
          </s-stack>

          {template.canDelete ? (
            <s-box paddingBlockStart="small">
              <Btn variant="tertiary" tone="critical" disabled={busy || undefined} onClick={onDelete}>
                Delete this template
              </Btn>
            </s-box>
          ) : null}
        </s-stack>
      </s-box>
    </s-section>
  );
}
