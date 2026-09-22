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
  onExcludePrinted: () => void;
}

const ACTIONS: Array<{ label: string; documentTypes: string }> = [
  { label: "Print invoices", documentTypes: "INVOICE" },
  { label: "Packing slips", documentTypes: "PACKING_SLIP" },
  { label: "Pick list", documentTypes: "PICK_LIST" },
  { label: "All three", documentTypes: "ALL" },
];

export function BulkActionBar(props: Props) {
  const { summary, spec, total, pageRowCount, allOnPageSelected, fetcher } = props;
  const busy = fetcher.state !== "idle";
  const selection = JSON.stringify(spec);
  const [coverSheet, setCoverSheet] = useState(false);
  const optionsRef = useRef<HTMLElementTagNameMap["s-box"]>(null);
  useNativeEvent(
    optionsRef,
    "change",
    useCallback((event: Event) => {
      const target = event.target as (HTMLElement & { checked?: boolean }) | null;
      if (target?.tagName.toLowerCase() === "s-checkbox") setCoverSheet(Boolean(target.checked));
    }, []),
  );

  if (summary.count === 0) return null;

  const offerSelectAll = summary.mode === "ids" && allOnPageSelected && total > pageRowCount;

  return (
    <s-stack gap="base">
      <s-section
        heading={
          summary.mode === "filter"
            ? `All ${summary.count} orders matching this filter selected`
            : `${summary.count} selected`
        }
      >
        <s-stack direction="inline" gap="small" alignItems="center">
          {ACTIONS.map((action) => (
            <s-button
              key={action.documentTypes}
              variant={action.documentTypes === "ALL" ? "primary" : "secondary"}
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
            variant="tertiary"
            disabled={busy || undefined}
            onClick={() => fetcher.submit({ intent: "markPrinted", selection }, { method: "post" })}
          >
            Mark as printed
          </s-button>
          <s-button variant="tertiary" onClick={props.onClear}>
            Clear selection
          </s-button>
        </s-stack>
        <s-box ref={optionsRef} paddingBlockStart="small">
          <s-checkbox
            value="coverSheet"
            label="Add a cover sheet with the batch QR code"
            checked={coverSheet || undefined}
          ></s-checkbox>
        </s-box>
        {offerSelectAll ? (
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text>All {pageRowCount} orders on this page are selected.</s-text>
            <s-button variant="tertiary" onClick={props.onSelectAllMatching}>Select all {total} matching this filter</s-button>
          </s-stack>
        ) : null}
      </s-section>

      {summary.printedCount > 0 ? (
        <s-banner
          tone="warning"
          heading={`${summary.printedCount} of these ${summary.printedCount === 1 ? "was" : "were"} printed already`}
        >
          <s-paragraph>
            Printing again is fine, but it is how parcels get shipped twice.
          </s-paragraph>
          <s-button slot="secondary-actions" onClick={props.onExcludePrinted}>
            Exclude already printed
          </s-button>
        </s-banner>
      ) : null}
    </s-stack>
  );
}
