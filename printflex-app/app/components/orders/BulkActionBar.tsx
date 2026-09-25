import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import type { SelectionSpec } from "../../lib/orders/list.server";
import type { SelectionSummary } from "./useSelection";
import { Btn, Check } from "../ui";

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

  if (summary.count === 0) return null;

  const offerSelectAll = summary.mode === "ids" && allOnPageSelected && total > pageRowCount;
  const countLabel =
    summary.mode === "filter" ? `All ${summary.count} matching this filter selected` : `${summary.count} selected`;

  return (
    <s-box padding="base" background="subdued">
      <s-stack gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text type="strong" fontVariantNumeric="tabular-nums">{countLabel}</s-text>
          {ACTIONS.map((action) => (
            <Btn
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
            </Btn>
          ))}
          <Btn
            variant="secondary"
            disabled={busy || undefined}
            onClick={() => fetcher.submit({ intent: "markPrinted", selection }, { method: "post" })}
          >
            Mark as printed
          </Btn>
          <Btn variant="tertiary" onClick={props.onClear}>
            Clear selection
          </Btn>
        </s-stack>
        <s-stack direction="inline" gap="base" alignItems="center">
          <Check value="coverSheet" label="Add a cover sheet with the batch QR code" checked={coverSheet} onChange={(e) => setCoverSheet(e.target.checked)} />
          {offerSelectAll ? (
            <Btn variant="tertiary" onClick={props.onSelectAllMatching}>
              Select all {total} matching this filter, not just this page
            </Btn>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}
