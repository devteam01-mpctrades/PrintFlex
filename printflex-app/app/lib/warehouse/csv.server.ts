/**
 * CSV parsing for the two warehouse maps. Tolerant of headers, quotes,
 * semicolons and stray whitespace; strict about what a row must contain.
 */

export interface ParsedCsv {
  rows: string[][];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const delimiter = text.split("\n")[0]?.includes(";") && !text.split("\n")[0]?.includes(",") ? ";" : ",";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
  return rows;
}

function looksLikeHeader(row: string[], words: string[]): boolean {
  return row.some((c) => words.includes(c.toLowerCase().replaceAll(/[\s_-]/g, "")));
}

export interface BinRow {
  sku: string;
  bin: string;
  sequence: number | null;
}

export interface ParseResult<T> {
  rows: T[];
  errors: string[];
}

/** SKU, bin[, walking sequence]. Duplicate SKUs keep the last row. */
export function parseBinCsv(text: string): ParseResult<BinRow> {
  const raw = parseCsv(text);
  const errors: string[] = [];
  const bySku = new Map<string, BinRow>();
  raw.forEach((row, index) => {
    if (index === 0 && looksLikeHeader(row, ["sku", "bin", "binlocation", "location", "sequence", "walkingsequence"])) return;
    const [sku, bin, seq] = row;
    if (!sku || !bin) { errors.push(`Line ${index + 1}: needs a SKU and a bin, got "${row.join(", ")}".`); return; }
    let sequence: number | null = null;
    if (seq !== undefined && seq !== "") {
      const n = Number(seq);
      if (!Number.isInteger(n) || n < 0) { errors.push(`Line ${index + 1}: walking sequence must be a whole number, got "${seq}".`); return; }
      sequence = n;
    }
    bySku.set(sku, { sku, bin, sequence });
  });
  return { rows: [...bySku.values()], errors };
}

export interface BundleRow {
  bundleSku: string;
  componentSku: string;
  quantity: number;
  componentTitle: string | null;
}

/** bundle SKU, component SKU[, quantity[, component title]]. */
export function parseBundleCsv(text: string): ParseResult<BundleRow> {
  const raw = parseCsv(text);
  const errors: string[] = [];
  const rows = new Map<string, BundleRow>();
  raw.forEach((row, index) => {
    if (index === 0 && looksLikeHeader(row, ["bundle", "bundlesku", "component", "componentsku", "quantity", "qty", "title"])) return;
    const [bundleSku, componentSku, qty, title] = row;
    if (!bundleSku || !componentSku) { errors.push(`Line ${index + 1}: needs a bundle SKU and a component SKU, got "${row.join(", ")}".`); return; }
    if (bundleSku === componentSku) { errors.push(`Line ${index + 1}: a bundle cannot contain itself (${bundleSku}).`); return; }
    let quantity = 1;
    if (qty !== undefined && qty !== "") {
      const n = Number(qty);
      if (!Number.isInteger(n) || n < 1) { errors.push(`Line ${index + 1}: quantity must be a whole number of at least 1, got "${qty}".`); return; }
      quantity = n;
    }
    rows.set(`${bundleSku}|${componentSku}`, { bundleSku, componentSku, quantity, componentTitle: title || null });
  });
  return { rows: [...rows.values()], errors };
}

/**
 * "Aisle, then shelf, then bin": derive a walking sequence from bin codes
 * like A-03-12 when the CSV gave none, by sorting codes naturally.
 */
export function deriveSequences(rows: BinRow[]): BinRow[] {
  if (rows.some((r) => r.sequence !== null)) return rows;
  const sorted = [...rows].sort((a, b) => a.bin.localeCompare(b.bin, undefined, { numeric: true }));
  const order = new Map(sorted.map((r, i) => [r.sku, i]));
  return rows.map((r) => ({ ...r, sequence: order.get(r.sku) ?? null }));
}
