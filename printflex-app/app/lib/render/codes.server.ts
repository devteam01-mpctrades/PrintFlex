import { toSVG as bwipToSvg } from "bwip-js/node";
import QRCode from "qrcode";
import type { CodeSize } from "../templates/templates.server";

/**
 * The two codes on every document, as inline SVG.
 *
 * QR: the scan URL, medium error correction so a coffee ring still scans.
 * Barcode: Code 128 of the Shopify order name, with the value printed
 * beneath so a human can type it when the scanner is elsewhere.
 *
 * Sizes are physical, in millimetres, because the codes are read from paper.
 */

export const QR_SIZE_MM: Record<CodeSize, number> = { small: 15, medium: 22, large: 30 };
export const BARCODE_HEIGHT_MM: Record<CodeSize, number> = { small: 9, medium: 12, large: 16 };

export async function qrSvg(url: string, size: CodeSize): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
  const mm = QR_SIZE_MM[size];
  return svg.replace(/<svg([^>]*)>/, (_, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)="[^"]*"/g, "");
    return `<svg${cleaned} width="${mm}mm" height="${mm}mm" role="img" aria-label="QR code">`;
  });
}

/** Code 128 module (narrowest bar) width in mm. 0.33 mm is the handheld-scanner sweet spot. */
export const BARCODE_MODULE_MM: Record<CodeSize, number> = { small: 0.25, medium: 0.33, large: 0.4 };

export interface BarcodeBlock {
  /** Inline SVG of the bars only. */
  svg: string;
  /** The encoded value, printed beneath the bars by the template. */
  value: string;
  widthMm: number;
  heightMm: number;
}

export function barcodeBlock(orderName: string, size: CodeSize): BarcodeBlock {
  // bwip-js in Node is synchronous and returns an SVG with a viewBox whose
  // width is 2 px per module (scaleX defaults to 2). Physical size is set
  // here from the module width so the bars are the same on any paper.
  const raw = bwipToSvg({
    bcid: "code128",
    text: orderName,
    height: BARCODE_HEIGHT_MM[size],
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
  const match = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(raw);
  const viewWidth = match ? Number(match[1]) : 0;
  const modules = viewWidth / 2;
  const widthMm = Math.round(modules * BARCODE_MODULE_MM[size] * 10) / 10;
  const heightMm = BARCODE_HEIGHT_MM[size];
  const svg = raw.replace(
    "<svg",
    `<svg width="${widthMm}mm" height="${heightMm}mm" preserveAspectRatio="none" role="img" aria-label="Barcode ${orderName.replaceAll('"', "")}"`,
  );
  return { svg, value: orderName, widthMm, heightMm };
}
