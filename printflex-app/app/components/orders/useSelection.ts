import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrderDocumentStatus } from "../../lib/types";
import type { SelectionSpec } from "../../lib/orders/list.server";

export interface SelectableRow {
  id: string;
  documentStatus: OrderDocumentStatus;
}

/**
 * Selection is either an explicit set of ids (with their statuses, so the
 * reprint guard can count across pages) or "everything matching the current
 * filter" minus exclusions. It lives in React state, which persists across
 * pagination because the route component stays mounted, and is mirrored to
 * sessionStorage so a reload does not lose it.
 */
type State =
  | { mode: "ids"; items: Record<string, OrderDocumentStatus> }
  | { mode: "filter"; query: string; excluded: Record<string, OrderDocumentStatus>; excludePrinted: boolean };

const EMPTY: State = { mode: "ids", items: {} };
const PRINTED_STATES: OrderDocumentStatus[] = ["PRINTED", "PACKED"];

function isPrinted(status: OrderDocumentStatus): boolean {
  return PRINTED_STATES.includes(status);
}

function storageKey(shopId: string): string {
  return `printflex:orders:selection:${shopId}`;
}

function load(shopId: string): State {
  try {
    const raw = window.sessionStorage.getItem(storageKey(shopId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as State;
    return parsed.mode === "ids" || parsed.mode === "filter" ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

export interface SelectionSummary {
  count: number;
  printedCount: number;
  mode: State["mode"];
  excludePrinted: boolean;
}

export function useSelection(args: {
  shopId: string;
  queryString: string;
  rows: SelectableRow[];
  total: number;
  alreadyPrintedTotal: number;
}) {
  const { shopId, queryString, rows, total, alreadyPrintedTotal } = args;
  const [state, setState] = useState<State>(EMPTY);
  const lastIndexRef = useRef<number | null>(null);

  // Hydrate from sessionStorage once on the client.
  useEffect(() => {
    setState(load(shopId));
  }, [shopId]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey(shopId), JSON.stringify(state));
    } catch {
      /* storage unavailable: selection still works for this page */
    }
  }, [shopId, state]);

  // A filter-wide selection refers to one filter; changing filters clears it.
  useEffect(() => {
    setState((current) =>
      current.mode === "filter" && current.query !== queryString ? EMPTY : current,
    );
  }, [queryString]);

  const isSelected = useCallback(
    (id: string): boolean =>
      state.mode === "ids" ? id in state.items : !(id in state.excluded),
    [state],
  );

  const setMany = useCallback((targets: SelectableRow[], selected: boolean) => {
    setState((current) => {
      if (current.mode === "ids") {
        const items = { ...current.items };
        for (const row of targets) {
          if (selected) items[row.id] = row.documentStatus;
          else delete items[row.id];
        }
        return { mode: "ids", items };
      }
      const excluded = { ...current.excluded };
      for (const row of targets) {
        if (selected) delete excluded[row.id];
        else excluded[row.id] = row.documentStatus;
      }
      return { ...current, excluded };
    });
  }, []);

  /** Toggle one row; with shift, apply the same state to the range since the last toggle. */
  const toggle = useCallback(
    (index: number, selected: boolean, shift: boolean) => {
      const from = shift && lastIndexRef.current !== null ? lastIndexRef.current : index;
      const [lo, hi] = from < index ? [from, index] : [index, from];
      setMany(rows.slice(lo, hi + 1), selected);
      lastIndexRef.current = index;
    },
    [rows, setMany],
  );

  const selectPage = useCallback((selected: boolean) => setMany(rows, selected), [rows, setMany]);

  const selectAllMatching = useCallback(() => {
    setState({ mode: "filter", query: queryString, excluded: {}, excludePrinted: false });
  }, [queryString]);

  const clear = useCallback(() => {
    setState(EMPTY);
    lastIndexRef.current = null;
  }, []);

  const excludePrinted = useCallback(() => {
    setState((current) => {
      if (current.mode === "ids") {
        const items = Object.fromEntries(
          Object.entries(current.items).filter(([, status]) => !isPrinted(status)),
        );
        return { mode: "ids", items };
      }
      return { ...current, excludePrinted: true };
    });
  }, []);

  const summary = useMemo<SelectionSummary>(() => {
    if (state.mode === "ids") {
      const statuses = Object.values(state.items);
      return {
        mode: "ids",
        count: statuses.length,
        printedCount: statuses.filter(isPrinted).length,
        excludePrinted: false,
      };
    }
    const excludedStatuses = Object.values(state.excluded);
    const excludedPrinted = excludedStatuses.filter(isPrinted).length;
    const printedRemaining = Math.max(0, alreadyPrintedTotal - excludedPrinted);
    const base = Math.max(0, total - excludedStatuses.length);
    return {
      mode: "filter",
      count: state.excludePrinted ? Math.max(0, base - printedRemaining) : base,
      printedCount: state.excludePrinted ? 0 : printedRemaining,
      excludePrinted: state.excludePrinted,
    };
  }, [state, total, alreadyPrintedTotal]);

  const pageSelectedCount = rows.filter((r) => isSelected(r.id)).length;

  const spec = useMemo<SelectionSpec>(
    () =>
      state.mode === "ids"
        ? { mode: "ids", ids: Object.keys(state.items) }
        : {
            mode: "filter",
            query: state.query,
            excludeIds: Object.keys(state.excluded),
            excludePrinted: state.excludePrinted,
          },
    [state],
  );

  return {
    isSelected,
    toggle,
    selectPage,
    selectAllMatching,
    clear,
    excludePrinted,
    summary,
    pageSelectedCount,
    allOnPageSelected: rows.length > 0 && pageSelectedCount === rows.length,
    spec,
  };
}
