import type React from "react";
import { useState } from "react";
import { Link } from "react-router";
import { Btn } from "../ui";

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
  /** Opens the New template dialog. (A title-bar action would not show: the admin ignores non-Polaris buttons there.) */
  onNew: () => void;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  INVOICE: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 9h6M9 13h6M9 17h4" /></>,
  PACKING_SLIP: <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9" />,
  PICK_LIST: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></>,
};

/**
 * The left pane: every template grouped by document type, because
 * precedence is resolved per type. Selecting a row changes the URL's
 * `template` param; the route reloads only its data, not the page.
 * Kept narrow on purpose so the preview gets the width.
 */
export function TemplateList({ groups, selectedId, version, savedLabel, hasHistory, onRestore, onNew }: Props) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <nav className="pf-tlist" aria-label="Templates">
      <div className="pf-tlist__h">
        <h2>Templates</h2>
        <Btn variant="secondary" icon="plus" className="pf-tlist__new" onClick={onNew}>New</Btn>
      </div>

      <div className="pf-tlist__groups">
        {groups.map((group) => (
          <div key={group.type} className="pf-tlist__group">
            <h3 className="pf-tlist__kicker">
              <span className="pf-tlist__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{TYPE_ICON[group.type]}</svg>
              </span>
              {group.label}
              <span className="pf-tlist__count">{group.templates.length}</span>
            </h3>
            <ul className="pf-tlist__rows">
              {group.templates.map((t) => {
                const selected = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <Link to={`/app/templates?template=${t.id}`} className={`pf-tlist__row${selected ? " is-selected" : ""}`} aria-current={selected ? "page" : undefined}>
                      <span className="pf-tlist__text">
                        <span className="pf-tlist__name">{t.name}</span>
                        <span className="pf-tlist__rule">{t.rule}</span>
                      </span>
                      <span className={`pf-tlist__badge${t.isCatchAll ? "" : " is-rank"}`} title={t.isCatchAll ? "Used when no other rule matches" : `Checked ${t.rank === 1 ? "first" : `in position ${t.rank}`}`}>
                        {t.isCatchAll ? "Fallback" : `#${t.rank}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="pf-tlist__help">
        <button type="button" className="pf-tlist__helpbtn" aria-expanded={showHelp} onClick={() => setShowHelp((v) => !v)}>
          <span>How precedence works</span>
          <span aria-hidden="true">{showHelp ? "▴" : "▾"}</span>
        </button>
        {showHelp ? (
          <p className="pf-tlist__helptext">
            For each document type, PrintFlex walks the templates in the order shown and uses the first whose rule matches the order.
            A rule with a tag beats one without; then a rule with a country beats one without; then more conditions beat fewer; then
            the older template wins. The &ldquo;All orders&rdquo; template is always last, so every order prints.
          </p>
        ) : null}
      </div>

      <div className="pf-tlist__f">
        <span className="pf-tlist__version">Version {version} · saved {savedLabel}</span>
        <Btn variant="tertiary" className="pf-tlist__restore" disabled={!hasHistory || undefined} onClick={onRestore}>
          Restore a previous version
        </Btn>
      </div>
    </nav>
  );
}
