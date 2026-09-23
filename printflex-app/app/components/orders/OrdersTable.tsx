import { useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import type { OrderRow } from "../../lib/orders/list.server";
import { PAGE_SIZE } from "../../lib/orders/constants";
import type { DocumentType, OrderDocumentStatus } from "../../lib/types";
import { useNativeEvent } from "./useNativeEvent";
import { Cell, HeaderCell } from "../TableCells";

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

/** New is quiet, Printed draws attention, Packed is done, Needs review is a problem. */
const STATUS_TONE: Record<OrderDocumentStatus, "neutral" | "info" | "success" | "critical"> = {
  NEW: "neutral",
  PRINTED: "info",
  PACKED: "success",
  NEEDS_REVIEW: "critical",
};

const DOC_ORDER: DocumentType[] = ["INVOICE", "PACKING_SLIP", "PICK_LIST"];
const DOC_LABEL: Record<DocumentType, string> = {
  INVOICE: "INV",
  PACKING_SLIP: "SLIP",
  PICK_LIST: "PICK",
};

/** "INV+SLIP+PICK" in a fixed order, so the same set always reads the same. */
export function documentsLabel(documents: DocumentType[]): string {
  return DOC_ORDER.filter((d) => documents.includes(d)).map((d) => DOC_LABEL[d]).join("+");
}

interface CheckboxElement extends HTMLElement {
  value: string;
  checked: boolean;
}

/**
 * The orders table. Expects at least one row; the route renders the empty
 * states. Pagination and selection events come from the Polaris elements.
 */
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

  const first = (page - 1) * PAGE_SIZE + 1;
  const last = first + rows.length - 1;

  return (
    <>
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
          <HeaderCell width="sm" listSlot="primary">Order</HeaderCell>
          <HeaderCell width="md" listSlot="secondary">Customer</HeaderCell>
          <HeaderCell width="xs" align="end" format="numeric">Items</HeaderCell>
          <HeaderCell width="md" align="end" format="currency">Total</HeaderCell>
          <HeaderCell width="xs" listSlot="inline">Documents</HeaderCell>
          <HeaderCell listSlot="kicker">Status</HeaderCell>
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
                <Cell width="sm">
                  <s-link href={`shopify://admin/orders/${row.shopifyOrderNumber}`} tone={highlighted ? "auto" : "neutral"}>
                    <s-text type="strong" fontVariantNumeric="tabular-nums">{row.orderName}</s-text>
                  </s-link>
                </Cell>
                <Cell width="md">
                  {row.customerName ?? "Guest"}
                  {row.countryCode ? ` · ${row.countryCode}` : ""}
                </Cell>
                <Cell width="xs" align="end">
                  <s-text fontVariantNumeric="tabular-nums">{row.itemCount}</s-text>
                </Cell>
                <Cell width="md" align="end">
                  <s-text fontVariantNumeric="tabular-nums">
                    {row.totalAmount} {row.currency}
                  </s-text>
                </Cell>
                <Cell width="xs">
                  {row.documents.length === 0 ? (
                    <s-text color="subdued">—</s-text>
                  ) : (
                    <s-text color="subdued" fontVariantNumeric="tabular-nums">{documentsLabel(row.documents)}</s-text>
                  )}
                </Cell>
                <Cell>
                  <s-badge tone={STATUS_TONE[row.documentStatus]}>{STATUS_LABEL[row.documentStatus]}</s-badge>
                </Cell>
              </s-table-row>
            );
          })}
        </s-table-body>
      </s-table>
      <s-box paddingInline="base" paddingBlock="small">
        <s-text color="subdued" fontVariantNumeric="tabular-nums">
          Showing {first}–{last} of {total} · select-all matches the filter, not just this page
        </s-text>
      </s-box>
    </>
  );
}
