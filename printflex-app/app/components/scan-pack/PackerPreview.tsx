/** The scan page renders at a narrow phone width and is scaled into the 196px frame so text stays legible. */
const PHONE_WIDTH = 320;
const SCALE = 196 / PHONE_WIDTH;
/** A fixed screen, like a real phone: long orders scroll inside it instead of stretching the frame. */
const SCREEN_HEIGHT = 424;

interface Props {
  /** Same-origin URL of the real scan page in preview mode. */
  src: string;
  sample: boolean;
}

/** The live scan page, framed like a phone, rendered against a real order. */
export function PackerPreview({ src, sample }: Props) {
  return (
    <div className="pf-panel">
      <div className="pf-panel__h"><h2>What the packer sees</h2></div>
      <div className="pf-phone-wrap">
        <div className="pf-phone" aria-label="Preview of scan mode on a phone">
          <div className="pf-phone__notch" />
          <div className="pf-phone__viewport" style={{ height: SCREEN_HEIGHT }}>
            <iframe
              className="pf-phone__screen"
              title="Scan mode preview"
              src={src}
              sandbox="allow-scripts allow-same-origin"
              style={{ height: Math.round(SCREEN_HEIGHT / SCALE) }}
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
