import { useState } from "react";
import { Link } from "react-router";

export interface TemplateListItem {
  id: string;
  name: string;
  rule: string;
  isCatchAll: boolean;
  rank: number;
}

export interface TemplateGroup {
  type: string;
  label: string;
  templates: TemplateListItem[];
}

interface Props {
  groups: TemplateGroup[];
  selectedId: string;
  /** Footer for the selected template. */
  version: number;
  savedLabel: string;
  hasHistory: boolean;
  onRestore: () => void;
}

/**
 * The left pane: every template grouped by document type, because
 * precedence is resolved per type. Selecting a row changes the URL's
 * `template` param; the route reloads only its data, not the page.
 */
export function TemplateList({ groups, selectedId, version, savedLabel, hasHistory, onRestore }: Props) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <s-section padding="none" accessibilityLabel="Templates">
      <s-box padding="base" paddingBlockEnd="small">
        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-heading>Templates</s-heading>
          <s-button variant="tertiary" icon={showHelp ? "chevron-up" : "chevron-down"} onClick={() => setShowHelp((v) => !v)}>
            How precedence works
          </s-button>
        </s-stack>
        {showHelp ? (
          <s-box paddingBlockStart="small">
            <s-paragraph color="subdued">
              For each document type, PrintFlex walks the templates in the order shown and uses the first whose rule matches the
              order. A rule with a tag beats one without; then a rule with a country beats one without; then more conditions beat
              fewer; then the older template wins. The &ldquo;All orders&rdquo; template is always last, so every order prints.
            </s-paragraph>
          </s-box>
        ) : null}
      </s-box>

      {groups.map((group) => (
        <s-box key={group.type} paddingInline="base" paddingBlockEnd="small">
          <s-box paddingBlock="small-200">
            <s-text color="subdued" type="strong">{group.label}</s-text>
          </s-box>
          <s-stack gap="small-200">
            {group.templates.map((t) => {
              const selected = t.id === selectedId;
              return (
                <Link
                  key={t.id}
                  to={`/app/templates?template=${t.id}`}
                  aria-current={selected ? "true" : undefined}
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <s-box
                    padding="small"
                    borderRadius="base"
                    background={selected ? "subdued" : "transparent"}
                    borderWidth={selected ? "small-100" : "none"}
                    borderColor="base"
                  >
                    <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                      <s-stack gap="none">
                        <s-text type="strong">{t.name}</s-text>
                        <s-text color="subdued">{t.rule}</s-text>
                      </s-stack>
                      <s-badge tone={t.isCatchAll ? "neutral" : "info"}>{t.isCatchAll ? "Fallback" : `${t.rank}`}</s-badge>
                    </s-stack>
                  </s-box>
                </Link>
              );
            })}
          </s-stack>
        </s-box>
      ))}

      <s-divider></s-divider>
      <s-box padding="base">
        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-text color="subdued" fontVariantNumeric="tabular-nums">Version {version} · saved {savedLabel}</s-text>
          <s-button variant="tertiary" disabled={!hasHistory || undefined} onClick={onRestore}>
            Restore a previous version
          </s-button>
        </s-stack>
      </s-box>
    </s-section>
  );
}
