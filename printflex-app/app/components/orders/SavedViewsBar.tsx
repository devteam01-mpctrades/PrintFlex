import { useRef } from "react";
import { useFetcher, useNavigate } from "react-router";
import type { SavedViewItem } from "../../lib/orders/saved-views.server";

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
    <s-section heading="Saved views" padding="base">
      <s-stack direction="inline" gap="small" alignItems="center">
        {views.map((view) => (
          <s-button
            key={view.id}
            href={`/app/orders${view.query ? `?${view.query}` : ""}`}
            variant={active?.id === view.id ? "primary" : "tertiary"}
          >
            {view.name}
          </s-button>
        ))}
        {active && !active.builtIn ? (
          <s-button
            variant="tertiary"
            tone="critical"
            disabled={busy || undefined}
            onClick={() => fetcher.submit({ intent: "deleteView", viewId: active.id }, { method: "post" })}
          >
            Delete view
          </s-button>
        ) : null}
        {hasFilters && !active ? (
          <s-button
            variant="secondary"
            commandFor="save-view-modal"
            command="--show"
            disabled={!canSave || undefined}
          >
            Save this view
          </s-button>
        ) : null}
      </s-stack>
      {!canSave ? (
        <s-paragraph color="subdued">
          Your {planName} plan includes the three built-in views. Saved views are on Premium and
          Unlimited.
        </s-paragraph>
      ) : null}

      <s-modal id="save-view-modal" heading="Save this view" ref={modalRef}>
        <s-stack gap="base">
          <s-paragraph>
            The current filters will be saved under this name and appear next to the built-in views.
          </s-paragraph>
          <s-text-field ref={nameRef} label="View name" placeholder="Morning batch"></s-text-field>
          {fetcher.data && !fetcher.data.ok ? (
            <s-paragraph tone="critical">{fetcher.data.message}</s-paragraph>
          ) : null}
        </s-stack>
        <s-button slot="primary-action" variant="primary" disabled={busy || undefined} onClick={submitSave}>
          Save view
        </s-button>
        <s-button slot="secondary-actions" commandFor="save-view-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-section>
  );
}
