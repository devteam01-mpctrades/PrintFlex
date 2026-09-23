import { useCallback, useEffect, useRef, useState } from "react";

/** The scan page renders at a narrow phone width and is scaled into the 196px frame so text stays legible. */
const PHONE_WIDTH = 320;
const SCALE = 196 / PHONE_WIDTH;
const MIN_HEIGHT = 360;
const MAX_HEIGHT = 620;

interface Props {
  /** Same-origin URL of the real scan page in preview mode. */
  src: string;
  sample: boolean;
}

/** The live scan page, framed like a phone, rendered against a real order. */
export function PackerPreview({ src, sample }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(430);
  // Same-origin iframe: read the rendered height so the frame ends where the screen ends.
  const fit = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const content = doc?.documentElement.scrollHeight ?? 0;
    if (content > 0) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(content * SCALE))));
  }, []);
  // The pack screen hydrates and re-lays out after load; follow its body height instead of guessing.
  const observerRef = useRef<ResizeObserver | null>(null);
  const watch = useCallback(() => {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    observerRef.current?.disconnect();
    observerRef.current = new ResizeObserver(fit);
    observerRef.current.observe(body);
    fit();
  }, [fit]);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return (
    <div className="pf-panel">
      <div className="pf-panel__h"><h2>What the packer sees</h2></div>
      <div className="pf-phone-wrap">
        <div className="pf-phone" aria-label="Preview of scan mode on a phone">
          <div className="pf-phone__notch" />
          <div className="pf-phone__viewport" style={{ height }}>
            <iframe
              ref={frameRef}
              className="pf-phone__screen"
              title="Scan mode preview"
              src={src}
              sandbox="allow-scripts allow-same-origin"
              scrolling="no"
              onLoad={watch}
              style={{ height: Math.round(height / SCALE) }}
            />
          </div>
        </div>
        <p className="pf-caption">
          {sample ? "Sample order shown until your orders are synced. " : ""}
          Product photos come from Shopify, so a packer who has never seen the catalogue still fills the right box.
        </p>
      </div>
    </div>
  );
}
