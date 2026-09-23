import { useCallback, useRef, useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { useNativeEvent } from "./useNativeEvent";
import type { SelectionSpec } from "../../lib/orders/list.server";
import type { SelectionSummary } from "./useSelection";

interface Props {
  summary: SelectionSummary;
  spec: SelectionSpec;
  total: number;
  pageRowCount: number;
  allOnPageSelected: boolean;
  fetcher: FetcherWithComponents<unknown>;
  onSelectAllMatching: () => void;
  onClear: () => void;
}

const ACTIONS: Array<{ label: string; documentTypes: string }> = [
  { label: "Print invoices", documentTypes: "INVOICE" },
  { label: "Packing slips", documentTypes: "PACKING_SLIP" },
  { label: "Pick list", documentTypes: "PICK_LIST" },
  { label: "All three", documentTypes: "ALL" },
];

/**
 * Appears inside the orders card as soon as anything is selected. One
 * primary action (Print invoices); everything else is secondary.
 */
export function BulkActionBar(props: Props) {
  const { summary, spec, total, pageRowCount, allOnPageSelected, fetcher } = props;
  const busy = fetcher.state !== "idle";
  const selection = JSON.stringify(spec);
  const [coverSheet, setCoverSheet] = useState(false);
  const barRef = useRef<HTMLElementTagNameMap["s-box"]>(null);
  useNativeEvent(
    barRef,
    "change",
    useCallback((event: Event) => {
      const target = event.target as (HTMLElement & { checked?: boolean }) | null;
      if (target?.tagName.toLowerCase() === "s-checkbox") setCoverSheet(Boolean(target.checked));
    }, []),
  );

  if (summary.count === 0) return null;

  const offerSelectAll = summary.mode === "ids" && allOnPageSelected && total > pageRowCount;
  const countLabel =
    summary.mode === "filter" ? `All ${summary.count} matching this filter selected` : `${summary.count} selected`;

  return (
    <s-box ref={barRef} padding="base" background="subdued">
      <s-stack gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text type="strong" fontVariantNumeric="tabular-nums">{countLabel}</s-text>
          {ACTIONS.map((action) => (
            <s-button
              key={action.documentTypes}
              variant={action.documentTypes === "INVOICE" ? "primary" : "secondary"}
              disabled={busy || undefined}
              onClick={() =>
                fetcher.submit(
                  { intent: "print", documentTypes: action.documentTypes, selection, coverSheet: coverSheet ? "on" : "off" },
                  { method: "post" },
                )
              }
            >
              {action.label}
            </s-button>
          ))}
          <s-button
            variant="secondary"
            disabled={busy || undefined}
            onClick={() => fetcher.submit({ intent: "markPrinted", selection }, { method: "post" })}
          >
            Mark as printed
          </s-button>
          <s-button variant="tertiary" onClick={props.onClear}>
            Clear selection
          </s-button>
        </s-stack>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-checkbox value="coverSheet" label="Add a cover sheet with the batch QR code" checked={coverSheet || undefined}></s-checkbox>
          {offerSelectAll ? (
            <s-button variant="tertiary" onClick={props.onSelectAllMatching}>
              Select all {total} matching this filter, not just this page
            </s-button>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}
