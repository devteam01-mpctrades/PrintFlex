import { useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import type { OrderRow } from "../../lib/orders/list.server";
import type { DocumentType, OrderDocumentStatus } from "../../lib/types";
import { useNativeEvent } from "./useNativeEvent";

interface Props {
  rows: OrderRow[];
  page: number;
  pageCount: number;
  total: number;
  queryString: string;
  isSelected: (id: string) => boolean;
  allOnPageSelected: boolean;
  pageSelectedCount: number;
  onToggle: (index: number, selected: boolean, shift: boolean) => void;
  onSelectPage: (selected: boolean) => void;
  highlightId: string | null;
}

const STATUS_LABEL: Record<OrderDocumentStatus, string> = {
  NEW: "New",
  PRINTED: "Printed",
  PACKED: "Packed",
  NEEDS_REVIEW: "Needs review",
};

const STATUS_TONE: Record<OrderDocumentStatus, "neutral" | "info" | "success" | "warning"> = {
  NEW: "neutral",
  PRINTED: "info",
  PACKED: "success",
  NEEDS_REVIEW: "warning",
};

const DOC_LABEL: Record<DocumentType, string> = {
  INVOICE: "INV",
  PACKING_SLIP: "SLIP",
  PICK_LIST: "PICK",
};

interface CheckboxElement extends HTMLElement {
  value: string;
  checked: boolean;
}

export function OrdersTable(props: Props) {
  const { rows, page, pageCount, total, queryString, isSelected, allOnPageSelected, pageSelectedCount } = props;
  const navigate = useNavigate();
  const tableRef = useRef<HTMLElementTagNameMap["s-table"]>(null);
  const shiftRef = useRef(false);

  const goToPage = useCallback(
    (target: number) => {
      const params = new URLSearchParams(queryString);
      if (target > 1) params.set("page", String(target));
      void navigate(`/app/orders${params.size ? `?${params}` : ""}`);
    },
    [navigate, queryString],
  );

  useNativeEvent(tableRef, "nextpage", useCallback(() => goToPage(page + 1), [goToPage, page]));
  useNativeEvent(tableRef, "previouspage", useCallback(() => goToPage(page - 1), [goToPage, page]));

  // Remember whether shift was held on the click that produced the change.
  useNativeEvent<MouseEvent>(
    tableRef,
    "click",
    useCallback((event: MouseEvent) => {
      shiftRef.current = event.shiftKey;
    }, []),
    { capture: true },
  );

  useNativeEvent(
    tableRef,
    "change",
    useCallback(
      (event: Event) => {
        const target = event.target as CheckboxElement | null;
        if (!target || target.tagName.toLowerCase() !== "s-checkbox") return;
        if (target.value === "__page__") {
          props.onSelectPage(target.checked);
          return;
        }
        const index = rows.findIndex((row) => row.id === target.value);
        if (index >= 0) props.onToggle(index, target.checked, shiftRef.current);
      },
      [props, rows],
    ),
  );

  if (rows.length === 0) {
    return (
      <s-section>
        <s-paragraph>
          No orders match these filters. Clear a filter or run a sync if you expected orders here.
        </s-paragraph>
      </s-section>
    );
  }

  const first = (page - 1) * 50 + 1;
  const last = first + rows.length - 1;

  return (
    <s-section padding="none">
      <s-table
        ref={tableRef}
        paginate
        hasPreviousPage={page > 1 || undefined}
        hasNextPage={page < pageCount || undefined}
      >
        <s-table-header-row>
          <s-table-header>
            <s-checkbox
              value="__page__"
              accessibilityLabel="Select all orders on this page"
              checked={allOnPageSelected || undefined}
              indeterminate={(!allOnPageSelected && pageSelectedCount > 0) || undefined}
            ></s-checkbox>
          </s-table-header>
          <s-table-header listSlot="primary">Order</s-table-header>
          <s-table-header listSlot="secondary">Customer</s-table-header>
          <s-table-header format="numeric">Items</s-table-header>
          <s-table-header format="currency">Total</s-table-header>
          <s-table-header listSlot="inline">Documents</s-table-header>
          <s-table-header listSlot="kicker">Status</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {rows.map((row) => {
            const selected = isSelected(row.id);
            const highlighted = row.id === props.highlightId;
            return (
              <s-table-row key={row.id}>
                <s-table-cell>
                  <s-checkbox
                    value={row.id}
                    accessibilityLabel={`Select ${row.orderName}`}
                    checked={selected || undefined}
                  ></s-checkbox>
                </s-table-cell>
                <s-table-cell>
                  <s-text type="strong" fontVariantNumeric="tabular-nums" tone={highlighted ? "info" : "auto"}>
                    {row.orderName}
                  </s-text>
                </s-table-cell>
                <s-table-cell>
                  {row.customerName ?? "Guest"}
                  {row.countryCode ? ` · ${row.countryCode}` : ""}
                </s-table-cell>
                <s-table-cell>
                  <s-text fontVariantNumeric="tabular-nums">{row.itemCount}</s-text>
                </s-table-cell>
                <s-table-cell>
                  <s-text fontVariantNumeric="tabular-nums">
                    {row.totalAmount} {row.currency}
                  </s-text>
                </s-table-cell>
                <s-table-cell>
                  {row.documents.length === 0 ? (
                    <s-text color="subdued">—</s-text>
                  ) : (
                    <s-text fontVariantNumeric="tabular-nums">
                      {row.documents.map((d) => DOC_LABEL[d]).join(" + ")}
                    </s-text>
                  )}
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={STATUS_TONE[row.documentStatus]}>{STATUS_LABEL[row.documentStatus]}</s-badge>
                </s-table-cell>
              </s-table-row>
            );
          })}
        </s-table-body>
      </s-table>
      <s-box padding="base">
        <s-paragraph color="subdued" fontVariantNumeric="tabular-nums">
          Showing {first}–{last} of {total}
        </s-paragraph>
      </s-box>
    </s-section>
  );
}
