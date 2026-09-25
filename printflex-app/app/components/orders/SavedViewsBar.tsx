import { useRef } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import type { SavedViewItem } from "../../lib/orders/saved-views.server";
import { Btn } from "../ui";

interface Props {
  views: SavedViewItem[];
  activeQuery: string;
  hasFilters: boolean;
  canSave: boolean;
  planName: string;
}

interface SaveResult {
  ok: boolean;
  message: string;
  query?: string;
}

/**
 * Views as tabs across the top of the orders card, like Shopify's own index
 * pages. The active view is the one whose query matches the URL exactly.
 * "Save this view" appears once filters differ from every saved view; the
 * plan limit is explained only when the merchant reaches for it.
 */
export function SavedViewsBar({ views, activeQuery, hasFilters, canSave, planName }: Props) {
  const navigate = useNavigate();
  const fetcher = useFetcher<SaveResult>();
  const nameRef = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const modalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);

  const active = views.find((v) => v.query === activeQuery);
  const busy = fetcher.state !== "idle";

  const submitSave = () => {
    const name = nameRef.current?.value ?? "";
    fetcher.submit({ intent: "saveView", name, query: activeQuery }, { method: "post" });
  };

  if (fetcher.data?.ok && fetcher.state === "idle" && fetcher.data.query !== undefined) {
    // Saved: close the modal and land on the new view.
    modalRef.current?.hideOverlay();
    const target = `/app/orders${fetcher.data.query ? `?${fetcher.data.query}` : ""}`;
    fetcher.data = undefined;
    void navigate(target);
  }

  return (
    <>
      <nav className="pf-views" aria-label="Views">
        {views.map((view) => {
          const isActive = active?.id === view.id;
          return (
            <Link
              key={view.id}
              to={`/app/orders${view.query ? `?${view.query}` : ""}`}
              className="pf-views__tab"
              aria-current={isActive ? "page" : undefined}
            >
              {view.name}
            </Link>
          );
        })}
        {(active && !active.builtIn) || (hasFilters && !active) ? (
          <span className="pf-views__actions">
            {active && !active.builtIn ? (
              <Btn
                variant="tertiary"
                tone="critical"
                icon="delete"
                aria-label={`Delete view ${active.name}`}
                disabled={busy || undefined}
                onClick={() => fetcher.submit({ intent: "deleteView", viewId: active.id }, { method: "post" })}
              >
                Delete view
              </Btn>
            ) : null}
            {hasFilters && !active ? (
              <Btn variant="tertiary" icon="plus" commandFor="save-view-modal" command="--show">
                Save this view
              </Btn>
            ) : null}
          </span>
        ) : null}
      </nav>

      <s-modal id="save-view-modal" heading="Save this view" ref={modalRef}>
        {canSave ? (
          <>
            <s-stack gap="base">
              <s-paragraph>The current filters will be saved under this name and appear as a tab next to the built-in views.</s-paragraph>
              <s-text-field ref={nameRef} label="View name" placeholder="Morning batch"></s-text-field>
              {fetcher.data && !fetcher.data.ok ? <s-paragraph tone="critical">{fetcher.data.message}</s-paragraph> : null}
            </s-stack>
            <Btn slot="primary-action" variant="primary" disabled={busy || undefined} onClick={submitSave}>
              Save view
            </Btn>
            <Btn slot="secondary-actions" commandFor="save-view-modal" command="--hide">
              Cancel
            </Btn>
          </>
        ) : (
          <>
            <s-paragraph>
              Your {planName} plan includes the four built-in views. Saving your own views is part of Premium and Unlimited. Your current filters stay in the
              page address, so you can bookmark this page in the meantime.
            </s-paragraph>
            <Btn slot="primary-action" variant="primary" href="/app/billing">
              See plans
            </Btn>
            <Btn slot="secondary-actions" commandFor="save-view-modal" command="--hide">
              Not now
            </Btn>
          </>
        )}
      </s-modal>
    </>
  );
}
