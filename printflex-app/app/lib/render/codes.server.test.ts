import { describe, expect, it } from "vitest";
import { barcodeBlock, qrSvg } from "./codes.server";

describe("codes", () => {
  it("renders a QR as inline SVG at the requested physical size", async () => {
    const svg = await qrSvg("https://example.com/scan/abcdefghijklmnop.qrstuvwxyz012345", "small");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="15mm"');
    expect(svg).toContain('height="15mm"');
    expect(svg).toContain("<path");
  });

  it("renders a real Code 128 barcode of the order name at a scannable module width", () => {
    const block = barcodeBlock("#KS-10236", "medium");
    expect(block.svg.startsWith("<svg")).toBe(true);
    expect(block.svg).toContain(`width="${block.widthMm}mm"`);
    expect(block.svg).toContain('height="12mm"');
    expect(block.value).toBe("#KS-10236");
    // 9 characters of Code 128 need about 130 modules; at 0.33 mm that is roughly 43 mm.
    expect(block.widthMm).toBeGreaterThan(35);
    expect(block.widthMm).toBeLessThan(55);
    expect((block.svg.match(/<path/g) ?? []).length).toBeGreaterThan(0);
    // A different order name produces different bars.
    expect(barcodeBlock("#KS-10237", "medium").svg).not.toBe(block.svg);
  });
});
