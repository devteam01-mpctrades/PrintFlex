import type { PaperSize, TemplateSettings } from "../templates/templates.server";
import { escapeHtml, safeColor, safeFont } from "./html.server";

/**
 * One stylesheet for every document. Branding is per-article CSS variables
 * (see articleStyle), so an invoice and a packing slip with different
 * templates can share one PDF.
 */

const PAGE_SIZE: Record<PaperSize, string> = { A4: "A4", LETTER: "Letter" };

export function articleStyle(settings: TemplateSettings): string {
  const accent = safeColor(settings.accentColor, "#1f2937");
  const heading = safeFont(settings.headingFont, "Inter");
  const body = safeFont(settings.bodyFont, "Inter");
  const compact = settings.density === "compact";
  return escapeHtml(
    `--accent:${accent};--font-heading:"${heading}",system-ui,sans-serif;--font-body:"${body}",system-ui,sans-serif;--base:${compact ? "10.5pt" : "11.5pt"};--gap:${compact ? "10mm" : "14mm"}`,
  );
}

export function documentCss(paperSize: PaperSize): string {
  return `
  @page { size: ${PAGE_SIZE[paperSize]}; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { color: #111827; }
  article.doc {
    --ink: #111827; --muted: #6b7280; --rule: #e5e7eb;
    font-family: var(--font-body); font-size: var(--base); color: var(--ink); line-height: 1.4;
    page-break-after: always; break-after: page;
  }
  article.doc:last-child { page-break-after: auto; break-after: auto; }
  article.doc h1, article.doc h2, article.doc h3 { font-family: var(--font-heading); margin: 0; }
  article.doc h1 { font-size: 2em; letter-spacing: -0.01em; color: var(--accent); }
  article.doc h2 { font-size: 1.2em; margin-bottom: 3mm; }
  article.doc h3 { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 0.4em; }
  .doc header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; border-bottom: 2px solid var(--accent); padding-bottom: 5mm; margin-bottom: var(--gap); }
  .doc .brand { display: flex; align-items: center; gap: 6mm; }
  .doc .brand img { max-height: 18mm; max-width: 60mm; }
  .doc .brand .name { font-family: var(--font-heading); font-size: 1.4em; font-weight: 600; }
  .doc .meta { text-align: right; }
  .doc .meta table { border-collapse: collapse; margin-left: auto; }
  .doc .meta th { text-align: left; color: var(--muted); font-weight: 500; padding: 0 4mm 0 0; white-space: nowrap; }
  .doc .meta td { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .doc .codes { display: flex; gap: 6mm; align-items: flex-start; }
  .doc .codes:empty { display: none; }
  .doc .code { display: flex; flex-direction: column; align-items: center; gap: 1mm; }
  .doc .code svg { display: block; }
  .doc .code .value { font-family: var(--font-body); font-variant-numeric: tabular-nums; font-size: 0.85em; letter-spacing: 0.06em; }
  .doc .parties { display: grid; gap: 0; margin-top: calc(var(--gap) * -0.45); margin-bottom: calc(var(--gap) * 0.75); align-items: start; font-size: 0.9em; }
  .doc .parties.cols-2 { grid-template-columns: 1fr 1fr; }
  .doc .parties.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  .doc .party { padding: 0 5mm 0 0; }
  .doc .party + .party { padding-left: 5mm; border-left: 1px solid var(--rule); }
  .doc .party h3 { margin-bottom: 1mm; color: var(--accent); font-size: 0.75em; }
  .doc .party div { line-height: 1.3; }
  .doc .party .name { font-weight: 700; color: var(--ink); }
  .doc .party .contact { margin-top: 1.2mm; color: var(--muted); font-size: 0.9em; }
  .doc table.lines { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  .doc table.lines th { text-align: left; font-weight: 600; font-size: 0.85em; color: var(--muted); border-bottom: 1px solid var(--ink); padding: 2mm 2mm; }
  .doc table.lines td { padding: 2.2mm 2mm; border-bottom: 1px solid var(--rule); vertical-align: top; }
  .doc table.lines .num, .doc table.lines th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .doc table.lines .mono { font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted); }
  .doc table.lines .qty { font-size: 1.15em; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums; }
  .doc table.lines .box { width: 5mm; height: 5mm; border: 1.5px solid var(--ink); border-radius: 1mm; display: inline-block; vertical-align: middle; }
  .doc table.lines .bin { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .doc table.lines tr.group td { background: #f3f4f6; font-weight: 700; padding: 1.6mm 2mm; border-bottom: 0; }
  .doc .variant { color: var(--muted); }
  .doc .closing { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; margin-top: 2mm; }
  .doc .closing .codes { align-items: flex-end; }
  .doc .totals { display: flex; justify-content: flex-end; margin-left: auto; }
  .doc .totals table { border-collapse: collapse; min-width: 70mm; }
  .doc .totals th { text-align: left; font-weight: 500; color: var(--muted); padding: 1.2mm 6mm 1.2mm 0; }
  .doc .totals td { text-align: right; font-variant-numeric: tabular-nums; padding: 1.2mm 0; }
  .doc .totals tr.grand th, .doc .totals tr.grand td { border-top: 2px solid var(--accent); padding-top: 2.5mm; font-weight: 700; color: var(--ink); font-size: 1.15em; }
  .doc .status { display: inline-block; margin-top: 3mm; padding: 1mm 3mm; border: 1px solid var(--accent); border-radius: 2mm; color: var(--accent); font-weight: 600; font-size: 0.85em; }
  .doc .callout { margin: 0 0 6mm; padding: 3mm 4mm; border-left: 3px solid var(--accent); background: #f9fafb; }
  .doc .callout h3 { margin-bottom: 1mm; }
  .doc .notes { margin-top: var(--gap); color: var(--muted); }
  .doc footer { margin-top: var(--gap); padding-top: 4mm; border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.85em; display: flex; justify-content: space-between; gap: 8mm; align-items: flex-end; }
  .doc .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; margin-bottom: var(--gap); }
  .doc .summary .stat { border: 1px solid var(--rule); border-radius: 2mm; padding: 4mm; }
  .doc .summary .stat .n { font-size: 2em; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--accent); line-height: 1; }
  .doc .summary .stat .l { color: var(--muted); font-size: 0.85em; margin-top: 1.5mm; }
  .doc.cover { display: flex; flex-direction: column; justify-content: center; min-height: 240mm; text-align: center; }
  .doc.cover h1 { font-size: 3em; }
  .doc.cover .codes { justify-content: center; margin: 10mm 0; }
  .doc.cover .hint { color: var(--muted); }
  @media screen {
    body { background: #e5e7eb; padding: 10mm; }
    article.doc { background: white; width: ${paperSize === "LETTER" ? "216mm" : "210mm"}; min-height: ${paperSize === "LETTER" ? "279mm" : "297mm"}; margin: 0 auto 10mm; padding: 14mm 14mm 16mm; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
    .print-bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: center; background: #111827; color: white; padding: 12px; margin: -10mm -10mm 10mm; font: 14px system-ui, sans-serif; }
    .print-bar button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 0; background: white; color: #111827; cursor: pointer; }
  }
  @media print { .print-bar { display: none; } }
  `;
}
