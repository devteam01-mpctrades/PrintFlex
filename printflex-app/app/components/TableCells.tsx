import type { ReactNode } from "react";

/**
 * Table cells with room to breathe. Polaris tables size columns by content
 * and pack cells tightly, so every table in the app wraps cell content in a
 * box with Polaris spacing tokens: a "base" gap to the next column, a little
 * vertical padding so two-line rows are not tighter than one-line rows, and
 * a minimum width per column so nothing that fits today wraps tomorrow.
 */
export type ColumnWidth = "xs" | "sm" | "md" | "lg";

const MIN_WIDTH: Record<ColumnWidth, `${number}px`> = { xs: "56px", sm: "80px", md: "120px", lg: "160px" };

interface CellProps {
  width?: ColumnWidth;
  /** Numeric columns align to the end so digits line up. */
  align?: "start" | "end";
  children?: ReactNode;
}

export function Cell({ width, align = "start", children }: CellProps) {
  return (
    <s-table-cell>
      <s-box paddingInlineEnd="base" paddingBlock="small-300" minInlineSize={width ? MIN_WIDTH[width] : undefined}>
        {align === "end" ? <s-stack direction="inline" justifyContent="end">{children}</s-stack> : children}
      </s-box>
    </s-table-cell>
  );
}

interface HeaderProps extends CellProps {
  listSlot?: "primary" | "secondary" | "kicker" | "inline" | "labeled";
  format?: "numeric" | "currency";
}

export function HeaderCell({ width, align = "start", listSlot, format, children }: HeaderProps) {
  return (
    <s-table-header listSlot={listSlot} format={format}>
      <s-box paddingInlineEnd="base" minInlineSize={width ? MIN_WIDTH[width] : undefined}>
        {align === "end" ? <s-stack direction="inline" justifyContent="end">{children}</s-stack> : children}
      </s-box>
    </s-table-header>
  );
}
