import type { PaperSize } from "../templates/templates.server";
import { documentCss } from "./document-css.server";
import { escapeHtml } from "./html.server";

export interface WrapOptions {
  title: string;
  paperSize: PaperSize;
  /** Adds an on-screen print bar and calls window.print() on load (the browser fallback). */
  printOnLoad?: boolean;
}

/** Turn document fragments into one printable HTML page. */
export function wrapDocument(fragments: readonly string[], options: WrapOptions): string {
  const bar = options.printOnLoad
    ? `<div class="print-bar"><span>${escapeHtml(options.title)} · ${fragments.length} sheet${fragments.length === 1 ? "" : "s"}</span><button onclick="window.print()">Print</button></div>`
    : "";
  const script = options.printOnLoad ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>${documentCss(options.paperSize)}</style>
</head>
<body>
${bar}
${fragments.join("\n")}
${script}
</body>
</html>`;
}
