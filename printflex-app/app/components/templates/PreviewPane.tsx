import { useEffect, useRef, useState } from "react";

/** CSS pixel width of the rendered sheet (A4 at 96 dpi is 794px; Letter 816px). The iframe renders at this width and is scaled to fit. */
const SHEET_WIDTH = 900;
const SHEET_HEIGHT = 1273;

interface Props {
  name: string;
  html: string;
  loading: boolean;
  /** Which order the preview shows, or the sample notice. */
  orderName: string | null;
  sample: boolean;
  previewLabel: string;
  dirty: boolean;
  saving: boolean;
  hasOrders: boolean;
  onSave: () => void;
}

/**
 * The centre pane. The iframe shows the exact HTML the batch renderer
 * produces for this template and order, with the preview flag set.
 */
export function PreviewPane({ name, html, loading, orderName, sample, previewLabel, dirty, saving, hasOrders, onSave }: Props) {
  // Scale the sheet down to the pane width so the whole page is visible without horizontal scrolling.
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / SHEET_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <s-section padding="none" accessibilityLabel="Live preview">
      <s-box padding="base">
        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-heading>{name}</s-heading>
            {loading ? <s-spinner size="base" accessibilityLabel="Rendering preview"></s-spinner> : null}
            <s-badge tone={dirty ? "warning" : "neutral"}>{dirty ? "Unsaved changes" : previewLabel}</s-badge>
          </s-stack>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button commandFor="pick-order-modal" command="--show" disabled={!hasOrders || undefined}>
              Preview another order
            </s-button>
            <s-button variant="primary" disabled={!dirty || saving || undefined} loading={saving || undefined} onClick={onSave}>
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </s-box>
      <s-divider></s-divider>
      {sample ? (
        <s-box paddingInline="base" paddingBlockStart="base">
          <s-banner tone="info">
            <s-paragraph>This is a sample order, not your data. Sync your orders and the preview switches to a real one.</s-paragraph>
          </s-banner>
        </s-box>
      ) : null}
      <s-box padding="base" background="subdued">
        <div ref={frameRef} style={{ width: "100%", height: Math.round(SHEET_HEIGHT * scale), overflow: "hidden", position: "relative" }}>
          <iframe
            title={`Preview of ${name}${orderName ? ` on ${orderName}` : ""}`}
            srcDoc={html}
            sandbox=""
            style={{
              width: SHEET_WIDTH,
              height: SHEET_HEIGHT,
              border: 0,
              borderRadius: 8,
              background: "#e5e7eb",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              opacity: loading ? 0.6 : 1,
              transition: "opacity .15s",
            }}
          />
        </div>
      </s-box>
      <s-divider></s-divider>
      <s-box padding="base">
        <s-text color="subdued">
          Preview renders against a real order, so you test the layout on your longest product names before printing 250 copies.
          {orderName && !sample ? ` Showing ${orderName}.` : ""}
        </s-text>
      </s-box>
    </s-section>
  );
}
